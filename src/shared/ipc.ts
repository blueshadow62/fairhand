import type { AnswerKey, MaskRect, Student, Transcript, UploadRecord } from '../core/types.js';

export type Rotation = 0 | 90 | 180 | 270;
/** 장 그림을 불러오는 주소(메인의 프로토콜 처리와 렌더러 img.src가 같은 규칙) */
export const IMG_SCHEME = 'geulnun-img';
export const imageUrl = (폴더: string, page: number): string => `${IMG_SCHEME}://set/${encodeURIComponent(폴더)}/p${String(page).padStart(2, '0')}.jpg`;
/** 저장할 때 만든 작은 그림(pages/thumbs/). 없는 세트(옛 세트·샘플)는 img.onerror에서 원본으로 */
export const thumbUrl = (폴더: string, page: number): string => `${IMG_SCHEME}://set/${encodeURIComponent(폴더)}/thumbs/p${String(page).padStart(2, '0')}.jpg`;
/** 전사에 쓸 모델과 노력 단계. 둘 다 low~max를 지원한다(Opus 5.5 기본 medium, Sonnet 5.5 기본 high). 글눈 기본은 Opus 5.5·medium(23장 비교에서 높음과 같은 정확도, 더 빠름) */
export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export type ModelId = typeof MODELS[number];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = typeof EFFORTS[number];
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5';
export const DEFAULT_EFFORT: EffortLevel = 'medium';
/** 종류: cli = Claude Code(구독), api = Anthropic API 키, codex = Codex(ChatGPT 구독).
 *  모델: cli·api는 MODELS 중 하나, codex는 Codex 모델 이름(비우면 Codex 기본 모델). configDir: cli는 CLAUDE_CONFIG_DIR, codex는 CODEX_HOME */
export interface Profile { id: string; 이름: string; 종류: 'cli' | 'api' | 'codex'; cliPath?: string; configDir?: string; 모델?: ModelId | string; 노력?: EffortLevel }
export type Language = 'ko' | 'en';
/** 화면 색. 값은 styles.css의 :root[data-theme]와 짝이다. 맨 앞이 기본 */
export const THEMES = ['sky', 'dawn', 'dark'] as const;
export type Theme = typeof THEMES[number];
export interface Settings { 학기폴더: string | null; 명단: string | null; 기본회전: Rotation; 프로필: Profile[]; 사용중: string | null; 언어: Language; 자동업데이트: boolean; 화면색: Theme }
export interface SecretView { 저장됨: boolean; 끝4자?: string; 열림?: boolean }   // 열림 false = 봉인은 있으나 이 PC에서 못 풀어 다시 입력 필요
export interface CliStatusView { installed: boolean; version?: string; tooOld?: boolean; loggedIn?: boolean; subscriptionType?: string; configDir?: string; command?: string; minVersion?: string }
export interface TrashEntry { id: string; 원래이름: string; 삭제일시: string; 글?: string; 학년?: number; 반?: number[]; 쪽수?: number; 전사수?: number }
export interface SetInfo { 폴더: string; key: AnswerKey; 쪽수: number; 전사수: number }
export interface SetData { 폴더: string; key: AnswerKey; transcripts: Transcript[]; pages: number[]; 올린파일: UploadRecord[]; 명단있음: boolean; 명단: Student[] | null /* 대상 학년·반만 */ }
export interface ProgressEvent { page: number; done: number; total: number; inputTokens?: number; outputTokens?: number; error?: string }
export interface RunResult { ok: number[]; failed: { page: number; error: string }[]; skipped: number[]; 엑셀?: string; 엑셀오류?: string }
export interface KeyDraftResult { 정량: AnswerKey['정량']; 정성: AnswerKey['정성']; 주의: string[] }
export interface RejudgeResult { 바뀐장: { page: number; 변경: string[] }[]; 엑셀?: string; 엑셀오류?: string }
export interface JudgeResult extends RejudgeResult { failed: { page: number; error: string }[] }
/** 자동 업데이트 상태. error는 설정 화면의 한 줄과 로그에만 보인다(창을 띄우지 않음) */
export type UpdateStatus =
  | { kind: 'disabled'; reason: 'dev' | 'off' } | { kind: 'idle' } | { kind: 'checking' } | { kind: 'none'; version: string }
  | { kind: 'available'; version: string } | { kind: 'downloading'; percent: number } | { kind: 'downloaded'; version: string } | { kind: 'error'; message: string };
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type ExternalLink = 'install' | 'codexInstall' | 'privacy' | 'guide';
export type LeaveChoice = 'save' | 'discard' | 'stay';

export const CHANNELS = {
  getSettings: 'settings:get', saveSettings: 'settings:save', pickFolder: 'dialog:folder', pickFile: 'dialog:file', askLeave: 'dialog:leave', openExternal: 'shell:external', revealPath: 'shell:reveal', version: 'app:version',
  secretView: 'secret:view', secretSet: 'secret:set', secretClear: 'secret:clear', secretTest: 'secret:test',
  cliStatus: 'cli:status', cliLogin: 'cli:login',
  listSets: 'set:list', createSet: 'set:create', deleteSet: 'set:delete', listTrash: 'trash:list', restoreSet: 'trash:restore', purgeSet: 'trash:purge', readSet: 'set:read', saveKey: 'set:save-key', importKey: 'set:import-key', exportKey: 'set:export-key', attachSource: 'set:attach-source', readSourceText: 'set:source-text',
  draftKey: 'ai:draft-key', reviseKey: 'ai:revise-key', extractText: 'file:extract-text', tryPage: 'ai:try-page', startRun: 'run:start', cancelRun: 'run:cancel', progress: 'run:progress', addPages: 'pages:add', deletePage: 'pages:delete', recordUpload: 'pages:record-upload',
  saveTranscript: 'review:save', buildResult: 'review:build-result', buildCumulative: 'review:build-cumulative',
  setNameMask: 'set:name-mask', matchRoster: 'roster:match',
  applyCase: 'case:apply', removeCase: 'case:remove', rejudge: 'judge:rule', judgeWithModel: 'judge:model',
  updateStatus: 'update:status', checkUpdate: 'update:check', installUpdate: 'update:install',
  createSampleSet: 'sample:create', makeDefaultSemester: 'semester:make-default',
} as const;

