import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { parseTranscript } from '../src/core/transcript.js';
import { evaluate, formatSummary } from '../src/engine/eval.js';

const FX = new URL('../../tests/fixtures/세트샘플/', import.meta.url);
const key = parseKey(readFileSync(new URL('정답표.json', FX), 'utf-8'));
const ref = ['p01.json', 'p02.json', 'p03.json'].map(n => parseTranscript(readFileSync(new URL(`transcripts/${n}`, FX), 'utf-8'), n));

test('evaluate: 같으면 전부 일치', () => {
  const s = evaluate(key, ref, ref);
  assert.equal(s.비교장수, 3); assert.equal(s.식별정확, 3);
  assert.equal(s.판정일치, s.판정총수); assert.equal(s.판정총수, 6); // 3장 × 정량 2
  assert.equal(s.응답일치, s.응답총수); assert.equal(s.응답총수, 3);
  assert.deepEqual(s.합계차이, { '0': 3 });
});

test('evaluate: 틀린 판정·번호·응답을 센다', () => {
  const got = ref.map(t => structuredClone(t));
  got[0]!.정량['1-1'] = { 답: '은영', 판정: 'X' };      // 판정 불일치 1, 합계 -1
  got[1]!.번호 = 7;                                      // 식별 틀림
  got[2]!.정성['E1'] = { 응답: true, 답: '…' };          // 응답 불일치 1, 합계 +1
  const s = evaluate(key, ref, got);
  assert.equal(s.식별정확, 2); assert.equal(s.판정일치, 5); assert.equal(s.응답일치, 2);
  assert.deepEqual(s.합계차이, { '-1': 1, '0': 1, '1': 1 });
  assert.deepEqual(s.장별[0]!.판정불일치, ['1-1']); assert.equal(s.장별[1]!.식별, false); assert.deepEqual(s.장별[2]!.응답불일치, ['E1']);
  assert.match(formatSummary(s), /판정 일치 5\/6/);
});

test('evaluate: got에 없는 장은 비교에서 뺀다', () => {
  const s = evaluate(key, ref, [ref[0]!]);
  assert.equal(s.장수, 3); assert.equal(s.비교장수, 1);
});
