import { parseTranscript, validateTranscripts } from '../core/transcript.js';
import { DataError, pageTag, type AnswerKey, type TranscribeInfo, type Transcript } from '../core/types.js';
import { systemPrompt, userText, type Rules } from './rules.js';
import { fromModelOutput, transcriptSchema } from './schema.js';

export type EngineErrorKind = 'not-installed' | 'needs-update' | 'signed-out' | 'rate-limit' | 'overloaded' | 'network'
  | 'timeout' | 'refusal' | 'invalid-output' | 'unsafe-tools' | 'cancelled' | 'other';

export class EngineError extends Error {
  constructor(public readonly kind: EngineErrorKind, message: string, public readonly resetsAt?: number) { super(message); }
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** 기본 모델. CLI·API 두 경로가 같이 쓴다(프로필에 모델이 없을 때) */
export const MODEL = 'claude-opus-5-5';

export interface TranscribeInput { imageJpegBase64: string; key: AnswerKey; rules: Rules; page: number; effort: Effort }
export interface RawResult { output: unknown; inputTokens?: number; outputTokens?: number; model: string }
/** 시스템 프롬프트 + 사용자 글(+그림) + 출력 스키마. 전사와 정답 초안이 같은 CLI/API 경로를 쓴다. */
export interface StructuredRequest { system: string; user: string; imageJpegBase64?: string; images?: string[]; schema: Record<string, unknown>; effort: Effort }
/** 요청의 그림 전부(한 장 + 여러 장), 보내는 순서대로 */
export const requestImages = (req: StructuredRequest): string[] => [...(req.imageJpegBase64 ? [req.imageJpegBase64] : []), ...(req.images ?? [])];
export interface StructuredProvider { readonly id: 'cli' | 'api'; complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> }
export interface TranscribeProvider extends StructuredProvider { transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> }

export function transcribeRequest(input: TranscribeInput): StructuredRequest {
  return { system: systemPrompt(input.rules, input.key), user: userText(input.page), imageJpegBase64: input.imageJpegBase64, schema: transcriptSchema(input.key), effort: input.effort };
}

/** 모델 출력(이미 스키마 검증을 거쳤어도) 값을 다시 검사해 전사로 만든다. 틀리면 invalid-output. */
export function toTranscript(raw: unknown, key: AnswerKey, page: number, info: TranscribeInfo): Transcript {
  let t: Transcript;
  try { t = parseTranscript(JSON.stringify(fromModelOutput(raw)), pageTag(page)); }
  catch (e) { throw new EngineError('invalid-output', `모델 출력이 전사 양식이 아님: ${(e as Error).message}`); }
  if (t.page !== page) throw new EngineError('invalid-output', `모델 출력의 page가 ${t.page}인데 요청한 쪽은 ${page}`);
  try { validateTranscripts(key, [t]); }
  catch (e) { if (e instanceof DataError) throw new EngineError('invalid-output', `모델 출력 검증 실패: ${e.message}`); throw e; }
  // 손으로 쓴 전사와 달리 모델 출력의 누락은 빈칸(0점)으로 세지 않고 다시 묻는다
  const missing = [...key.정량.filter(u => !t.정량[u.id]), ...key.정성.filter(u => !t.정성[u.id])].map(u => u.id);
  if (missing.length) throw new EngineError('invalid-output', `모델 출력에 단위 누락: ${missing.join(', ')}`);
  return { ...t, 확인완료: false, 전사정보: info };
}

export const RETRYABLE: ReadonlySet<EngineErrorKind> = new Set(['rate-limit', 'overloaded', 'network', 'timeout']);

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); rej(new EngineError('cancelled', '중단됨')); }, { once: true });
});

/** 네트워크·과부하·한도·시간 초과는 2·4·8초 뒤 다시(최대 3회). 그 밖의 오류는 바로 던진다. */
export async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, waits = [2000, 4000, 8000]): Promise<T> {
  for (let i = 0; ; i++) {
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof EngineError) || !RETRYABLE.has(e.kind) || i >= waits.length) throw e;
      await sleep(waits[i]!, signal);
    }
  }
}

export function userFacingMessage(e: unknown): string {
  if (!(e instanceof EngineError)) return e instanceof Error ? e.message : String(e);
  const until = e.resetsAt ? ` (${new Date(e.resetsAt).toLocaleString('ko-KR')}에 풀림)` : '';
  switch (e.kind) {
    case 'not-installed': return 'Claude Code가 설치되어 있지 않습니다. 설정에서 설치 안내를 보세요.';
    case 'needs-update': return 'Claude Code가 너무 오래된 버전입니다. 업데이트한 뒤 다시 해 주세요.';
    case 'signed-out': return 'Claude Code에 로그인이 필요합니다. 설정에서 로그인을 열어 주세요.';
    case 'rate-limit': return `사용 한도에 닿았습니다${until}. 기다리거나 API 키로 바꿔 주세요.`;
    case 'overloaded': return '서버가 혼잡합니다. 잠시 뒤 다시 해 주세요.';
    case 'network': return '인터넷 연결을 확인해 주세요.';
    case 'timeout': return '응답이 너무 오래 걸려 중단했습니다. 다시 해 주세요.';
    case 'refusal': return '모델이 이 장의 전사를 거절했습니다. 검토 화면에서 직접 입력해 주세요.';
    case 'invalid-output': return `모델 출력이 양식에 맞지 않습니다: ${e.message}`;
    case 'unsafe-tools': return `Claude Code가 예상 밖의 도구와 함께 시작되어 중단했습니다: ${e.message}`;
    case 'cancelled': return '중단했습니다.';
    default: return e.message;
  }
}
