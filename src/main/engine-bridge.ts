import { existsSync } from 'node:fs';
import path from 'node:path';
import { caseRequest, caseRevertRequest, planApplyCase, planCaseRevert } from '../core/cases.js';
import { isConfirmed, parseKey } from '../core/key.js';
import { addCase, rejudgeAll, removeCase, type Change } from '../core/rejudge.js';
import { matchRoster, readRoster } from '../core/roster.js';
import { loadSet, listPages, saveTranscript } from '../core/setio.js';
import { DataError, type AnswerKey, type MaskRect, type QtyUnit, type Student, type Transcript } from '../core/types.js';
import { casesOnChangedAnswers, mapUnits, remapCases, remapRegions } from '../core/unit-map.js';
import { planUnitResults, uncheckChanged, unitResultsRequest } from '../core/unit-results.js';
import { ApiProvider, classifyApiError } from '../engine/api.js';
import { CliProvider } from '../engine/cli.js';
import { CODEX, CodexProvider, codexEnv, codexStatus, locateCodex } from '../engine/codex.js';
import { childEnv } from '../engine/env.js';
import { GEMINI, GeminiProvider, testGeminiKey } from '../engine/gemini.js';
import { OPENAI, OpenAIProvider, testOpenAIKey } from '../engine/openai.js';
import { judgePage } from '../engine/judge.js';
import { draftKey, reviseKeyDraft, type KeyDraftInput, type KeyReviseInput } from '../engine/keydraft.js';
import { imageToSend, type JpegMasker } from '../engine/privacy.js';
import { EngineError, userFacingMessage, type Effort, type TranscribeProvider } from '../engine/provider.js';
import { loadRules } from '../engine/rules.js';
import { claudeStatus, locateClaude } from '../engine/status.js';
import { transcribePage, transcribeSet } from '../engine/transcribe.js';
import { DEFAULT_EFFORT, DEFAULT_MODEL, type CaseResult, type CaseRevertResult, type CliStatusView, type JudgeResult, type KeyDraftResult, type Profile, type ProgressEvent, type RejudgeResult, type RunResult, type SaveKeyResult, type UnitResultsResult } from '../shared/ipc.js';
import { addRun, runMeter, statKey, type RunStat } from '../shared/estimate.js';
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

export interface BridgeDeps { settings: SettingsStore; secrets: SecretStore; version: string; env?: NodeJS.ProcessEnv; maskJpeg?: JpegMasker }

export class EngineBridge {
  private current: AbortController | null = null;
  constructor(private readonly deps: BridgeDeps) {}
  private get env() { return this.deps.env ?? process.env; }

  /** 사용 중 프로필의 노력 단계(없으면 high) */
  async effort(): Promise<Effort> { return (await this.profile()).노력 ?? DEFAULT_EFFORT; }

  /** 설정 '답 위치 받기': 전사할 때 정량 단위마다 답의 세로 위치도 받는다(전사와 시험 한 장이 같은 지시문을 쓰게) */
  private async positions(): Promise<boolean> { return (await this.deps.settings.load()).답위치; }

  async profile(id?: string): Promise<Profile> {
    const s = await this.deps.settings.load();
    const p = s.프로필.find(x => x.id === (id ?? s.사용중));
    if (!p) throw new DataError('사용할 AI 프로필이 없습니다. 설정에서 고르세요');
    return p;
  }

  private cliEnv(p: Profile): NodeJS.ProcessEnv {
    return p.종류 === 'codex' ? codexEnv(this.env, { configDir: p.configDir }) : childEnv(this.env, { configDir: p.configDir });
  }

  async provider(id?: string): Promise<TranscribeProvider> {
    const p = await this.profile(id);
    if (p.종류 === 'cli') return new CliProvider({ program: locateClaude(this.env, existsSync, p.cliPath), env: this.cliEnv(p), model: p.모델 ?? DEFAULT_MODEL });
    if (p.종류 === 'codex') return new CodexProvider({ program: locateCodex(this.env, existsSync, p.cliPath), env: this.cliEnv(p), model: p.모델 });
    const apiKey = await this.deps.secrets.open(p.id);
    if (p.종류 === 'gemini') {
      if (!apiKey) throw new EngineError('signed-out', `프로필 '${p.이름}'에 API 키가 없습니다`, undefined, GEMINI);
      return new GeminiProvider({ apiKey, model: p.모델 });
    }
    if (p.종류 === 'openai') {
      if (!apiKey) throw new EngineError('signed-out', `프로필 '${p.이름}'에 API 키가 없습니다`, undefined, OPENAI);
      return new OpenAIProvider({ apiKey, model: p.모델 });
    }
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
    if (p.종류 === 'codex') {
      const program = locateCodex(this.env, existsSync, p.cliPath);
      const s = await codexStatus(undefined, () => program, this.cliEnv(p));
      // npm 설치면 실행 파일이 node.exe라 사용자가 알아볼 codex.js 경로를 보인다
      return { ...s, configDir: p.configDir, command: program ? (program.prefixArgs[0] ?? program.command) : undefined };
    }
    if (p.종류 !== 'cli') throw new DataError('CLI 프로필이 아닙니다');
    const program = locateClaude(this.env, existsSync, p.cliPath);
    const s = await claudeStatus(undefined, () => program, this.cliEnv(p));
    return { ...s, configDir: p.configDir, command: program?.command };
  }