/** preload가 렌더러에 노출하는 전부. 렌더러는 이것만 안다. */
export interface GeulnunApi {
  version(): Promise<string>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  pickFolder(): Promise<string | null>;
  pickFile(kind: 'roster' | 'exe' | 'json'): Promise<string | null>;
  askLeave(): Promise<LeaveChoice>;                 // 저장하지 않은 변경이 있을 때: 저장 후 나가기/저장하지 않고 나가기/나가지 않기
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
  deleteSet(폴더: string): Promise<void>;            // 세트 폴더를 학기 폴더 안 .휴지통으로(목록에서 되살리거나 영구 삭제)
  listTrash(): Promise<TrashEntry[]>;
  restoreSet(id: string): Promise<string>;           // 되살린 폴더 이름
  purgeSet(id: string): Promise<void>;               // 영구 삭제
  readSet(폴더: string): Promise<SetData>;
  saveKey(폴더: string, key: AnswerKey): Promise<AnswerKey>;
  importKey(): Promise<AnswerKey | null>;
  exportKey(폴더: string): Promise<string | null>;
  attachSource(폴더: string): Promise<string | null>;       // PDF를 세트/원본/에 복사, 파일 이름 반환
  readSourceText(폴더: string): Promise<string>;            // 원본/*.txt 가 있으면 그 글(붙여넣은 지문 저장용)
  draftKey(input: { 글: string; 문제: string; 지문?: string; 문제그림?: ArrayBuffer[]; 지문그림?: ArrayBuffer[] }): Promise<KeyDraftResult>;   // 그림은 JPEG
  extractText(name: string, data: ArrayBuffer): Promise<string>;
  reviseKey(input: { 글: string; 문제: string; 지문?: string; 문제그림?: ArrayBuffer[]; 지문그림?: ArrayBuffer[]; 현재: { 정량: AnswerKey['정량']; 정성: AnswerKey['정성'] }; 지시: string; 앞선지시?: string[] }): Promise<KeyDraftResult>;   // txt·hwpx에서 글만(hwp·docx는 안내 오류)
  tryPage(폴더: string, jpeg: ArrayBuffer): Promise<Transcript>;
  startRun(폴더: string, opts: { pages?: number[]; force?: boolean }): Promise<RunResult>;
  cancelRun(): Promise<void>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  addPages(폴더: string, jpegs: ArrayBuffer[], thumbs?: ArrayBuffer[]): Promise<number[]>;   // thumbs[i]는 jpegs[i]의 작은 그림
  deletePage(폴더: string, page: number): Promise<{ 엑셀?: string; 엑셀오류?: string }>;   // 그림+전사 삭제, 남은 전사로 엑셀 다시
  recordUpload(폴더: string, r: Omit<UploadRecord, '일시'>): Promise<void>;
  saveTranscript(폴더: string, t: Transcript): Promise<{ 엑셀?: string; 엑셀오류?: string }>;
  buildResult(폴더: string): Promise<{ 엑셀: string }>;
  buildCumulative(): Promise<{ 파일: string[] }>;
  /** 사례를 기록하고 같은 단위·같은 답의 장을 결정적으로 다시 판정한다(검토 화면, 사례로 기록이 켜져 있을 때) */
  applyCase(폴더: string, c: { 단위: string; 답: string; 판정: 'O' | 'X'; page: number }): Promise<RejudgeResult>;
  removeCase(폴더: string, 단위: string, 답: string): Promise<AnswerKey>;
  /** 이름 칸 가리기 설정. null이면 끈다 */
  setNameMask(폴더: string, rect: MaskRect | null): Promise<AnswerKey>;
  /** 이미 전사한 장을 명단과 맞춘다(이 PC 안에서만) */
  matchRoster(폴더: string): Promise<RejudgeResult>;
  /** 결정적 재판정(모델 호출 없음) */
  rejudge(폴더: string): Promise<RejudgeResult>;
  /** 글만 보내는 모델 재판정. 진행은 onProgress */
  judgeWithModel(폴더: string, opts: { pages?: number[] }): Promise<JudgeResult>;
  updateStatus(): Promise<UpdateStatus>;
  /** 자동업데이트가 꺼져 있거나 개발 실행이면 아무것도 하지 않는다 */
  checkUpdate(): Promise<void>;
  /** 받아 둔 새 버전으로 다시 시작 */
  installUpdate(): Promise<void>;
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
  /** 학기 폴더에 샘플 세트(인쇄 글자 답안지 3장, 전사 포함)를 넣는다. 이미 있으면 ' (2)' */
  createSampleSet(): Promise<{ 폴더: string }>;
  /** 문서\글눈\YYYY-N학기를 만들고 학기 폴더로 저장한다. 만든 경로를 돌려준다 */
  makeDefaultSemester(): Promise<string>;
}
