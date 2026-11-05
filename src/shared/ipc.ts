import type { AnswerKey, Transcript } from '../core/types.js';

export type Rotation = 0 | 90 | 180 | 270;
export interface Profile { id: string; 이름: string; 종류: 'cli' | 'api'; cliPath?: string; configDir?: string }
export interface Settings { 학기폴더: string | null; 명단: string | null; 기본회전: Rotation; 프로필: Profile[]; 사용중: string | null }
export interface SecretView { 저장됨: boolean; 끝4자?: string; 열림?: boolean }   // 열림 false = 봉인은 있으나 이 PC에서 못 풀어 다시 입력 필요
export interface CliStatusView { installed: boolean; version?: string; tooOld?: boolean; loggedIn?: boolean; subscriptionType?: string; configDir?: string; command?: string }
export interface SetInfo { 폴더: string; key: AnswerKey; 쪽수: number; 전사수: number }
export interface SetData { 폴더: string; key: AnswerKey; transcripts: Transcript[]; pages: number[]; 명단있음: boolean }
export interface ProgressEvent { page: number; done: number; total: number; inputTokens?: number; outputTokens?: number; error?: string }
export interface RunResult { ok: number[]; failed: { page: number; error: string }[]; skipped: number[]; 엑셀?: string; 엑셀오류?: string }
export interface KeyDraftResult { 정량: AnswerKey['정량']; 정성: AnswerKey['정성']; 주의: string[] }
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type ExternalLink = 'install' | 'privacy';

export const CHANNELS = {
  getSettings: 'settings:get', saveSettings: 'settings:save', pickFolder: 'dialog:folder', pickFile: 'dialog:file', openExternal: 'shell:external', revealPath: 'shell:reveal', version: 'app:version',
  secretView: 'secret:view', secretSet: 'secret:set', secretClear: 'secret:clear', secretTest: 'secret:test',
  cliStatus: 'cli:status', cliLogin: 'cli:login',
  listSets: 'set:list', createSet: 'set:create', readSet: 'set:read', saveKey: 'set:save-key', importKey: 'set:import-key', exportKey: 'set:export-key', attachSource: 'set:attach-source', readSourceText: 'set:source-text',
  draftKey: 'ai:draft-key', tryPage: 'ai:try-page', startRun: 'run:start', cancelRun: 'run:cancel', progress: 'run:progress', addPages: 'pages:add',
  saveTranscript: 'review:save', buildResult: 'review:build-result', buildCumulative: 'review:build-cumulative',
} as const;

/** preload가 렌더러에 노출하는 전부. 렌더러는 이것만 안다. */
export interface GeulnunApi {
  version(): Promise<string>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  pickFolder(): Promise<string | null>;
  pickFile(kind: 'roster' | 'exe' | 'json'): Promise<string | null>;
  openExternal(link: ExternalLink): Promise<void>;
  revealPath(p: string): Promise<void>;
  secretView(profileId: string): Promise<SecretView>;
  secretSet(profileId: string, key: string): Promise<SecretView>;
  secretClear(profileId: string): Promise<void>;
  secretTest(profileId: string): Promise<{ ok: boolean; message: string }>;
  cliStatus(profileId: string): Promise<CliStatusView>;
  cliLogin(profileId: string): Promise<{ ok: boolean; message?: string }>;
  listSets(): Promise<SetInfo[]>;
  createSet(key: AnswerKey): Promise<SetInfo>;
  readSet(폴더: string): Promise<SetData>;
  saveKey(폴더: string, key: AnswerKey): Promise<AnswerKey>;
  importKey(): Promise<AnswerKey | null>;
  exportKey(폴더: string): Promise<string | null>;
  attachSource(폴더: string): Promise<string | null>;       // PDF를 세트/원본/에 복사, 파일 이름 반환
  readSourceText(폴더: string): Promise<string>;            // 원본/*.txt 가 있으면 그 글(붙여넣은 지문 저장용)
  draftKey(input: { 글: string; 문제: string; 지문?: string }): Promise<KeyDraftResult>;
  tryPage(폴더: string, jpeg: ArrayBuffer): Promise<Transcript>;
  startRun(폴더: string, opts: { pages?: number[]; force?: boolean }): Promise<RunResult>;
  cancelRun(): Promise<void>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  addPages(폴더: string, jpegs: ArrayBuffer[]): Promise<number[]>;
  saveTranscript(폴더: string, t: Transcript): Promise<{ 엑셀?: string; 엑셀오류?: string }>;
  buildResult(폴더: string): Promise<{ 엑셀: string }>;
  buildCumulative(): Promise<{ 파일: string[] }>;
}