  async openLogin(id: string): Promise<{ ok: boolean; message?: string }> {
    const p = await this.profile(id);
    if (p.종류 === 'codex') {
      const program = locateCodex(this.env, existsSync, p.cliPath);
      if (!program) return { ok: false, message: `${CODEX}가 설치되어 있지 않습니다. 설치 안내를 보세요` };
      return openLogin(program, this.cliEnv(p), undefined, undefined, ['login']);
    }
    const program = locateClaude(this.env, existsSync, p.cliPath);
    if (!program) return { ok: false, message: 'Claude Code가 설치되어 있지 않습니다. 설치 안내를 보세요' };
    return openLogin(program, this.cliEnv(p));
  }

  async testApiKey(id: string): Promise<{ ok: boolean; message: string }> {
    const apiKey = await this.deps.secrets.open(id);
    if (!apiKey) return { ok: false, message: '저장된 키가 없거나 이 PC에서 열 수 없습니다' };
    const p = await this.profile(id).catch(() => null); // 키만 있고 프로필이 아직 저장 전이면 Anthropic 키로 본다(이전 동작)
    if (p?.종류 === 'gemini') return testGeminiKey(apiKey, p.모델);
    if (p?.종류 === 'openai') return testOpenAIKey(apiKey, p.모델);
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
  /** 전사 중 대조용. 명단 파일이 깨졌다고 전사를 막지는 않는다(엑셀 만들 때 오류가 보인다) */
  private rosterOrNull(): Promise<Student[] | null> { return this.roster().catch(() => null); }

  private async confirmedSet(setDir: string) {
    const loaded = await loadSet(setDir);
    if (!isConfirmed(loaded.key)) throw new DataError('정답표가 아직 확인되지 않았습니다. 문항 설정에서 확인 표시를 한 뒤 채점하세요');
    return loaded;
  }

  async tryPage(setDir: string, jpeg: Buffer): Promise<Transcript> {
    const { key } = await this.confirmedSet(setDir);
    const image = (await imageToSend(jpeg, key, this.deps.maskJpeg)).toString('base64');
    return this.exclusive(async signal => {
      const provider = await this.provider(), profile = await this.profile(), rules = await loadRules(), effort = await this.effort(), 위치 = await this.positions();
      const meter = runMeter(); // 시험 한 장도 같은 일이라 예상 기록에 더한다(전사 시작 전에 예상을 보이려고 먼저 해 보는 경우가 많다)
      // 저장하지 않는 시험이라 장 번호는 쓰이지 않지만, 전사 검사가 1 이상을 요구한다(0으로 물으면 모델이 0을 돌려줘 늘 실패했다)
      const { transcript, inputTokens, outputTokens } = await transcribePage(provider, { imageJpegBase64: image, key, rules, page: 1, effort, 위치 }, signal);
      meter.add({ inputTokens, outputTokens });
      await this.recordRun(profile, meter.stat);
      const roster = await this.rosterOrNull();
      return roster ? matchRoster(transcript, key, roster).transcript : transcript;
    });
  }

  /** 다음 전사의 예상 시간·비용에 쓸 기록을 설정에 더한다(AI 설정마다). 예상에만 쓰므로 적지 못해도 전사 결과는 그대로 둔다 */
  private async recordRun(profile: Profile, run: RunStat): Promise<void> {
    if (run.장 <= 0) return;
    try {
      const k = statKey(profile), s = await this.deps.settings.load();
      await this.deps.settings.save({ 전사기록: { ...s.전사기록, [k]: addRun(s.전사기록?.[k], run) } });
    } catch { /* 예상 기록을 못 적은 것은 알리지 않는다 */ }
  }

  /** 세트 폴더의 엑셀을 다시 만든다. 실패는 메시지로만 */
  private async rebuildSafe(setDir: string): Promise<{ 엑셀?: string; 엑셀오류?: string }> {
    try { return await rebuildResult(setDir, await this.roster(), { version: this.deps.version }); }
    catch (e) { return { 엑셀오류: e instanceof Error ? e.message : String(e) }; }
  }

  /** 정답표 저장. 채점 내용이 바뀌었으면 확인을 지운다(화면만 믿지 않는다). 채점규칙·사례만 바뀐 저장은 확인 유지 */
  async saveKey(setDir: string, raw: unknown): Promise<SaveKeyResult> {
    // 문항 설정 화면은 정답표를 새로 조립해 저장한다. 그 저장으로 가림이 꺼져 이름이 나가면 안 되므로 setNameMask로만 바꾼다.
    // 문항별 검토의 신원 영역·답 칸도 그 화면이 모르는 칸이라 같은 까닭으로 setIdentityMask·setAnswerRegion으로만 바꾼다. 그래서 이 칸들은 받지 않는다.
    // 정답표에서 지운 단위를 가리키는 사례는 검사 전에 버린다(그대로 두면 단위를 지운 저장이 막힌다)
    const { 이름가림: _name, 신원가림: _identity, 답영역: _regions, ...o } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const ids = new Set(Array.isArray(o.정량) ? o.정량.map((u: any) => u?.id) : []);
    if (Array.isArray(o.사례)) o.사례 = o.사례.filter((c: any) => ids.has(c?.단위));
    const key = parseKey(JSON.stringify(o), '정답표.json');
    let old: AnswerKey | null = null;
    try { old = (await loadSet(setDir)).key; } catch { /* 없거나 깨진 정답표는 새로 쓴다 */ }
    if (old && contentSig(old) !== contentSig(key) && key.확인?.완료) key.확인 = { 완료: false };
    if (old?.이름가림) key.이름가림 = old.이름가림;
    if (old?.신원가림) key.신원가림 = old.신원가림;
    // 문항 설정은 단위 id를 행 순서로 다시 매긴다. 옛 id로 적힌 답 칸·사례는 같은 뜻의 새 id로 옮기고, 옮길 곳이 없으면 지운다.
    // 화면은 세트를 열 때 읽은 사례를 보낸다. 그사이 검토에서 쌓인 사례가 지워지지 않게 파일의 사례를 기준으로 합친다
    const map = mapUnits(old ?? { 정량: [], 정성: [] }, key);
    const regions = remapRegions(old?.답영역, map);
    if (regions.답영역) key.답영역 = regions.답영역;
    const cases = remapCases(old?.사례, key.사례, map, key);
    if (cases.사례.length) key.사례 = cases.사례; else delete key.사례;
    await saveKeyFile(setDir, key);
    return { key, 정리: { 사례: { 옮김: cases.옮김, 지움: cases.지움 }, 답칸: { 옮김: regions.옮김, 지움: regions.지움 } },
      정답바뀐사례: old ? casesOnChangedAnswers(old, key, map) : [] };
  }

  /** 문항별 검토 그림 보기의 신원 영역. null이면 기본 영역으로. 화면에 칠하는 데만 쓰고 AI에는 보내지 않아 전사 중에도 바꾼다 */
  async setIdentityMask(setDir: string, rect: MaskRect | null): Promise<AnswerKey> {
    const { key } = await loadSet(setDir);
    delete key.신원가림;
    const next = parseKey(JSON.stringify(rect ? { ...key, 신원가림: rect } : key), '신원 영역 설정');
    await saveKeyFile(setDir, next);
    return next;
  }

  /** 문항별 검토에서 손글씨를 잘라 보일 단위의 답 칸. null이면 그 단위의 영역을 지운다. 화면에만 쓰고 AI에는 보내지 않아 전사 중에도 바꾼다 */
  async setAnswerRegion(setDir: string, 단위: unknown, rect: MaskRect | null): Promise<AnswerKey> {
    if (typeof 단위 !== 'string' || !단위) throw new DataError('단위가 없습니다');
    const { key } = await loadSet(setDir);
    if (![...key.정량, ...key.정성].some(u => u.id === 단위)) throw new DataError(`정답표에 단위 ${단위}가 없습니다`);
    const { 답영역: before = {}, ...rest } = key;
    const regions = { ...before };
    if (rect) regions[단위] = rect; else delete regions[단위];
    const next = parseKey(JSON.stringify(Object.keys(regions).length ? { ...rest, 답영역: regions } : rest), '답 칸 설정');
    await saveKeyFile(setDir, next);
    return next;
  }

  /** 이름 칸 가리기 설정. null이면 끈다 */
  async setNameMask(setDir: string, rect: MaskRect | null): Promise<AnswerKey> {
    if (this.current) throw new DataError('전사가 실행 중입니다. 끝나거나 중단된 뒤 바꾸세요');
    const { key } = await loadSet(setDir);
    delete key.이름가림;
    const next = parseKey(JSON.stringify(rect ? { ...key, 이름가림: rect } : key), '이름 칸 가리기 설정');
    await saveKeyFile(setDir, next);
    return next;
  }

  /** 이미 전사한 장을 명단과 맞춘다. 선생님이 확인 완료한 장은 건드리지 않는다 */
  async matchRosterAll(setDir: string): Promise<RejudgeResult> {
    if (this.current) throw new DataError('전사가 실행 중입니다. 끝나거나 중단된 뒤 대조하세요');
    const roster = await this.roster();
    if (!roster) throw new DataError('설정에서 명단을 먼저 넣어 주세요');
    const { key, transcripts } = await loadSet(setDir);
    const 바뀐장: RejudgeResult['바뀐장'] = [];
    for (const t of transcripts) {
      if (t.확인완료) continue;
      const r = matchRoster(t, key, roster);
      if (r.변경) { await saveTranscript(setDir, r.transcript); 바뀐장.push({ page: t.page, 변경: [r.변경] }); }
    }
    return { 바뀐장, ...await this.rebuildSafe(setDir) };
  }

  /**
   * 다시 판정(규칙·모델)으로 바뀐 장을 저장한다. 선생님이 보지 않은 판정이 '확인됨'으로 남지 않게, 이미 확인한 단위가 바뀌었으면
   * 그 확인을 풀고 장 번호를 다시확인에 더한다. 사례 기록·문항별 묶음 판정은 선생님이 정한 판정이라 이 길을 쓰지 않는다
   */
  private async saveRejudged(setDir: string, key: AnswerKey, t: Transcript, changes: Change[], 다시확인: number[]): Promise<void> {
    const u = uncheckChanged(t, key, changes.map(c => c.단위));
    await saveTranscript(setDir, u.transcript);
    if (u.다시확인) 다시확인.push(t.page);
  }

  /** 결정적 재판정을 돌려 바뀐 장만 저장하고 엑셀을 다시 만든다 */
  private async rejudgeWith(setDir: string, key: AnswerKey, transcripts: Transcript[]): Promise<RejudgeResult> {
    const r = rejudgeAll(key, transcripts);
    const 다시확인: number[] = [];
    for (const c of r.changed) await this.saveRejudged(setDir, key, r.transcripts.find(t => t.page === c.page)!, c.changes, 다시확인);
    return { 바뀐장: r.changed.map(c => ({ page: c.page, 변경: changeText(c.changes) })), 다시확인, ...await this.rebuildSafe(setDir) };
  }

  async rejudge(setDir: string): Promise<RejudgeResult> {
    const { key, transcripts } = await loadSet(setDir);
    return this.rejudgeWith(setDir, key, transcripts);
  }

  /**
   * 답안지별 검토의 사례 기록. 같은 단위에 같은 답을 쓴 장만 바꾸고(확인 창에 미리 보인 장과 같게), 바뀐 판정을 구조로 돌려준다.
   * 엑셀은 바뀐 장이 있을 때만 다시 만든다(사례는 엑셀에 나오지 않는다)
   */
  async applyCase(setDir: string, raw: unknown, now: () => Date = () => new Date()): Promise<CaseResult> {
    const c = caseRequest(raw);
    const { key, transcripts } = await loadSet(setDir);
    const plan = planApplyCase(key, transcripts, c, now());
    await saveKeyFile(setDir, plan.key); // 사례는 확인을 지우지 않는다
    for (const t of plan.쓸전사) await saveTranscript(setDir, t);
    return { 바뀐장: plan.변경.map(ch => ({ page: ch.page, 변경: [`${ch.단위} ${ch.이전}→${ch.이후}`] })), 판정변경: plan.변경,
      ...(plan.이전사례 ? { 이전사례: plan.이전사례 } : {}), ...(plan.변경.length ? await this.rebuildSafe(setDir) : {}) };
  }

  /**
   * 방금 기록한 사례 되돌리기: 사례를 지우고(바꿔 쓴 사례는 되살리고) 함께 바뀐 장의 판정을 이전 값으로. 그사이 바뀐 것은 그대로 둔다.
   * 정답표를 먼저 쓴다(사례 기록과 같은 순서). 엑셀은 판정을 다 돌린 뒤 한 번만
   */
  async revertCase(setDir: string, raw: unknown): Promise<CaseRevertResult> {
    const req = caseRevertRequest(raw);
    const { key, transcripts } = await loadSet(setDir);
    const plan = planCaseRevert(key, transcripts, req);
    if (plan.key) await saveKeyFile(setDir, plan.key);
    let written = 0;
    for (const t of plan.쓸전사) {
      try { await saveTranscript(setDir, t); written++; }
      catch (e) {
        if (written) await this.rebuildSafe(setDir); // 이미 돌린 장과 엑셀이 어긋나지 않게
        throw new DataError(`${plan.쓸전사.length}장 중 ${written}장만 되돌렸습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { 사례: plan.사례, 복원: plan.복원, 건너뜀: plan.건너뜀, ...(written ? await this.rebuildSafe(setDir) : {}) };
  }

  /**
   * 문항별 검토: 한 단위의 여러 장 판정·응답을 정하고 확인 표시를 한다. 그 단위·그 장만 쓰고, 엑셀은 판정이 바뀌었을 때 다 쓴 뒤 한 번만.
   * 사례는 전사를 다 쓴 뒤에 기록한다. 기록이 실패해도 판정은 저장된 채로 알린다
   */
  async setUnitResults(setDir: string, raw: unknown, now: () => Date = () => new Date()): Promise<UnitResultsResult> {
    const req = unitResultsRequest(raw);
    const { key, transcripts } = await loadSet(setDir);
    const plan = planUnitResults(key, transcripts, req, now());
    let written = 0;
    for (const t of plan.쓸전사) {
      try { await saveTranscript(setDir, t); written++; }
      catch (e) {
        if (written) await this.rebuildSafe(setDir); // 이미 쓴 장과 엑셀이 어긋나지 않게
        // 신원을 숨기는 화면에서 보이므로 파일 이름(장 번호)을 빼고 알린다
        const why = (e instanceof Error ? e.message : String(e)).replace(/p\d{2,}\.json(\.tmp)?/g, '전사 파일');
        throw new DataError(`${plan.쓸전사.length}장 중 ${written}장만 저장했습니다: ${why}`);
      }
    }
    let 사례오류: string | undefined;
    if (plan.사례.length) {
      try { let next = key; for (const c of plan.사례) next = addCase(next, c); await saveKeyFile(setDir, next); } // 사례는 확인을 지우지 않는다
      catch (e) { 사례오류 = e instanceof Error ? e.message : String(e); }
    }
    return { 바뀐장수: plan.바뀐장수, 확인장수: plan.확인장수, 사례수: 사례오류 ? 0 : plan.사례.length, ...(사례오류 ? { 사례오류 } : {}),
      ...(plan.바뀐장수 ? await this.rebuildSafe(setDir) : {}) }; // 확인 표시만 바뀐 것은 엑셀에 나오지 않는다
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
      const 바뀐장: RejudgeResult['바뀐장'] = [], failed: JudgeResult['failed'] = [], 다시확인: number[] = [];
      let done = 0;
      for (const t of todo) {
        if (ac.signal.aborted) break;
        try {
          const r = await judgePage(provider, key, rules, t, ac.signal, effort);
          if (r.changes.length) { await this.saveRejudged(setDir, key, r.transcript, r.changes, 다시확인); 바뀐장.push({ page: t.page, 변경: changeText(r.changes) }); }
          onProgress({ page: t.page, done: ++done, total: todo.length, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
        } catch (e) {
          if (e instanceof EngineError && e.kind === 'cancelled') break;
          const error = userFacingMessage(e);
          failed.push({ page: t.page, error });
          onProgress({ page: t.page, done: ++done, total: todo.length, error });
          if (e instanceof EngineError && ['signed-out', 'not-installed', 'needs-update'].includes(e.kind)) break;
        }
      }
      return { 바뀐장, failed, 다시확인, ...await this.rebuildSafe(setDir) };
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
      const provider = await this.provider(), profile = await this.profile(), rules = await loadRules(), effort = await this.effort(), roster = await this.rosterOrNull(), 위치 = await this.positions();
      const meter = runMeter(); // 장마다 걸린 시간·토큰(다음 전사의 예상 시간·비용에 쓴다)
      const r = await transcribeSet(provider, setDir, key, rules, pages, ac.signal, { force: opts.force, onProgress: e => { meter.add(e); onProgress(e); }, effort, maskJpeg: this.deps.maskJpeg, roster, 위치 });
      await this.recordRun(profile, meter.stat);
      const result: RunResult = { ...r };
      try { result.엑셀 = (await rebuildResult(setDir, await this.roster(), { version: this.deps.version })).엑셀; }
      catch (e) { result.엑셀오류 = e instanceof Error ? e.message : String(e); }
      return result;
    } finally { this.current = null; }
  }
}
