import { existsSync } from 'node:fs';
import path from 'node:path';
import { isConfirmed } from '../core/key.js';
import { readRoster } from '../core/roster.js';
import { loadSet, listPages } from '../core/setio.js';
import { DataError, type Student, type Transcript } from '../core/types.js';
import { ApiProvider, classifyApiError } from '../engine/api.js';
import { CliProvider } from '../engine/cli.js';
import { childEnv } from '../engine/env.js';
import { draftKey, type KeyDraftInput } from '../engine/keydraft.js';
import { EngineError, userFacingMessage, type TranscribeProvider } from '../engine/provider.js';
import { loadRules } from '../engine/rules.js';
import { claudeStatus, locateClaude } from '../engine/status.js';
import { transcribePage, transcribeSet } from '../engine/transcribe.js';
import type { CliStatusView, KeyDraftResult, Profile, ProgressEvent, RunResult } from '../shared/ipc.js';
import { openLogin } from './launch.js';
import { rebuildResult } from './results.js';
import type { SecretStore } from './secrets.js';
import type { SettingsStore } from './settings.js';

export interface BridgeDeps { settings: SettingsStore; secrets: SecretStore; version: string; env?: NodeJS.ProcessEnv }

export class EngineBridge {
  private current: AbortController | null = null;
  constructor(private readonly deps: BridgeDeps) {}
  private get env() { return this.deps.env ?? process.env; }

  async profile(id?: string): Promise<Profile> {
    const s = await this.deps.settings.load();
    const p = s.프로필.find(x => x.id === (id ?? s.사용중));
    if (!p) throw new DataError('사용할 AI 프로필이 없습니다. 설정에서 고르세요');
    return p;
  }

  private cliEnv(p: Profile): NodeJS.ProcessEnv { return childEnv(this.env, { configDir: p.configDir }); }

  async provider(id?: string): Promise<TranscribeProvider> {
    const p = await this.profile(id);
    if (p.종류 === 'cli') return new CliProvider({ program: locateClaude(this.env, existsSync, p.cliPath), env: this.cliEnv(p) });
    const apiKey = await this.deps.secrets.open(p.id);
    if (!apiKey) throw new EngineError('signed-out', `프로필 '${p.이름}'에 API 키가 없습니다. 설정에서 입력해 주세요`);
    return new ApiProvider({ apiKey });
  }

  async cliStatus(id: string): Promise<CliStatusView> {
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
    } catch (e) { return { ok: false, message: userFacingMessage(classifyApiError(e)) }; }
  }

  async draftKey(input: KeyDraftInput): Promise<KeyDraftResult> {
    const ac = new AbortController();
    return draftKey(await this.provider(), input, ac.signal);
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
    const ac = new AbortController();
    const r = await transcribePage(await this.provider(), { imageJpegBase64: jpeg.toString('base64'), key, rules: await loadRules(), page: 0 }, ac.signal);
    return r.transcript;
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
      const r = await transcribeSet(await this.provider(), setDir, key, await loadRules(), pages, ac.signal, { force: opts.force, onProgress });
      const result: RunResult = { ...r };
      try { result.엑셀 = (await rebuildResult(setDir, await this.roster(), { version: this.deps.version })).엑셀; }
      catch (e) { result.엑셀오류 = e instanceof Error ? e.message : String(e); }
      return result;
    } finally { this.current = null; }
  }
}
