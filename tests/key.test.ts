import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey, keyProblems, isConfirmed, fullScore, headcount } from '../src/core/key.js';
import { DataError } from '../src/core/types.js';

const FX = new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url);

test('parseKey: 픽스처를 읽고 단위 수를 센다', () => {
  const k = parseKey(readFileSync(FX, 'utf-8'));
  assert.equal(k.학기, '2026 2학기');
  assert.deepEqual(k.정량.map(u => u.id), ['1-1', '3-1']);
  assert.equal(fullScore(k), 3);
  assert.equal(isConfirmed(k), false);
});

test('parseKey: 학기가 없으면 DataError', () => {
  assert.throws(() => parseKey('{"대상":{"학년":3,"반":[1]},"정량":[],"정성":[]}', 'x.json'),
    (e: unknown) => e instanceof DataError && /x\.json/.test(e.message) && /학기/.test(e.message));
});

test('parseKey: JSON 문법 오류는 파일명과 함께', () => {
  assert.throws(() => parseKey('{깨짐', '정답표.json'), (e: unknown) => e instanceof DataError && /정답표\.json/.test(e.message));
});

test('keyProblems: id 중복과 정답 없음을 잡는다', () => {
  const p = keyProblems({ 학기: '2026 2학기', 대상: { 학년: 3, 반: [1] },
    정량: [{ id: '1-1', 문항: 1, 설명: '', 정답: 'a' }, { id: '1-1', 문항: 1, 설명: '' }], 정성: [] });
  assert.ok(p.some(s => s.includes('id 중복: 1-1')));
  assert.ok(p.some(s => s.includes('정답이 없습니다')));
});

test('headcount: 인원 키가 문자열이든 숫자든 읽는다', () => {
  const base = { 세트: 's', 글: 'g', 학기: '2026 2학기', 정량: [], 정성: [] };
  assert.equal(headcount({ ...base, 대상: { 학년: 3, 반: [1], 인원: { '1': 12 } } }, 1), 12);
  assert.equal(headcount({ ...base, 대상: { 학년: 3, 반: [1], 인원: { 1: 12 } as never } }, 1), 12);
  assert.equal(headcount({ ...base, 대상: { 학년: 3, 반: [1] } }, 1), undefined);
});

test('keyProblems_class_must_be_integer: 대상.반·학년이 글자면 잡는다', () => {
  const base = { 학기: '2026 2학기', 정량: [], 정성: [] };
  assert.ok(keyProblems({ ...base, 대상: { 학년: 3, 반: ['1'] } }).some(s => s.includes('대상.반')));
  assert.ok(keyProblems({ ...base, 대상: { 학년: '3', 반: [1] } }).some(s => s.includes('대상.학년')));
  assert.deepEqual(keyProblems({ ...base, 대상: { 학년: 3, 반: [1, 3] } }), []);
});
