import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { ApiProvider, buildRequest, classifyApiError } from '../src/engine/api.js';
import { EngineError, transcribeRequest } from '../src/engine/provider.js';
import { loadRules } from '../src/engine/rules.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const rules = await loadRules();
const input = { imageJpegBase64: 'AAAA', key, rules, page: 2, effort: 'high' as const };
const out = { page: 2, grade: 3, class: 1, number: 2, name: null, id_confidence: '추정', quant: [{ id: '1-1', answer: '', verdict: '빈칸' }, { id: '3-1', answer: '', verdict: '빈칸' }], qual: [{ id: 'E1', responded: false, answer: '' }], notes: ['번호 흐림'] };
const fakeClient = (reply: any) => {
  const calls: any[] = [];
  return { calls, client: { beta: { messages: { create: async (p: any) => { calls.push(p); if (reply instanceof Error) throw reply; return reply; } } } } };
};

test('buildRequest: 모델·스키마·그림·effort·fallbacks', () => {
  const r = buildRequest(transcribeRequest(input)) as any;
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.max_tokens, 16000);
  assert.equal(r.output_config.effort, 'high');
  assert.equal(r.output_config.format.type, 'json_schema');
  assert.deepEqual(r.output_config.format.schema.properties.quant.items.properties.id.enum, ['1-1', '3-1']);
  assert.deepEqual(r.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(r.fallbacks, 'default');
  assert.equal(r.thinking, undefined); assert.equal(r.temperature, undefined);
  assert.ok(typeof r.system === 'string' && r.system.includes('## 학생 식별'));
});

test('ApiProvider: 첫 text 블록을 JSON으로 읽고 토큰 수를 돌려준다', async () => {
  const f = fakeClient({ stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1234, output_tokens: 321 } });
  const r = await new ApiProvider({ client: f.client }).transcribe(input, new AbortController().signal);
  assert.deepEqual(r.output, out); assert.equal(r.inputTokens, 1234); assert.equal(r.outputTokens, 321); assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(f.calls.length, 1);
});

test('ApiProvider: 거절·텍스트 없음·JSON 아님', async () => {
  const sig = new AbortController().signal;
  await assert.rejects(new ApiProvider({ client: fakeClient({ stop_reason: 'refusal', content: [], usage: {} }).client }).transcribe(input, sig), (e: unknown) => e instanceof EngineError && e.kind === 'refusal');
  await assert.rejects(new ApiProvider({ client: fakeClient({ stop_reason: 'end_turn', content: [], usage: {} }).client }).transcribe(input, sig), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  await assert.rejects(new ApiProvider({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{깨짐' }], usage: {} }).client }).transcribe(input, sig), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
});

test('classifyApiError: 상태 코드별 종류', () => {
  const withStatus = (status: number) => Object.assign(new Error(`status ${status}`), { status });
  assert.equal(classifyApiError(withStatus(401)).kind, 'signed-out');
  assert.equal(classifyApiError(withStatus(429)).kind, 'rate-limit');
  assert.equal(classifyApiError(withStatus(529)).kind, 'overloaded');
  assert.equal(classifyApiError(withStatus(400)).kind, 'other');
  assert.equal(classifyApiError(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' })).kind, 'network');
  assert.equal(classifyApiError(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })).kind, 'timeout');
});

test('ApiProvider: 키도 client도 없으면 signed-out', async () => {
  await assert.rejects(new ApiProvider({}).transcribe(input, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'signed-out');
});

test('buildRequest: 그림 없는 요청은 text 블록만, system은 그대로', () => {
  const r = buildRequest({ system: 'S', user: 'U', schema: { type: 'object' }, effort: 'medium' });
  assert.equal(r.system, 'S');
  assert.deepEqual(r.messages[0]!.content, [{ type: 'text', text: 'U' }]);
  assert.equal((r.output_config as any).effort, 'medium');
});

test('buildRequest: images[]가 모두 image 블록으로', () => {
  const r = buildRequest({ system: 'S', user: 'U', images: ['A', 'B'], schema: { type: 'object' }, effort: 'high' });
  assert.deepEqual((r.messages[0]!.content as any[]).map(c => c.type), ['image', 'image', 'text']);
});

test('buildRequest: 모델 인수가 요청의 model이 된다', () => {
  assert.equal(buildRequest({ system: 'S', user: 'U', schema: { type: 'object' }, effort: 'medium' }, 'claude-sonnet-5-5').model, 'claude-sonnet-5-5');
  assert.equal(buildRequest({ system: 'S', user: 'U', schema: { type: 'object' }, effort: 'medium' }).model, 'claude-opus-5-5');
});
