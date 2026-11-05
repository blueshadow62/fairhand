import test from 'node:test';
import assert from 'node:assert/strict';
import { keyDraftSchema, keyDraftRequest, fromKeyDraftOutput, draftKey } from '../src/engine/keydraft.js';
import { loadRules } from '../src/engine/rules.js';
import { EngineError, type StructuredProvider, type RawResult } from '../src/engine/provider.js';

const out = { quant: [
    { id: '1-1', question: 1, description: '최 __ 과장', answer: '은영', accepted: ['최은영'], keywords: [] },
    { id: '3-1', question: 3, description: '조직 ___', answer: '생활을 하려면 붙임성이 있어야 한다', accepted: [], keywords: ['붙임성'] } ],
  qual: [{ id: 'E1', question: 1, description: '여의도공원 파견의 문제점' }], cautions: ['지문 없이 만든 초안'] };

test('keyDraftSchema: 영문 키, 추가 속성 금지, 배열 필수', () => {
  const s = keyDraftSchema() as any;
  assert.deepEqual(s.required.sort(), ['cautions', 'qual', 'quant']);
  assert.equal(s.properties.quant.items.additionalProperties, false);
  assert.deepEqual(s.properties.quant.items.required.sort(), ['accepted', 'answer', 'description', 'id', 'keywords', 'question']);
  assert.ok(!JSON.stringify(s).includes('"additionalProperties":true'));
});

test('keyDraftRequest: 규칙 + 글·문제·지문, 지문이 없으면 그렇다고 적는다', async () => {
  const rules = await loadRules('keydraft-v1');
  const r = keyDraftRequest({ 글: '알바생 자르기', 문제: '1. 최 __ 과장' }, rules);
  assert.ok(r.system.startsWith(rules.본문.trimEnd()));
  assert.ok(r.user.includes('알바생 자르기') && r.user.includes('1. 최 __ 과장'));
  assert.ok(r.user.includes('지문 없음'));
  assert.equal(r.imageJpegBase64, undefined);
  assert.equal(r.effort, 'high');
  const r2 = keyDraftRequest({ 글: 'x', 문제: 'y', 지문: '본문입니다' }, rules);
  assert.ok(r2.user.includes('본문입니다') && !r2.user.includes('지문 없음'));
});

test('fromKeyDraftOutput: 한글 양식으로 바꾸고 빈 허용·핵심은 뺀다', () => {
  const d = fromKeyDraftOutput(out);
  assert.deepEqual(d.정량[0], { id: '1-1', 문항: 1, 설명: '최 __ 과장', 정답: '은영', 허용: ['최은영'] });
  assert.deepEqual(d.정량[1], { id: '3-1', 문항: 3, 설명: '조직 ___', 정답: '생활을 하려면 붙임성이 있어야 한다', 핵심: ['붙임성'] });
  assert.deepEqual(d.정성, [{ id: 'E1', 문항: 1, 설명: '여의도공원 파견의 문제점' }]);
  assert.deepEqual(d.주의, ['지문 없이 만든 초안']);
});

test('fromKeyDraftOutput: id 중복·형식 오류·빈 정답은 invalid-output', () => {
  const bad = (q: unknown) => assert.throws(() => fromKeyDraftOutput({ ...out, quant: q }), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  bad([out.quant[0], out.quant[0]]);
  bad([{ ...out.quant[0], id: '문항1' }]);
  bad([{ ...out.quant[0], answer: '' }]);
  bad('글자');
});

test('draftKey: 제공자에 요청을 보내고 검증된 초안을 돌려준다', async () => {
  const p: StructuredProvider = { id: 'api', async complete(): Promise<RawResult> { return { output: out, model: 'm' }; } };
  const d = await draftKey(p, { 글: 'x', 문제: 'y' }, new AbortController().signal);
  assert.equal(d.정량.length, 2);
});
