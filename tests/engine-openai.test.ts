import test from 'node:test';
import assert from 'node:assert/strict';
import type { FetchLike } from '../src/engine/gemini.js';
import { judgeSchema } from '../src/engine/judge.js';
import { keyDraftSchema } from '../src/engine/keydraft.js';
import { OPENAI_API, OpenAIProvider, buildOpenAIRequest, classifyOpenAIHttp, classifyOpenAIThrown, parseOpenAIResponse, testOpenAIKey } from '../src/engine/openai.js';
import { EngineError, userFacingMessage, withRetry, type StructuredRequest } from '../src/engine/provider.js';
import { transcriptSchema } from '../src/engine/schema.js';
import { DEFAULT_OPENAI_MODEL } from '../src/shared/ipc.js';
import type { AnswerKey } from '../src/core/types.js';

const REQ: StructuredRequest = { system: 'SYS', user: 'USER', imageJpegBase64: 'QUJD', images: ['REVG'], schema: { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false }, effort: 'xhigh' };
const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'resp_1', status: 'completed', model: 'gpt-6-astra-2026-10-01',
  output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 1300, output_tokens: 250, output_tokens_details: { reasoning_tokens: 200 } }, ...extra });

/** 받은 요청을 적어 두고 정해 둔 답을 돌려주는 가짜 fetch */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  return { f, calls };
}

test('buildOpenAIRequest: 지시문, 그림(보낸 순서) 다음 글, 엄격한 JSON 양식, 노력 그대로, 응답 저장 안 함', () => {
  const r = buildOpenAIRequest(REQ, 'gpt-6.1-sol') as any;
  assert.equal(r.model, 'gpt-6.1-sol');
  assert.equal(r.store, false); // 학생 자료가 OpenAI에 응답 기록으로 남지 않게
  assert.equal(r.instructions, 'SYS');
  assert.deepEqual(r.reasoning, { effort: 'xhigh' });
  assert.deepEqual(r.input, [{ role: 'user', content: [
    { type: 'input_image', image_url: 'data:image/jpeg;base64,QUJD', detail: 'high' },
    { type: 'input_image', image_url: 'data:image/jpeg;base64,REVG', detail: 'high' },
    { type: 'input_text', text: 'USER' }] }]);
  assert.deepEqual(r.text.format, { type: 'json_schema', name: 'result', schema: REQ.schema, strict: true });
});

test('parseOpenAIResponse: 메시지의 글을 JSON으로, 추론 토큰은 output_tokens에 이미 들어 있다', () => {
  assert.deepEqual(parseOpenAIResponse(reply('{"a":1}'), 'm'), { output: { a: 1 }, inputTokens: 1300, outputTokens: 250, model: 'gpt-6-astra-2026-10-01' });
  assert.equal(parseOpenAIResponse({ ...reply('{"a":2}'), model: undefined }, 'fallback').model, 'fallback');
});

test('parseOpenAIResponse: 거절 조각·내용 거르기는 refusal, 길이 한도·JSON 아님·빈 답은 invalid-output', () => {
  const kind = (res: unknown) => { try { parseOpenAIResponse(res, 'm'); return 'ok'; } catch (e) { return (e as EngineError).kind; } };
  assert.equal(kind({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: '도울 수 없습니다' }] }] }), 'refusal');
  assert.equal(kind({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }), 'refusal');
  assert.equal(kind({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }), 'invalid-output');
  assert.equal(kind(reply('JSON 아님')), 'invalid-output');
  assert.equal(kind({ status: 'completed', output: [{ type: 'reasoning', summary: [] }] }), 'invalid-output');
  assert.equal(kind({ status: 'failed', error: { message: 'server_error' } }), 'other');
});

test('classifyOpenAI: 틀린 키·권한은 signed-out, 결제 잔액 부족은 다시 시도하지 않고, 429·503·504와 연결 오류를 가른다', async () => {
  assert.equal(classifyOpenAIHttp(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }).kind, 'signed-out');
  assert.equal(classifyOpenAIHttp(403, null).kind, 'signed-out');
  assert.equal(classifyOpenAIHttp(429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }).kind, 'rate-limit');
  const quota = classifyOpenAIHttp(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } });
  assert.equal(quota.kind, 'other');
  assert.match(userFacingMessage(quota), /결제/);
  let tries = 0;
  await assert.rejects(withRetry(async () => { tries++; throw quota; }, new AbortController().signal, [1, 1, 1]));
  assert.equal(tries, 1); // 잔액은 기다려도 늘지 않는다
  assert.equal(classifyOpenAIHttp(503, null).kind, 'overloaded');
  assert.equal(classifyOpenAIHttp(504, null).kind, 'timeout');
  assert.equal(classifyOpenAIHttp(400, { error: { message: 'Invalid schema' } }).kind, 'other');
  assert.equal(classifyOpenAIThrown(new TypeError('fetch failed'), false).kind, 'network');
  assert.equal(classifyOpenAIThrown(Object.assign(new Error('x'), { name: 'TimeoutError' }), false).kind, 'timeout');
  assert.equal(classifyOpenAIThrown(new Error('aborted'), true).kind, 'cancelled');
  assert.match(userFacingMessage(classifyOpenAIHttp(401, null)), /OpenAI API 키/);
});

