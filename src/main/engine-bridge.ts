import { existsSync } from 'node:fs';
import path from 'node:path';
import { isConfirmed, parseKey } from '../core/key.js';
import { addCase, rejudgeAll, removeCase, type Change } from '../core/rejudge.js';
import { readRoster } from '../core/roster.js';
import { loadSet, listPages, saveTranscript } from '../core/setio.js';
import { DataError, type AnswerKey, type QtyUnit, type Student, type Transcript } from '../core/types.js';
import { ApiProvider, classifyApiError } from '../engine/api.js';
import { CliProvider } from '../engine/cli.js';
import { childEnv } from '../engine/env.js';
import { judgePage } from '../engine/judge.js';
import { draftKey, reviseKeyDraft, type KeyDraftInput, type KeyReviseInput } from '../engine/keydraft.js';
import { EngineError, userFacingMessage, type Effort, type TranscribeProvider } from '../engine/provider.js';
import { loadRules } from '../engine/rules.js';
import { claudeStatus, locateClaude } from '../engine/status.js';
import { transcribePage, transcribeSet } from '../engine/transcribe.js';
import { DEFAULT_EFFORT, DEFAULT_MODEL, type CliStatusView, type JudgeResult, type KeyDraftResult, type Profile, type ProgressEvent, type RejudgeResult, type RunResult } from '../shared/ipc.js';
import { openLogin } from './launch.js';
import { rebuildResult, saveKeyFile } from './results.js';
import type { SecretStore } from './secrets.js';
import type { SettingsStore } from './settings.js';

const changeText = (cs: Change[]) => cs.map(c => `${c.단위} ${c.이전}→${c.이후}`);

/** 채점 내용(단위·정답·허용·핵심)의 비교용 서명. 키 순서와 상관없고, 요소형이 아닌 '유형'은 판정에 영향이 없어 뺀다(옛 정답표엔 유형이 없다) */
function contentSig(k: AnswerKey): string {
  const qty = k.정량.map(({ 유형, ...u }: QtyUnit) => ({ ...u, ...(유형 === '요소형' ? { 유형 } : {}) }));
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([a, b]) => [a, sorted(b)])) : v;
  return JSON.stringify(sorted({ 정량: qty, 정성: k.정성 }));
}

export interface BridgeDeps { settings: SettingsStore; secrets: SecretStore; version: string; env?: NodeJS.ProcessEnv }

export class EngineBridge {
  private current: AbortController | null = null;
  constructor(private readonly deps: BridgeDeps) {}
  private get env() { return this.deps.env ?? process.env; }

  /** 사용 중 프로필의 노력 단계(없으면 high) */
  async effort(): Promise<Effort> { return (await this.profile()).노력 ?? DEFAULT_EFFORT; }

  async profile(id?: string): Promise<Profile> {
    const s = await this.deps.settings.load();
    const p = s.프로필.find(x => x.id === (id ?? s.사용중));
    if (!p) throw new DataError('사용할 AI 프로필이 없습니다. 설정에서 고르세요');
    return p;
  }

  private cliEnv(p: Profile): NodeJS.ProcessEnv { return childEnv(this.env, { configDir: p.configDir }); }

  async provider(id?: string): Promise<TranscribeProvider> {
    const p = await this.profile(id);
    if (p.종류 === 'cli') return new CliProvider({ program: locateClaude(this.env, existsSync, p.cliPath), env: this.cliEnv(p), model: p.모델 ?? DEFAULT_MODEL });
    const apiKey = await this.deps.secrets.open(p.id);
    if (!apiKey) throw new EngineError('signed-out', `프로필 '${p.이름}'에 API 키가 없습니다. 설정에서 입력해 주세요`);
    return new ApiProvider({ apiKey, model: p.모델 ?? DEFAULT_MODEL });
  }

  private readonly statusInFlight = new Map<string, Promise<CliStatusView>>();
  /** 배지와 시작 화면이 같은 때 부르면 외부 프로그램을 한 번만 띄운다 */
  cliStatus(id: string): Promise<CliStatusView> {
    const running = this.statusInFlight.get(id);
    if (running) return running;
    const p = this.cliStatusNow(id).finally(() => this.statusInFlight.delete(id));
    this.statusInFlight.set(id, p);
    return p;
  }

  private async cliStatusNow(id: string): Promise<CliStatusView> {
    const p = await this.profile(id);
    if (p.종류 !== 'cli') throw new DataError('CLI 프로필이 아닙니다');
    const program = locateClaude(this.env, existsSync, p.cliPath);
    const s = await claudeStatus(undefined, () => program, this.cliEnv(p));
    return { ...s, configDir: p.configDir, command: program?.command };
  }

