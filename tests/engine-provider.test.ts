import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { EngineError, toTranscript, withRetry, userFacingMessage } from '../src/engine/provider.js';
import { transcribeRequest } from '../src/engine/provider.js';
import { loadRules, systemPrompt, userText } from '../src/engine/rules.js';
import { transcriptSchema } from '../src/engine/schema.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const info = { 엔진: 'cli' as const, 모델: 'claude-opus-5-5', effort: 'high', 규칙: 'transcribe-v1', 일시: '2026-11-06T01:00:00+09:00' };
const good = { page: 4, grade: 3, class: 1, number: 9, name: null, id_confidence: '확실',
  quant: [{ id: '1-1', answer: '은영', verdict: 'O' }, { id: '3-1', answer: '', verdict: '빈칸' }], qual: [{ id: 'E1', responded: false, answer: '' }], notes: [] };

test('toTranscript: 올바른 출력에 전사정보를 붙인다', () => {
  const t = toTranscript(good, key, 4, info);
  assert.equal(t.page, 4);
  assert.deepEqual(t.전사정보, info);
  assert.equal(t.확인완료, false);
});

test('toTranscript_rejects_wrong_page', () => {
  assert.throws(() => toTranscript({ ...good, page: 5 }, key, 4, info), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output' && /page/.test(e.message));
});

test('toTranscript: 빠진 단위·중복 단위·목록 아닌 출력은 invalid-output(빈칸으로 세지 않는다)', () => {
  const invalid = (re: RegExp) => (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output' && re.test(e.message);
  assert.throws(() => toTranscript({ ...good, quant: [good.quant[0]!] }, key, 4, info), invalid(/누락.*3-1/));
  assert.throws(() => toTranscript({ ...good, qual: [] }, key, 4, info), invalid(/누락.*E1/));
  assert.throws(() => toTranscript({ ...good, quant: [...good.quant, good.quant[0]!] }, key, 4, info), invalid(/1-1.*두 번/));
  assert.throws(() => toTranscript({ ...good, quant: { '1-1': { answer: '', verdict: '빈칸' } } }, key, 4, info), invalid(/목록/));
});

test('toTranscript: 정답표에 없는 단위·잘못된 판정·문자열 응답은 invalid-output', () => {
  assert.throws(() => toTranscript({ ...good, quant: [...good.quant, { id: '9-9', answer: '', verdict: 'O' }] }, key, 4, info), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  assert.throws(() => toTranscript({ ...good, quant: [{ id: '1-1', answer: '', verdict: 'ㅇ' }, good.quant[1]!] }, key, 4, info), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  assert.throws(() => toTranscript({ ...good, qual: [{ id: 'E1', responded: 'false', answer: '' }] }, key, 4, info), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  assert.throws(() => toTranscript('글자', key, 4, info), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
});

test('withRetry: 재시도 가능한 오류만 정해진 횟수만큼 다시 한다', async () => {
  let n = 0;
  const ok = await withRetry(async () => { n++; if (n < 3) throw new EngineError('network', 'x'); return 'done'; }, new AbortController().signal, [1, 1, 1]);
  assert.equal(ok, 'done'); assert.equal(n, 3);
  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new EngineError('signed-out', 'x'); }, new AbortController().signal, [1, 1, 1]), (e: unknown) => e instanceof EngineError && e.kind === 'signed-out');
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new EngineError('network', 'x'); }, new AbortController().signal, [1, 1]), (e: unknown) => e instanceof EngineError && e.kind === 'network');
  assert.equal(n, 3);
});

test('withRetry: 중단되면 바로 cancelled', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(withRetry(async () => 1, ac.signal), (e: unknown) => e instanceof EngineError && e.kind === 'cancelled');
});

test('userFacingMessage: 종류별 한글 안내', () => {
  assert.match(userFacingMessage(new EngineError('signed-out', 'x')), /로그인/);
  assert.match(userFacingMessage(new EngineError('needs-update', 'x')), /업데이트/);
  assert.match(userFacingMessage(new EngineError('rate-limit', 'x', Date.parse('2026-11-06T10:00:00+09:00'))), /한도/);
  assert.match(userFacingMessage(new Error('boom')), /boom/);
});

test('transcribeRequest: 규칙+정답표 시스템 프롬프트, 쪽 지시, 그림, 스키마를 한 요청으로', async () => {
  const rules = await loadRules();
  const r = transcribeRequest({ imageJpegBase64: 'AAAA', key, rules, page: 3, effort: 'high' });
  assert.equal(r.system, systemPrompt(rules, key));
  assert.equal(r.user, userText(3));
  assert.equal(r.imageJpegBase64, 'AAAA');
  assert.deepEqual(r.schema, transcriptSchema(key));
  assert.equal(r.effort, 'high');
});
