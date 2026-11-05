import Anthropic from '@anthropic-ai/sdk';
import { EngineError, type RawResult, type TranscribeInput, type TranscribeProvider } from './provider.js';
import { transcriptSchema } from './schema.js';
import { systemPrompt, userText } from './rules.js';

export const MODEL = 'claude-opus-5-5';
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export interface ApiClientLike { beta: { messages: { create(params: CreateParams, options?: { signal?: AbortSignal }): Promise<any> } } }

/** SDK 타입으로 만들어 요청 모양(output_config.format, fallbacks)을 컴파일 때 확인한다 */
export function buildRequest(input: TranscribeInput): CreateParams {
  return {
    model: MODEL,
    max_tokens: 16000,
    system: systemPrompt(input.rules, input.key),
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageJpegBase64 } },
      { type: 'text', text: userText(input.page) } ] }],
    output_config: { effort: input.effort, format: { type: 'json_schema', schema: transcriptSchema(input.key) } },
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
  private readonly client: ApiClientLike | null;
  constructor(opts: { apiKey?: string; client?: ApiClientLike }) {
    this.client = opts.client ?? (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : null);
  }

  async transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> {
    if (!this.client) throw new EngineError('signed-out', 'API 키가 설정되어 있지 않음');
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    let res: any;
    try { res = await this.client.beta.messages.create(buildRequest(input), { signal }); }
    catch (e) { if (signal.aborted) throw new EngineError('cancelled', '중단됨'); throw classifyApiError(e); }
    if (res?.stop_reason === 'refusal') throw new EngineError('refusal', '모델이 거절함');
    const text = (Array.isArray(res?.content) ? res.content : []).find((b: any) => b?.type === 'text')?.text;
    if (typeof text !== 'string') throw new EngineError('invalid-output', '응답에 글 블록이 없음');
    let output: unknown;
    try { output = JSON.parse(text); } catch { throw new EngineError('invalid-output', '응답이 JSON이 아님'); }
    return { output, inputTokens: res?.usage?.input_tokens, outputTokens: res?.usage?.output_tokens, model: typeof res?.model === 'string' ? res.model : MODEL };
  }
}
