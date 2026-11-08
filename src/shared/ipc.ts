import type { CaseChange, CaseRevertRequest } from '../core/cases.js';
import type { AnswerKey, Case, MaskRect, Student, Transcript, UploadRecord } from '../core/types.js';
import type { ChangedAnswerCase } from '../core/unit-map.js';
import type { RunStat } from './estimate.js';
import type { UnitResultsRequest } from '../core/unit-results.js';

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
/** Gemini API 모델(2026-11 Google 모델 목록 기준). 맨 앞이 기본. 이전 세대는 다른 모델로 넘겨지므로 목록에 두지 않는다 */
export const GEMINI_MODELS = ['gemini-4-argon', 'gemini-3.8-flash'] as const;
export const DEFAULT_GEMINI_MODEL: string = GEMINI_MODELS[0];
/** OpenAI API 모델(2026-11 OpenAI 모델 목록 기준, 둘 다 그림 입력·양식 강제·노력 low~max). 맨 앞이 기본(정확), 둘째는 비슷한 결과를 1/5 값에 */
export const OPENAI_MODELS = ['gpt-6-astra', 'gpt-6.1-sol'] as const;
export const DEFAULT_OPENAI_MODEL: string = OPENAI_MODELS[0];
/** 종류: cli = Claude Code(구독), api = Anthropic API 키, codex = Codex(ChatGPT 구독), gemini = Gemini API 키, openai = OpenAI API 키.
 *  모델: cli·api는 MODELS, gemini는 GEMINI_MODELS, openai는 OPENAI_MODELS 중 하나, codex는 Codex 모델 이름(비우면 Codex 기본 모델).
 *  configDir: cli는 CLAUDE_CONFIG_DIR, codex는 CODEX_HOME. API 키(api·gemini·openai)는 설정이 아니라 비밀 저장소에 둔다 */
export interface Profile { id: string; 이름: string; 종류: 'cli' | 'api' | 'codex' | 'gemini' | 'openai'; cliPath?: string; configDir?: string; 모델?: ModelId | string; 노력?: EffortLevel }
export type Language = 'ko' | 'en';
/** 화면 색. 값은 styles.css의 :root[data-theme]와 짝이다. 맨 앞이 기본 */
export const THEMES = ['sky', 'dawn', 'dark'] as const;
export type Theme = typeof THEMES[number];
/**
 * '답 위치 받기'의 기본값. 켜면 모든 세트의 AI 지시문·양식에 위치 칸이 붙으므로, 실제 모델로 정확도·토큰을 잰 뒤에 켤지 정한다.
 * 꺼져 있으면 지시문·양식이 0.2.11과 같다
 */
export const DEFAULT_ANSWER_POSITIONS = false;
/**
 * 전사기록: AI 설정(statKey)마다 최근 전사의 장당 시간·토큰. 채점 실행의 예상 시간·비용에 쓰고, 메인이 전사가 끝날 때 적는다.
 * 답위치: 전사할 때 단위마다 답의 세로 위치도 받는다(답안지별 검토에서 단위를 누르면 그림이 그 자리로)
 */
