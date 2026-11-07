import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { fromJudgeOutput, judgePage, judgeRequest, judgeSchema } from '../src/engine/judge.js';
import { loadRules } from '../src/engine/rules.js';
import { EngineError, type RawResult, type StructuredProvider } from '../src/engine/provider.js';
import type { Transcript } from '../src/core/types.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const t: Transcript = { page: 2, 학년: 3, 반: 1, 번호: 2, 이름: null, 식별확신: '확실', 정량: { '1-1': { 답: '은영이', 판정: 'X' }, '3-1': { 답: '', 판정: '빈칸' } }, 정성: { E1: { 응답: false, 답: '' } }, 비고: ['기존'] };

test('judgeSchema·judgeRequest: 글만, 단위 목록', async () => {
  const s = judgeSchema(key) as any;
  assert.deepEqual(s.properties.quant.items.properties.id.enum, ['1-1', '3-1']);
  const r = judgeRequest(key, await loadRules(), t);
  assert.equal(r.imageJpegBase64, undefined);
  assert.ok(r.system.includes('# 작업: 재판정'));
  assert.deepEqual(JSON.parse(r.user), { page: 2, quant: { '1-1': '은영이', '3-1': '' } });
  assert.equal(r.effort, 'medium');
});

test('fromJudgeOutput: 단위 빠짐·중복·이상한 값은 invalid-output', () => {
  assert.throws(() => fromJudgeOutput({ quant: [{ id: '1-1', verdict: 'O' }, { id: '1-1', verdict: 'X' }, { id: '3-1', verdict: 'X' }] }, key), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  assert.deepEqual(fromJudgeOutput({ quant: [{ id: '1-1', verdict: 'O' }, { id: '3-1', verdict: '빈칸' }] }, key), { '1-1': 'O', '3-1': '빈칸' });
  assert.throws(() => fromJudgeOutput({ quant: [{ id: '1-1', verdict: 'O' }] }, key), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  assert.throws(() => fromJudgeOutput({ quant: [{ id: '1-1', verdict: 'ㅇ' }, { id: '3-1', verdict: 'X' }] }, key), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
});

test('judgePage: 판정만 바꾸고 답은 그대로, 빈 답은 빈칸 유지, 비고에 근거', async () => {
  const p: StructuredProvider = { id: 'api', async complete(): Promise<RawResult> { return { output: { quant: [{ id: '1-1', verdict: 'O' }, { id: '3-1', verdict: 'X' }] }, model: 'm' }; } };
  const r = await judgePage(p, key, await loadRules(), t, new AbortController().signal);
  assert.equal(r.transcript.정량['1-1']!.판정, 'O');
  assert.equal(r.transcript.정량['1-1']!.답, '은영이');
  assert.equal(r.transcript.정량['3-1']!.판정, '빈칸');
  assert.deepEqual(r.changes.map(c => [c.단위, c.이전, c.이후]), [['1-1', 'X', 'O']]);
  assert.deepEqual(r.transcript.비고, ['기존', '모델 재판정: 1-1 X→O']);
  const again = await judgePage(p, key, await loadRules(), r.transcript, new AbortController().signal);
  assert.deepEqual(again.transcript.비고, ['기존', '모델 재판정: 1-1 X→O']); // 바뀜 없으면 비고 그대로
});

test('judgePage: 선생님 사례와 정답 글자 일치는 모델 판정보다 우선한다', async () => {
  const p: StructuredProvider = { id: 'api', async complete(): Promise<RawResult> { return { output: { quant: [{ id: '1-1', verdict: 'O' }, { id: '3-1', verdict: 'X' }] }, model: 'm' }; } };
  const withCase = { ...key, 사례: [{ 단위: '1-1', 답: '은영이', 판정: 'X' as const, 일시: '2026-11-06', 출처: '검토' }] };
  const r = await judgePage(p, withCase, await loadRules(), t, new AbortController().signal);
  assert.equal(r.transcript.정량['1-1']!.판정, 'X'); // 모델은 O라 했지만 사례 X가 남는다
  assert.deepEqual(r.changes, []);
  const exact: Transcript = { ...t, 정량: { ...t.정량, '1-1': { 답: '가나', 판정: 'X' } } }; // 픽스처 정답표의 1-1 정답은 '가나'
  const p2: StructuredProvider = { id: 'api', async complete(): Promise<RawResult> { return { output: { quant: [{ id: '1-1', verdict: 'X' }, { id: '3-1', verdict: 'X' }] }, model: 'm' }; } };
  const r2 = await judgePage(p2, key, await loadRules(), exact, new AbortController().signal);
  assert.equal(r2.transcript.정량['1-1']!.판정, 'O'); // 정답과 글자가 같으면 모델이 X라 해도 O
  assert.deepEqual(r2.changes.map(c => [c.단위, c.이후, c.근거]), [['1-1', 'O', '정답']]);
  assert.ok(r2.transcript.비고.includes('모델 재판정: 1-1 X→O (정답)'));
});
