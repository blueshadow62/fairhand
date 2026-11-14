import { DEFAULT_OPENAI_MODEL } from '../shared/ipc.js';
import type { FetchLike } from './gemini.js';
import { EngineError, requestImages, transcribeRequest, userFacingMessage, type EngineErrorKind, type RawResult, type StructuredRequest, type TranscribeInput, type TranscribeProvider } from './provider.js';

/** 안내 문구에 쓰는 이름(provider.ts의 userFacingMessage가 이 이름으로 OpenAI API 전용 안내를 고른다) */
export const OPENAI = 'OpenAI';
export const OPENAI_API = 'https://api.openai.com/v1';

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Responses API 요청: 지시문 + (그림들 + 글) + JSON 양식 강제(엄격 모드).
 * 노력 단계(low~max)는 목록의 두 모델이 그대로 받는다(2026-11 OpenAI 추론 안내).
 * store: false — 기본값이면 응답을 OpenAI 쪽에 30일 이상 보관해 학생 자료가 남는다.
 * detail: high — 손글씨는 세부가 중요해 기본(auto) 축소에 맡기지 않는다.
 */
export function buildOpenAIRequest(req: StructuredRequest, model: string): Record<string, unknown> {
  return {
    model,
    store: false,
    instructions: req.system,
    reasoning: { effort: req.effort },
    input: [{ role: 'user', content: [
      ...requestImages(req).map(data => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${data}`, detail: 'high' })),
      { type: 'input_text', text: req.user }] }],
    text: { format: { type: 'json_schema', name: 'result', schema: req.schema, strict: true } },
  };
}

export function classifyOpenAIHttp(status: number, body: unknown): EngineError {
  const e = isObj(body) && isObj(body.error) ? body.error : {};
  const m = String(e.message ?? `HTTP ${status}`);
  const code = String(e.code ?? e.type ?? '');
  const err = (k: EngineErrorKind) => new EngineError(k, m, undefined, OPENAI);
  if (status === 401 || status === 403 || code === 'invalid_api_key') return err('signed-out');
  // 잔액·결제 한도 부족도 429로 오지만 기다려도 풀리지 않아 다시 시도하지 않는 오류로 둔다
  if (status === 429 && code === 'insufficient_quota') return new EngineError('other', 'OpenAI API 결제 잔액이나 한도가 부족합니다. OpenAI 플랫폼의 결제(Billing)를 확인해 주세요.', undefined, OPENAI);
  if (status === 429) return err('rate-limit');
  if (status === 500 || status === 502 || status === 503) return err('overloaded');
  if (status === 504) return err('timeout');
  return err('other');
}

/** fetch가 던진 것(연결 실패·시간 초과·중단)을 가린다 */
export function classifyOpenAIThrown(e: unknown, userAborted: boolean): EngineError {
  if (userAborted) return new EngineError('cancelled', '중단됨');
  const err = e as { name?: string; message?: string; cause?: { code?: string } } | undefined;
  const m = String(err?.message ?? e);
  if (err?.name === 'TimeoutError' || /timed? ?out/i.test(m)) return new EngineError('timeout', m, undefined, OPENAI);
  return new EngineError('network', `${m}${err?.cause?.code ? ` (${err.cause.code})` : ''}`, undefined, OPENAI);
}

export function parseOpenAIResponse(res: unknown, fallbackModel: string): RawResult {
  if (!isObj(res)) throw new EngineError('invalid-output', 'OpenAI 응답이 객체가 아님', undefined, OPENAI);
  if (res.status === 'incomplete') {
    const reason = isObj(res.incomplete_details) ? String(res.incomplete_details.reason ?? '') : '';
    if (reason === 'content_filter') throw new EngineError('refusal', '내용 거르기로 답이 끊김', undefined, OPENAI);
    throw new EngineError('invalid-output', reason === 'max_output_tokens' ? '답이 길이 한도에서 잘림' : `답이 끝나지 않음(${reason || '이유 없음'})`, undefined, OPENAI);
  }
  if (res.status === 'failed') throw new EngineError('other', `OpenAI 응답 실패: ${isObj(res.error) ? String(res.error.message ?? '') : ''}`, undefined, OPENAI);
  const parts = (Array.isArray(res.output) ? res.output : [])
    .filter((o: unknown) => isObj(o) && o.type === 'message')
    .flatMap((o: any) => (Array.isArray(o.content) ? o.content : []));
  // 거절은 양식을 따르지 않고 refusal 조각으로 온다
  const refusal = parts.find((p: unknown) => isObj(p) && p.type === 'refusal');
  if (refusal) throw new EngineError('refusal', `모델이 거절함: ${String(refusal.refusal ?? '').slice(0, 200)}`, undefined, OPENAI);
  const text = parts.filter((p: unknown) => isObj(p) && p.type === 'output_text' && typeof p.text === 'string').map((p: any) => p.text as string).join('');
  if (!text.trim()) throw new EngineError('invalid-output', 'OpenAI 응답에 글이 없음', undefined, OPENAI);
  let output: unknown;
  try { output = JSON.parse(text); } catch { throw new EngineError('invalid-output', 'OpenAI 응답이 JSON이 아님', undefined, OPENAI); }
  const u = isObj(res.usage) ? res.usage : {};
  // output_tokens에 추론 토큰이 이미 들어 있다(따로 더하지 않는다)
  return { output, inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined, outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
    model: typeof res.model === 'string' ? res.model : fallbackModel };
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export class OpenAIProvider implements TranscribeProvider {
  readonly id = 'openai' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;
  constructor(opts: { apiKey: string; model?: string; fetch?: FetchLike; timeoutMs?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_OPENAI_MODEL;
    this.doFetch = opts.fetch ?? defaultFetch;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> { return this.complete(transcribeRequest(input), signal); }

  async complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> {
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    const both = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    let res: Awaited<ReturnType<FetchLike>>, body: unknown;
    try {
      res = await this.doFetch(`${OPENAI_API}/responses`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(buildOpenAIRequest(req, this.model)), signal: both });
      body = await res.json().catch(() => null);
    } catch (e) { throw classifyOpenAIThrown(e, signal.aborted); }
    if (!res.ok) throw classifyOpenAIHttp(res.status, body);
    return parseOpenAIResponse(body, this.model);
  }
}

/** 설정의 '연결 확인'. 모델 정보를 읽어 키와 모델을 함께 확인한다(토큰을 쓰지 않는다) */
export async function testOpenAIKey(apiKey: string, model: string = DEFAULT_OPENAI_MODEL, doFetch: FetchLike = defaultFetch): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await doFetch(`${OPENAI_API}/models/${encodeURIComponent(model)}`, { method: 'GET', headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return { ok: true, message: '연결됐습니다' };
    if (res.status === 404) return { ok: false, message: `다음 모델을 쓸 수 없습니다: ${model}. 설정에서 다른 모델을 고르거나 OpenAI 계정의 모델 접근 권한을 확인하세요` };
    return { ok: false, message: userFacingMessage(classifyOpenAIHttp(res.status, await res.json().catch(() => null))) };
  } catch (e) { return { ok: false, message: userFacingMessage(classifyOpenAIThrown(e, false)) }; }
}