test('OpenAIProvider: 키는 머리글(Bearer)로, /responses에 보내고 답을 읽는다', async () => {
  const { f, calls } = fakeFetch(200, reply('{"a":3}'));
  const r = await new OpenAIProvider({ apiKey: 'sk-test', fetch: f }).complete(REQ, new AbortController().signal);
  assert.deepEqual(r.output, { a: 3 });
  assert.equal(calls[0]!.url, `${OPENAI_API}/responses`);
  assert.equal(calls[0]!.init.headers.authorization, 'Bearer sk-test');
  assert.ok(!calls[0]!.url.includes('sk-test'));
  assert.equal(JSON.parse(calls[0]!.init.body!).model, DEFAULT_OPENAI_MODEL);
  await assert.rejects(new OpenAIProvider({ apiKey: 'k', fetch: fakeFetch(401, null).f }).complete(REQ, new AbortController().signal), (e: EngineError) => e.kind === 'signed-out');
  const ac = new AbortController(); ac.abort();
  await assert.rejects(new OpenAIProvider({ apiKey: 'k', fetch: f }).complete(REQ, ac.signal), (e: EngineError) => e.kind === 'cancelled');
});

test('testOpenAIKey: 모델 정보만 읽어 토큰을 쓰지 않고, 없는 모델은 따로 안내', async () => {
  const ok = fakeFetch(200, { id: 'gpt-6.1-sol' });
  assert.deepEqual(await testOpenAIKey('sk', 'gpt-6.1-sol', ok.f), { ok: true, message: '연결됐습니다' });
  assert.equal(ok.calls[0]!.url, `${OPENAI_API}/models/gpt-6.1-sol`);
  assert.equal(ok.calls[0]!.init.method, 'GET');
  assert.match((await testOpenAIKey('sk', 'gpt-x', fakeFetch(404, null).f)).message, /gpt-x/);
  assert.equal((await testOpenAIKey('sk', 'gpt-6.1-sol', fakeFetch(401, null).f)).ok, false);
});

/**
 * OpenAI 엄격 모드(strict)는 모든 객체에 additionalProperties: false를 두고 속성을 모두 required에 넣어야 하며,
 * 뿌리는 object여야 하고 allOf·not·if 등은 받지 않는다. 어기면 요청이 400으로 거절된다.
 * 전사·재판정·정답 초안 양식에 나중에 필드를 더하다 이 규칙이 깨지지 않게 지킨다
 */
function strictProblems(s: unknown, at = '$'): string[] {
  if (!s || typeof s !== 'object') return [];
  const o = s as Record<string, any>;
  const out: string[] = [];
  for (const k of ['allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas', 'patternProperties', 'oneOf']) if (k in o) out.push(`${at}: ${k}`);
  const types = Array.isArray(o.type) ? o.type : [o.type];
  if (types.includes('object')) {
    if (o.additionalProperties !== false) out.push(`${at}: additionalProperties가 false가 아님`);
    const props = Object.keys(o.properties ?? {});
    const req = new Set(o.required ?? []);
    for (const p of props) if (!req.has(p)) out.push(`${at}.${p}: required에 없음`);
    for (const p of props) out.push(...strictProblems(o.properties[p], `${at}.${p}`));
  }
  if (o.items) out.push(...strictProblems(o.items, `${at}[]`));
  for (const b of o.anyOf ?? []) out.push(...strictProblems(b, `${at}|`));
  return out;
}

test('양식(전사·재판정·정답 초안)이 OpenAI 엄격 모드 규칙을 지킨다', () => {
  const key = { 정량: [{ id: '1-1' }, { id: '2-1' }], 정성: [{ id: 'E1' }] } as unknown as AnswerKey;
  const essay = { ...key, 정량: [...key.정량, { id: '9-1', 문항: 9, 유형: '논술형' }] } as unknown as AnswerKey;
  for (const [name, schema] of [['전사', transcriptSchema(key)], ['전사(논술형)', transcriptSchema(essay)], ['재판정', judgeSchema(key)], ['정답 초안', keyDraftSchema()]] as const) {
    assert.equal((schema as any).type, 'object', `${name}: 뿌리가 object`);
    assert.deepEqual(strictProblems(schema), [], name);
  }
  assert.ok(strictProblems({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }).length > 0, '검사기가 빠진 required를 잡는다');
});
