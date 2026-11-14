import type Anthropic from '@anthropic-ai/sdk';
import { EngineError, requestImages, transcribeRequest, type RawResult, type StructuredRequest, type TranscribeInput, type TranscribeProvider } from './provider.js';

import { MODEL } from './provider.js';
export { MODEL };
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export interface ApiClientLike { beta: { messages: { create(params: CreateParams, options?: { signal?: AbortSignal; timeout?: number }): Promise<any> } } }

/**
 * 응답 길이 한도(생각 포함). 2026-11-08 손글씨 장 하나가 노력 '중간'에서 출력 2만~3만 토큰을 써(11-06에는 2천 남짓) 16,000이면 잘린다.
 * SDK는 이만큼 긴 비스트리밍 요청을 '10분 넘을 수 있다'며 막으므로 요청마다 시간 한도(REQUEST_TIMEOUT_MS)를 직접 준다
 */
export const MAX_TOKENS = 32000;
export const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

/** SDK 타입으로 만들어 요청 모양(output_config.format, fallbacks)을 컴파일 때 확인한다 */
export function buildRequest(req: StructuredRequest, model: string = MODEL): CreateParams {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: req.system,
    messages: [{ role: 'user', content: [
      ...requestImages(req).map(data => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } })),
      { type: 'text' as const, text: req.user } ] }],
    output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
    // 안전 분류기가 거절하면 서버가 다른 모델로 같은 요청을 이어 간다
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

export function classifyApiError(e: unknown): EngineError {
  const err = e as { status?: number; name?: string; message?: string };
  const m = err?.message ?? String(e);
  if (err?.status === 401 || err?.status === 403) return new EngineError('signed-out', `API 키가 틀리거나 권한이 없음: ${m}`);
  if (err?.status === 429) return new EngineError('rate-limit', m);
  if (err?.status === 529 || err?.status === 503 || err?.status === 500) return new EngineError('overloaded', m);
  if (err?.name === 'APIConnectionTimeoutError' || /timed out|timeout/i.test(m)) return new EngineError('timeout', m);
  if (err?.name === 'APIConnectionError' || /connection error|fetch failed|ENOTFOUND|ECONNRESET/i.test(m)) return new EngineError('network', m);
  return new EngineError('other', m);
}

export class ApiProvider implements TranscribeProvider {
  readonly id = 'api' as const;
  private client: ApiClientLike | null;
  private readonly apiKey?: string;
  readonly model: string;
  constructor(opts: { apiKey?: string; client?: ApiClientLike; model?: string }) {
    this.client = opts.client ?? null;
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? MODEL;
  }

  transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> { return this.complete(transcribeRequest(input), signal); }

  async complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> {
    if (!this.client && this.apiKey) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); this.client = new Anthropic({ apiKey: this.apiKey }); } // SDK는 처음 부를 때 읽는다(앱 기동 0.5초 절약)
    if (!this.client) throw new EngineError('signed-out', 'API 키가 설정되어 있지 않음');
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    let res: any;
    try { res = await this.client.beta.messages.create(buildRequest(req, this.model), { signal, timeout: REQUEST_TIMEOUT_MS }); }
    catch (e) { if (signal.aborted) throw new EngineError('cancelled', '중단됨'); throw classifyApiError(e); }
    if (res?.stop_reason === 'refusal') throw new EngineError('refusal', '모델이 거절함');
    // 한도에 걸려 잘린 답은 다시 물어도 또 잘리기 쉬워 요금만 두 번 든다. 다시 묻지 않는 오류로 알린다(invalid-output이면 한 번 더 묻는다)
    if (res?.stop_reason === 'max_tokens') throw new EngineError('other', `응답이 길이 한도(${MAX_TOKENS.toLocaleString('en-US')}토큰)에 걸려 잘렸습니다. 노력 단계를 낮춰 다시 해 보세요`);
    const text = (Array.isArray(res?.content) ? res.content : []).find((b: any) => b?.type === 'text')?.text;
    if (typeof text !== 'string') throw new EngineError('invalid-output', '응답에 글 블록이 없음');
    let output: unknown;
    try { output = JSON.parse(text); } catch { throw new EngineError('invalid-output', '응답이 JSON이 아님'); }
    return { output, inputTokens: res?.usage?.input_tokens, outputTokens: res?.usage?.output_tokens, model: typeof res?.model === 'string' ? res.model : this.model };
  }
}