  async openLogin(id: string): Promise<{ ok: boolean; message?: string }> {
    const p = await this.profile(id);
    const program = locateClaude(this.env, existsSync, p.cliPath);
    if (!program) return { ok: false, message: 'Claude Code가 설치되어 있지 않습니다. 설치 안내를 보세요' };
    return openLogin(program, this.cliEnv(p));
  }

  async testApiKey(id: string): Promise<{ ok: boolean; message: string }> {
    const apiKey = await this.deps.secrets.open(id);
    if (!apiKey) return { ok: false, message: '저장된 키가 없거나 이 PC에서 열 수 없습니다' };
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      await new Anthropic({ apiKey }).messages.create({ model: 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'pong' }] });
      return { ok: true, message: '연결됐습니다' };
    } catch (e) {
      const err = classifyApiError(e);
      // signed-out의 기본 안내는 Claude Code 로그인 문구라 API 키에 맞게 바꾼다
      return { ok: false, message: err.kind === 'signed-out' ? 'API 키가 틀리거나 권한이 없습니다. 키를 다시 확인해 주세요' : userFacingMessage(err) };
    }
  }

  /** 모델을 부르는 일은 한 번에 하나만. 창을 닫거나 '중단'하면 cancel()이 이것도 멈춘다 */
  private async exclusive<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.current) throw new DataError('이미 실행 중입니다. 끝나거나 중단된 뒤 다시 하세요');
    const ac = this.current = new AbortController();
    try { return await fn(ac.signal); } finally { this.current = null; }
  }

  async draftKey(input: KeyDraftInput): Promise<KeyDraftResult> {
    return this.exclusive(async signal => draftKey(await this.provider(), { ...input, effort: input.effort ?? await this.effort() }, signal));
  }

  async reviseKey(input: KeyReviseInput): Promise<KeyDraftResult> {
    if (!input.지시.trim()) throw new DataError('수정 지시가 비었습니다');
    return this.exclusive(async signal => reviseKeyDraft(await this.provider(), { ...input, effort: input.effort ?? await this.effort() }, signal));
  }

  private async roster(): Promise<Student[] | null> {
    const s = await this.deps.settings.load();
    return s.명단 ? readRoster(s.명단) : null;
  }

  private async confirmedSet(setDir: string) {
    const loaded = await loadSet(setDir);
    if (!isConfirmed(loaded.key)) throw new DataError('정답표가 아직 확인되지 않았습니다. 문항 설정에서 확인 표시를 한 뒤 채점하세요');
    return loaded;
  }

  async tryPage(setDir: string, jpeg: Buffer): Promise<Transcript> {
    const { key } = await this.confirmedSet(setDir);
    return this.exclusive(async signal => (await transcribePage(await this.provider(), { imageJpegBase64: jpeg.toString('base64'), key, rules: await loadRules(), page: 0, effort: await this.effort() }, signal)).transcript);
  }

  /** 세트 폴더의 엑셀을 다시 만든다. 실패는 메시지로만 */
  private async rebuildSafe(setDir: string): Promise<{ 엑셀?: string; 엑셀오류?: string }> {
    try { return await rebuildResult(setDir, await this.roster(), { version: this.deps.version }); }
    catch (e) { return { 엑셀오류: e instanceof Error ? e.message : String(e) }; }
  }

  /** 정답표 저장. 채점 내용이 바뀌었으면 확인을 지운다(화면만 믿지 않는다). 채점규칙·사례만 바뀐 저장은 확인 유지 */
  async saveKey(setDir: string, raw: unknown): Promise<AnswerKey> {
    const key = parseKey(JSON.stringify(raw), '정답표.json');
    let old: AnswerKey | null = null;
    try { old = (await loadSet(setDir)).key; } catch { /* 없거나 깨진 정답표는 새로 쓴다 */ }
    if (old && contentSig(old) !== contentSig(key) && key.확인?.완료) key.확인 = { 완료: false };
    await saveKeyFile(setDir, key);
    return key;
  }

  /** 결정적 재판정을 돌려 바뀐 장만 저장하고 엑셀을 다시 만든다 */
  private async rejudgeWith(setDir: string, key: AnswerKey, transcripts: Transcript[]): Promise<RejudgeResult> {
    const r = rejudgeAll(key, transcripts);
    for (const c of r.changed) await saveTranscript(setDir, r.transcripts.find(t => t.page === c.page)!);
    return { 바뀐장: r.changed.map(c => ({ page: c.page, 변경: changeText(c.changes) })), ...await this.rebuildSafe(setDir) };
  }

  async rejudge(setDir: string): Promise<RejudgeResult> {
    const { key, transcripts } = await loadSet(setDir);
    return this.rejudgeWith(setDir, key, transcripts);
  }

  async applyCase(setDir: string, c: { 단위: string; 답: string; 판정: 'O' | 'X'; page: number }, now: () => Date = () => new Date()): Promise<RejudgeResult> {
    if (c.판정 !== 'O' && c.판정 !== 'X') throw new DataError('사례의 판정은 O 또는 X여야 합니다');
    if (!c.답.trim()) throw new DataError('빈 답은 사례로 기록하지 않습니다');
    const { key, transcripts } = await loadSet(setDir);
    if (!key.정량.some(u => u.id === c.단위)) throw new DataError(`정답표에 단위 ${c.단위}가 없습니다`);
    const next = addCase(key, { 단위: c.단위, 답: c.답, 판정: c.판정, 일시: now().toISOString(), 출처: `검토 p${String(c.page).padStart(2, '0')}` });
    await saveKeyFile(setDir, next); // 사례는 확인을 지우지 않는다
    return this.rejudgeWith(setDir, next, transcripts);
  }

  async removeCase(setDir: string, 단위: string, 답: string): Promise<AnswerKey> {
    const next = removeCase((await loadSet(setDir)).key, 단위, 답);
    await saveKeyFile(setDir, next);
    return next;
  }

  /** 글만 보내는 모델 재판정. 전사와 같은 실행 표시를 써서 동시에 돌지 않는다 */
  async judgeWithModel(setDir: string, pages: number[] | undefined, onProgress: (e: ProgressEvent) => void): Promise<JudgeResult> {
    if (this.current) throw new DataError('이미 실행 중입니다. 끝나거나 중단된 뒤 다시 하세요');
    const ac = this.current = new AbortController();
    try {
      const { key, transcripts } = await this.confirmedSet(setDir);
      const todo = transcripts.filter(t => !pages || pages.includes(t.page));
      if (!todo.length) throw new DataError('다시 판정할 전사가 없습니다');
      const provider = await this.provider();
      const effort = await this.effort();
      const rules = await loadRules();
      const 바뀐장: RejudgeResult['바뀐장'] = [], failed: JudgeResult['failed'] = [];
      let done = 0;
      for (const t of todo) {
        if (ac.signal.aborted) break;
        try {
          const r = await judgePage(provider, key, rules, t, ac.signal, effort);
          if (r.changes.length) { await saveTranscript(setDir, r.transcript); 바뀐장.push({ page: t.page, 변경: changeText(r.changes) }); }
          onProgress({ page: t.page, done: ++done, total: todo.length, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
        } catch (e) {
          if (e instanceof EngineError && e.kind === 'cancelled') break;
          const error = userFacingMessage(e);
          failed.push({ page: t.page, error });
          onProgress({ page: t.page, done: ++done, total: todo.length, error });
          if (e instanceof EngineError && ['signed-out', 'not-installed', 'needs-update'].includes(e.kind)) break;
        }
      }
      return { 바뀐장, failed, ...await this.rebuildSafe(setDir) };
    } finally { this.current = null; }
  }

  running(): boolean { return this.current !== null; }
  cancel(): void { this.current?.abort(); }

  async startRun(setDir: string, opts: { pages?: number[]; force?: boolean }, onProgress: (e: ProgressEvent) => void): Promise<RunResult> {
    if (this.current) throw new DataError('이미 실행 중입니다. 끝나거나 중단된 뒤 다시 하세요');
    const ac = this.current = new AbortController(); // 확인·목록 읽기(await) 전에 잡아 두어야 동시에 두 번 시작하지 못한다
    try {
      const { key } = await this.confirmedSet(setDir);
      const pages = opts.pages ?? await listPages(setDir);
      if (!pages.length) throw new DataError('pages 폴더에 답안지 그림이 없습니다. 답안지 PDF를 먼저 올리세요');
      const r = await transcribeSet(await this.provider(), setDir, key, await loadRules(), pages, ac.signal, { force: opts.force, onProgress, effort: await this.effort() });
      const result: RunResult = { ...r };
      try { result.엑셀 = (await rebuildResult(setDir, await this.roster(), { version: this.deps.version })).엑셀; }
      catch (e) { result.엑셀오류 = e instanceof Error ? e.message : String(e); }
      return result;
    } finally { this.current = null; }
  }
}
