import test from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_API, GeminiProvider, buildGeminiRequest, classifyGeminiHttp, classifyGeminiThrown, parseGeminiResponse, testGeminiKey, thinkingLevel, type FetchLike } from '../src/engine/gemini.js';
import { EngineError, userFacingMessage, type StructuredRequest } from '../src/engine/provider.js';
import { DEFAULT_GEMINI_MODEL } from '../src/shared/ipc.js';

const REQ: StructuredRequest = { system: 'SYS', user: 'USER', imageJpegBase64: 'QUJD', images: ['REVG'], schema: { type: 'object', properties: { a: { type: ['integer', 'null'] } } }, effort: 'high' };
const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: '생각 요약', thought: true }, { text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1300, candidatesTokenCount: 200, thoughtsTokenCount: 50 }, modelVersion: 'gemini-4-argon-001', ...extra });

/** 받은 요청을 적어 두고 정해 둔 답을 돌려주는 가짜 fetch */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  return { f, calls };
}

test('buildGeminiRequest: 시스템 지시, 그림(보낸 순서) 다음 글, JSON 양식 강제', () => {
  const r = buildGeminiRequest(REQ, 'gemini-4-argon') as any;
  assert.deepEqual(r.systemInstruction, { parts: [{ text: 'SYS' }] });
  assert.deepEqual(r.contents[0].parts, [{ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }, { inlineData: { mimeType: 'image/jpeg', data: 'REVG' } }, { text: 'USER' }]);
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(r.generationConfig.responseJsonSchema, REQ.schema);
  assert.deepEqual(r.generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
});

test('thinkingLevel: Gemini 3 이후만, 낮음은 LOW·중간은 모델 기본·높음 이상은 HIGH', () => {
  assert.equal(thinkingLevel('gemini-3.8-flash', 'low'), 'LOW');
  assert.equal(thinkingLevel('gemini-4-argon', 'medium'), undefined);
  assert.equal(thinkingLevel('gemini-4-argon', 'max'), 'HIGH');
  assert.equal(thinkingLevel('gemini-2.5-flash-lite', 'high'), undefined); // 앞 세대에 보내면 오류
  assert.equal((buildGeminiRequest({ ...REQ, effort: 'medium' }, 'gemini-4-argon') as any).generationConfig.thinkingConfig, undefined);
});

test('parseGeminiResponse: 생각 요약은 빼고 답 글만 JSON으로, 생각 토큰도 출력에 센다', () => {
  assert.deepEqual(parseGeminiResponse(reply('{"a":1}'), 'm'), { output: { a: 1 }, inputTokens: 1300, outputTokens: 250, model: 'gemini-4-argon-001' });
  assert.equal(parseGeminiResponse({ ...reply('{"a":2}'), modelVersion: undefined }, 'fallback').model, 'fallback');
});

test('parseGeminiResponse: 막힌 요청·안전 중단은 refusal, 잘림·JSON 아님·빈 답은 invalid-output', () => {
  const kind = (res: unknown) => { try { parseGeminiResponse(res, 'm'); return 'ok'; } catch (e) { return (e as EngineError).kind; } };
  assert.equal(kind({ promptFeedback: { blockReason: 'SAFETY' } }), 'refusal');
  assert.equal(kind({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), 'refusal');
  assert.equal(kind({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }] }), 'invalid-output');
  assert.equal(kind(reply('JSON 아님')), 'invalid-output');
  assert.equal(kind({ candidates: [] }), 'invalid-output');
});

test('classifyGemini: 틀린 키(400 API_KEY_INVALID)·권한은 signed-out, 429·503·504와 연결 오류를 가른다', () => {
  const bad = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } };
  assert.equal(classifyGeminiHttp(400, bad).kind, 'signed-out');
  assert.equal(classifyGeminiHttp(403, null).kind, 'signed-out');
  assert.equal(classifyGeminiHttp(429, { error: { message: 'Resource has been exhausted' } }).kind, 'rate-limit');
  assert.equal(classifyGeminiHttp(503, null).kind, 'overloaded');
  assert.equal(classifyGeminiHttp(504, null).kind, 'timeout');
  assert.equal(classifyGeminiHttp(400, { error: { message: 'schema too complex' } }).kind, 'other');
  assert.equal(classifyGeminiThrown(new TypeError('fetch failed'), false).kind, 'network');
  assert.equal(classifyGeminiThrown(Object.assign(new Error('x'), { name: 'TimeoutError' }), false).kind, 'timeout');
  assert.equal(classifyGeminiThrown(new Error('aborted'), true).kind, 'cancelled');
  // 안내 문구는 로그인 대신 API 키·결제 등급을 말한다
  assert.match(userFacingMessage(classifyGeminiHttp(400, bad)), /^Gemini API 키가 없거나 틀렸습니다/);
  assert.match(userFacingMessage(classifyGeminiHttp(429, null)), /결제 등급/);
});

test('GeminiProvider: 키는 주소가 아닌 머리글로, 모델 주소로 보내고 답을 읽는다', async () => {
  const { f, calls } = fakeFetch(200, reply('{"a":1}'));
  const r = await new GeminiProvider({ apiKey: 'AIzaTEST', fetch: f }).complete(REQ, new AbortController().signal);
  assert.deepEqual(r.output, { a: 1 });
  assert.equal(calls[0]!.url, `${GEMINI_API}/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
  assert.ok(!calls[0]!.url.includes('AIzaTEST'));
  assert.equal(calls[0]!.init.headers['x-goog-api-key'], 'AIzaTEST');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0]!.init.body!), buildGeminiRequest(REQ, DEFAULT_GEMINI_MODEL));
  const other = fakeFetch(200, reply('{}'));
  await new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fetch: other.f }).complete(REQ, new AbortController().signal);
  assert.match(other.calls[0]!.url, /models\/gemini-3\.8-flash:generateContent$/);
});

test('GeminiProvider: HTTP 오류는 분류해 던지고, 이미 중단됐으면 보내지 않는다', async () => {
  const { f } = fakeFetch(429, { error: { message: 'quota' } });
  await assert.rejects(new GeminiProvider({ apiKey: 'k', fetch: f }).complete(REQ, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'rate-limit' && e.who === 'Gemini');
  const ac = new AbortController(); ac.abort();
  const never = fakeFetch(200, reply('{}'));
  await assert.rejects(new GeminiProvider({ apiKey: 'k', fetch: never.f }).complete(REQ, ac.signal), (e: unknown) => e instanceof EngineError && e.kind === 'cancelled');
  assert.equal(never.calls.length, 0);
});

test('testGeminiKey: 모델 정보를 읽어 키·모델을 확인한다(토큰을 쓰지 않음)', async () => {
  const ok = fakeFetch(200, { name: 'models/gemini-4-argon' });
  assert.deepEqual(await testGeminiKey('k', 'gemini-4-argon', ok.f), { ok: true, message: '연결됐습니다' });
  assert.equal(ok.calls[0]!.init.method, 'GET');
  assert.equal(ok.calls[0]!.url, `${GEMINI_API}/models/gemini-4-argon`);
  const bad = await testGeminiKey('k', 'gemini-4-argon', fakeFetch(400, { error: { message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } }).f);
  assert.equal(bad.ok, false); assert.match(bad.message, /API 키/);
  const missing = await testGeminiKey('k', 'gemini-x', fakeFetch(404, null).f);
  assert.match(missing.message, /gemini-x/);
});
