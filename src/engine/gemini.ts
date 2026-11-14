import { DEFAULT_GEMINI_MODEL } from '../shared/ipc.js';
import { EngineError, requestImages, transcribeRequest, userFacingMessage, type Effort, type EngineErrorKind, type RawResult, type StructuredRequest, type TranscribeInput, type TranscribeProvider } from './provider.js';

/** 안내 문구에 쓰는 이름(provider.ts의 userFacingMessage가 이 이름으로 Gemini 전용 안내를 고른다) */
export const GEMINI = 'Gemini';
export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/** 내장 fetch와 같은 모양. 시험에서 가짜로 바꾼다 */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 생각 단계(thinkingLevel)는 Gemini 3 이후 모델만 받는다(앞 모델에 보내면 오류). 모델마다 받는 단계가 달라
 * 어느 모델이나 받는 LOW·HIGH만 보내고, 중간은 모델 기본(동적 생각)에 맡긴다
 */
export function thinkingLevel(model: string, effort: Effort): 'LOW' | 'HIGH' | undefined {
  if (!/^gemini-([3-9]|[1-9]\d)/.test(model)) return undefined;
  if (effort === 'low') return 'LOW';
  return effort === 'medium' ? undefined : 'HIGH';
}

/** generateContent 요청: 시스템 지시 + (그림들 + 글) + JSON 양식 강제 */
export function buildGeminiRequest(req: StructuredRequest, model: string): Record<string, unknown> {
  const level = thinkingLevel(model, req.effort);
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [
      ...requestImages(req).map(data => ({ inlineData: { mimeType: 'image/jpeg', data } })),
      { text: req.user }] }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: req.schema, ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}) },
  };
}

export function classifyGeminiHttp(status: number, body: unknown): EngineError {
  const e = isObj(body) && isObj(body.error) ? body.error : {};
  const m = String(e.message ?? `HTTP ${status}`);
  const reasons = Array.isArray(e.details) ? e.details.map((d: unknown) => (isObj(d) ? String(d.reason ?? '') : '')) : [];
  const err = (k: EngineErrorKind) => new EngineError(k, m, undefined, GEMINI);
  // 틀린 키는 400(API_KEY_INVALID)으로 온다
  if (status === 401 || status === 403 || reasons.includes('API_KEY_INVALID') || /api key not valid/i.test(m)) return err('signed-out');
  if (status === 429) return err('rate-limit');
  if (status === 500 || status === 503) return err('overloaded');
  if (status === 504) return err('timeout');
  return err('other');
}

/** fetch가 던진 것(연결 실패·시간 초과·중단)을 가린다 */
export function classifyGeminiThrown(e: unknown, userAborted: boolean): EngineError {
  if (userAborted) return new EngineError('cancelled', '중단됨');
  const err = e as { name?: string; message?: string; cause?: { code?: string } } | undefined;
  const m = String(err?.message ?? e);
  if (err?.name === 'TimeoutError' || /timed? ?out/i.test(m)) return new EngineError('timeout', m, undefined, GEMINI);
  return new EngineError('network', `${m}${err?.cause?.code ? ` (${err.cause.code})` : ''}`, undefined, GEMINI);
}

/** 안전 분류기 등으로 끝난 경우. 답 대신 거절로 다룬다 */
const REFUSAL_REASONS: ReadonlySet<string> = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'LANGUAGE']);

export function parseGeminiResponse(res: unknown, fallbackModel: string): RawResult {
  if (!isObj(res)) throw new EngineError('invalid-output', 'Gemini 응답이 객체가 아님', undefined, GEMINI);
  const blocked = isObj(res.promptFeedback) ? res.promptFeedback.blockReason : undefined;
  if (blocked) throw new EngineError('refusal', `요청이 막힘(${String(blocked)})`, undefined, GEMINI);
  const cand = Array.isArray(res.candidates) ? res.candidates[0] : undefined;
  if (!isObj(cand)) throw new EngineError('invalid-output', 'Gemini 응답에 후보가 없음', undefined, GEMINI);
  const reason = String(cand.finishReason ?? '');
  if (REFUSAL_REASONS.has(reason)) throw new EngineError('refusal', `모델이 거절함(${reason})`, undefined, GEMINI);
  if (reason === 'MAX_TOKENS') throw new EngineError('invalid-output', '답이 길이 한도에서 잘림', undefined, GEMINI);
  const parts = isObj(cand.content) && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  // 생각 요약(thought: true)은 답이 아니다
  const text = parts.filter((p: unknown) => isObj(p) && p.thought !== true && typeof p.text === 'string').map((p: any) => p.text as string).join('');
  if (!text.trim()) throw new EngineError('invalid-output', 'Gemini 응답에 글이 없음', undefined, GEMINI);
  let output: unknown;
  try { output = JSON.parse(text); } catch { throw new EngineError('invalid-output', 'Gemini 응답이 JSON이 아님', undefined, GEMINI); }
  const u = isObj(res.usageMetadata) ? res.usageMetadata : {};
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const out = num(u.candidatesTokenCount) + num(u.thoughtsTokenCount); // 생각 토큰도 출력으로 과금된다
  return { output, inputTokens: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : undefined, outputTokens: out || undefined,
    model: typeof res.modelVersion === 'string' ? res.modelVersion : fallbackModel };
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export class GeminiProvider implements TranscribeProvider {
  readonly id = 'gemini' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;
  constructor(opts: { apiKey: string; model?: string; fetch?: FetchLike; timeoutMs?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_GEMINI_MODEL;
    this.doFetch = opts.fetch ?? defaultFetch;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> { return this.complete(transcribeRequest(input), signal); }

  async complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> {
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    const both = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    let res: Awaited<ReturnType<FetchLike>>, body: unknown;
    try {
      // 키는 주소(로그·프록시에 남을 수 있음)가 아니라 머리글로 보낸다
      res = await this.doFetch(`${GEMINI_API}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(buildGeminiRequest(req, this.model)), signal: both });
      body = await res.json().catch(() => null);
    } catch (e) { throw classifyGeminiThrown(e, signal.aborted); }
    if (!res.ok) throw classifyGeminiHttp(res.status, body);
    return parseGeminiResponse(body, this.model);
  }
}

/** 설정의 '연결 확인'. 모델 정보를 읽어 키와 모델을 함께 확인한다(토큰을 쓰지 않는다) */
export async function testGeminiKey(apiKey: string, model: string = DEFAULT_GEMINI_MODEL, doFetch: FetchLike = defaultFetch): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await doFetch(`${GEMINI_API}/models/${encodeURIComponent(model)}`, { method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return { ok: true, message: '연결됐습니다' };
    if (res.status === 404) return { ok: false, message: `다음 모델을 찾을 수 없습니다: ${model}. 설정에서 다른 모델을 고르세요` };
    return { ok: false, message: userFacingMessage(classifyGeminiHttp(res.status, await res.json().catch(() => null))) };
  } catch (e) { return { ok: false, message: userFacingMessage(classifyGeminiThrown(e, false)) }; }
}