export interface Settings { 학기폴더: string | null; 명단: string | null; 기본회전: Rotation; 프로필: Profile[]; 사용중: string | null; 언어: Language; 자동업데이트: boolean; 자동설치: boolean; 화면색: Theme; 답위치: boolean; 전사기록?: Record<string, RunStat> }
export interface SecretView { 저장됨: boolean; 끝4자?: string; 열림?: boolean }   // 열림 false = 봉인은 있으나 이 PC에서 못 풀어 다시 입력 필요
export interface CliStatusView { installed: boolean; version?: string; tooOld?: boolean; loggedIn?: boolean; subscriptionType?: string; configDir?: string; command?: string; minVersion?: string }
export interface TrashEntry { id: string; 원래이름: string; 삭제일시: string; 글?: string; 학년?: number; 반?: number[]; 쪽수?: number; 전사수?: number }
/** 세트 목록 한 칸. 전사수: 전사 파일 수, 확인수: 그중 검토에서 확인 완료한 것, 미전사수: 그림은 있는데 전사 파일이 없는 장 */
export interface SetInfo { 폴더: string; key: AnswerKey; 쪽수: number; 전사수: number; 확인수: number; 미전사수: number }
export interface SetData { 폴더: string; key: AnswerKey; transcripts: Transcript[]; pages: number[]; 올린파일: UploadRecord[]; 명단있음: boolean; 명단: Student[] | null /* 대상 학년·반만 */ }
/** 정답표 저장 결과. 정리: 단위 id가 다시 매겨져 사례·답 칸을 같은 뜻의 새 id로 옮긴 수와, 같은 뜻의 단위가 없어 지운 수 */
/** 정리: 단위 번호가 바뀌어 옮기거나 지운 사례·답 칸 수. 정답바뀐사례: 정답·허용이 바뀐 단위에 그대로 둔 사례(선생님이 확인할 것) */
export interface SaveKeyResult { key: AnswerKey; 정리: { 사례: { 옮김: number; 지움: number }; 답칸: { 옮김: number; 지움: number } }; 정답바뀐사례: ChangedAnswerCase[] }
/** skipped: 이미 전사해 건너뛴 장(걸린 시간을 재지 않는다), error: 실패한 장 */
export interface ProgressEvent { page: number; done: number; total: number; inputTokens?: number; outputTokens?: number; error?: string; skipped?: boolean }
export interface RunResult { ok: number[]; failed: { page: number; error: string }[]; skipped: number[]; 엑셀?: string; 엑셀오류?: string }
export interface KeyDraftResult { 정량: AnswerKey['정량']; 정성: AnswerKey['정성']; 주의: string[] }
/** 다시확인: 다시 판정(규칙·모델)이 이미 확인한 판정을 바꿔 확인을 푼 장. 다시 판정만 채운다 */
export interface RejudgeResult { 바뀐장: { page: number; 변경: string[] }[]; 다시확인?: number[]; 엑셀?: string; 엑셀오류?: string }
export interface JudgeResult extends RejudgeResult { failed: { page: number; error: string }[] }
/** 사례 기록 결과. 판정변경: 바뀐 장마다 그 단위의 이전·이후(되돌리기에 쓴다), 이전사례: 이 기록이 바꿔 쓴 같은 답의 사례 */
export interface CaseResult extends RejudgeResult { 판정변경: CaseChange[]; 이전사례?: Case }
/** 되돌리기 결과. 사례: 지운 사례 수, 복원: 이전 값으로 돌린 판정 수, 건너뜀: 그사이 바뀌어 그대로 둔 판정 수 */
export interface CaseRevertResult { 사례: number; 복원: number; 건너뜀: number; 엑셀?: string; 엑셀오류?: string }
/** 문항별 검토 결과. 바뀐장수: 판정·응답이 바뀐 장(이때만 엑셀을 다시 만든다), 확인장수: 새로 확인한 장, 사례수: 새로 기록한 사례 */
export interface UnitResultsResult { 바뀐장수: number; 확인장수: number; 사례수: number; 사례오류?: string; 엑셀?: string; 엑셀오류?: string }
/** 자동 업데이트 상태. error는 설정 화면의 한 줄과 로그에만 보인다(창을 띄우지 않음) */
export type UpdateStatus =
  | { kind: 'disabled'; reason: 'dev' | 'off' | 'manual' } | { kind: 'idle' } | { kind: 'checking' } | { kind: 'none'; version: string }
  | { kind: 'available'; version: string } | { kind: 'downloading'; percent: number } | { kind: 'downloaded'; version: string } | { kind: 'error'; message: string };
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type ExternalLink = 'install' | 'codexInstall' | 'geminiKey' | 'openaiKey' | 'privacy' | 'guide' | 'releases';
export type LeaveChoice = 'save' | 'discard' | 'stay';

export const CHANNELS = {
  getSettings: 'settings:get', saveSettings: 'settings:save', pickFolder: 'dialog:folder', pickFile: 'dialog:file', askLeave: 'dialog:leave', openExternal: 'shell:external', revealPath: 'shell:reveal', version: 'app:version', notify: 'app:notify',
  secretView: 'secret:view', secretSet: 'secret:set', secretClear: 'secret:clear', secretTest: 'secret:test',
  cliStatus: 'cli:status', cliLogin: 'cli:login',
  listSets: 'set:list', createSet: 'set:create', deleteSet: 'set:delete', listTrash: 'trash:list', restoreSet: 'trash:restore', purgeSet: 'trash:purge', readSet: 'set:read', saveKey: 'set:save-key', importKey: 'set:import-key', exportKey: 'set:export-key', attachSource: 'set:attach-source', readSourceText: 'set:source-text',
  draftKey: 'ai:draft-key', reviseKey: 'ai:revise-key', extractText: 'file:extract-text', tryPage: 'ai:try-page', startRun: 'run:start', cancelRun: 'run:cancel', progress: 'run:progress', addPages: 'pages:add', deletePage: 'pages:delete', deletePages: 'pages:delete-many', recordUpload: 'pages:record-upload',
  saveTranscript: 'review:save', buildResult: 'review:build-result', openResult: 'review:open-result', buildCumulative: 'review:build-cumulative', setUnitResults: 'review:unit-results',
  setNameMask: 'set:name-mask', setIdentityMask: 'set:identity-mask', setAnswerRegion: 'set:answer-region', matchRoster: 'roster:match',
  applyCase: 'case:apply', revertCase: 'case:revert', removeCase: 'case:remove', rejudge: 'judge:rule', judgeWithModel: 'judge:model',
  updateStatus: 'update:status', checkUpdate: 'update:check', downloadUpdate: 'update:download', installUpdate: 'update:install',
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
  /** 창에 초점이 없을 때만 운영체제 알림을 띄운다(누르면 창을 앞으로). 띄웠으면 true */
  notify(title: string, body: string): Promise<boolean>;
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
  saveKey(폴더: string, key: AnswerKey): Promise<SaveKeyResult>;
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
  deletePages(폴더: string, pages: number[]): Promise<{ 삭제: number; 엑셀?: string; 엑셀오류?: string }>;   // 여러 장을 지우고 엑셀은 한 번만
  recordUpload(폴더: string, r: Omit<UploadRecord, '일시'>): Promise<void>;
  saveTranscript(폴더: string, t: Transcript): Promise<{ 엑셀?: string; 엑셀오류?: string }>;
  /** 문항별 검토: 한 단위의 여러 장 판정(정량)·응답(정성)을 정하고 확인 표시. 다른 단위는 그대로 두고, 판정이 바뀌면 엑셀을 한 번만 다시 만든다 */
  setUnitResults(폴더: string, req: UnitResultsRequest): Promise<UnitResultsResult>;
  buildResult(폴더: string): Promise<{ 엑셀: string }>;
  /** 세트의 가장 새 채점결과 엑셀을 PC에 깔린 프로그램(엑셀 등)으로 연다. 아직 없으면 만든 뒤 연다. 연 파일 경로를 돌려준다 */
  openResult(폴더: string): Promise<string>;
  buildCumulative(): Promise<{ 파일: string[] }>;
  /** 사례를 기록하고 같은 단위에 같은 답을 쓴 장만 사례 판정으로 바꾼다(답안지별 검토, 사례로 기록이 켜져 있을 때) */
  applyCase(폴더: string, c: { 단위: string; 답: string; 판정: 'O' | 'X'; page: number }): Promise<CaseResult>;
  /** 방금 기록한 사례를 지우고(바꿔 쓴 사례는 되살림) 함께 바뀐 장의 판정을 이전 값으로. 엑셀은 한 번만 다시 만든다 */
  revertCase(폴더: string, req: CaseRevertRequest): Promise<CaseRevertResult>;
  removeCase(폴더: string, 단위: string, 답: string): Promise<AnswerKey>;
  /** 이름 칸 가리기 설정. null이면 끈다 */
  setNameMask(폴더: string, rect: MaskRect | null): Promise<AnswerKey>;
  /** 문항별 검토 그림 보기에서 칠할 신원 영역. null이면 기본 영역(쪽 위 15%) */
  setIdentityMask(폴더: string, rect: MaskRect | null): Promise<AnswerKey>;
  /** 문항별 검토에서 손글씨를 잘라 보일 단위의 답 칸. null이면 그 단위의 영역을 지운다 */
  setAnswerRegion(폴더: string, 단위: string, rect: MaskRect | null): Promise<AnswerKey>;
  /** 이미 전사한 장을 명단과 맞춘다(이 PC 안에서만) */
  matchRoster(폴더: string): Promise<RejudgeResult>;
  /** 결정적 재판정(모델 호출 없음) */
  rejudge(폴더: string): Promise<RejudgeResult>;
  /** 글만 보내는 모델 재판정. 진행은 onProgress */
  judgeWithModel(폴더: string, opts: { pages?: number[] }): Promise<JudgeResult>;
  updateStatus(): Promise<UpdateStatus>;
  /** 사용자가 누른 확인이라 자동 확인이 꺼져 있어도 한다. 개발 실행·맥 시험판이면 아무것도 하지 않는다 */
  checkUpdate(): Promise<void>;
  /** 확인에서 찾은 새 버전을 내려받고, 다 받으면 다시 시작해 설치한다(전사 중이면 설치는 미룬다) */
  downloadUpdate(): Promise<void>;
  /** 받아 둔 새 버전으로 다시 시작 */
  installUpdate(): Promise<void>;
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
  /** 학기 폴더에 샘플 세트(인쇄 글자 답안지 3장, 전사 포함)를 넣는다. 이미 있으면 ' (2)' */
  createSampleSet(): Promise<{ 폴더: string }>;
  /** 문서\글눈\YYYY-N학기를 만들고 학기 폴더로 저장한다. 만든 경로를 돌려준다 */
  makeDefaultSemester(): Promise<string>;
}
