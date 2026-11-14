import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey, keyProblems, isConfirmed, fullScore, headcount, gradingRules, DEFAULT_RULES } from '../src/core/key.js';
import { DataError } from '../src/core/types.js';

const FX = new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url);

test('parseKey: 픽스처를 읽고 단위 수를 센다', () => {
  const k = parseKey(readFileSync(FX, 'utf-8'));
  assert.equal(k.학기, '2026 2학기');
  assert.deepEqual(k.정량.map(u => u.id), ['1-1', '3-1']);
  assert.equal(fullScore(k), 3);
  assert.equal(isConfirmed(k), false);
});

test('keyProblems: 세트의 노력 단계는 없거나 low~max만 받는다', () => {
  const k = parseKey(readFileSync(FX, 'utf-8'));
  assert.equal(k.노력, undefined);
  for (const 노력 of ['low', 'medium', 'high', 'xhigh', 'max']) assert.deepEqual(keyProblems({ ...k, 노력 }), []);
  for (const 노력 of ['turbo', '', 3, null]) assert.ok(keyProblems({ ...k, 노력 }).some(p => p.includes('노력')), String(노력));
});

test('배점: 만점은 배점의 합(없으면 1점), 0 이하·글자·100 넘는 배점은 정답표 오류', () => {
  const k = parseKey(readFileSync(FX, 'utf-8'));
  assert.equal(fullScore({ ...k, 정량: k.정량.map(u => ({ ...u, 배점: 0.1 })), 정성: k.정성.map(u => ({ ...u, 배점: 0.2 })) }), 0.4);
  const bad = (배점: unknown) => keyProblems({ ...k, 정량: [{ ...k.정량[0]!, 배점 }] }).some(p => p.includes('배점'));
  assert.equal(bad(2), false);
  assert.equal(bad(0), true);
  assert.equal(bad('2'), true);
  assert.equal(bad(101), true);
});

test('논술형 단위는 종류(인용·용어)가 있어야 한다', () => {
  const k = parseKey(readFileSync(FX, 'utf-8'));
  const essay = (종류: unknown) => keyProblems({ ...k, 정량: [{ id: '9-1', 문항: 9, 설명: 'x', 정답: 'y', 유형: '논술형', 종류 }] }).some(p => p.includes('종류'));
  assert.equal(essay('인용'), false);
  assert.equal(essay('용어'), false);
  assert.equal(essay(undefined), true);
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

test('parseKey: 단위의 유형 필드가 그대로 남는다', () => {
  const k = parseKey(JSON.stringify({ 세트: 's', 글: 'g', 학기: '2026 2학기', 대상: { 학년: 2, 반: [2] }, 정량: [{ id: '1-1', 문항: 1, 설명: 'a', 정답: 'b', 유형: '요소형' }], 정성: [] }));
  assert.equal(k.정량[0]!.유형, '요소형');
});

test('채점규칙 기본값과 검증, 사례 검증', () => {
  const base = { 세트: 's', 글: 'g', 학기: '2026 2학기', 대상: { 학년: 2, 반: [2] }, 정량: [{ id: '1-1', 문항: 1, 설명: 'a', 정답: 'b' }], 정성: [] };
  assert.deepEqual(gradingRules(parseKey(JSON.stringify(base))), DEFAULT_RULES);
  assert.equal(gradingRules(parseKey(JSON.stringify({ ...base, 채점규칙: { 넓은말: '인정' } }))).넓은말, '인정');
  assert.throws(() => parseKey(JSON.stringify({ ...base, 채점규칙: { 맞춤법: '대충' } })), /채점규칙/);
  assert.throws(() => parseKey(JSON.stringify({ ...base, 사례: [{ 단위: '9-9', 답: 'x', 판정: 'O', 일시: '', 출처: '' }] })), /사례/);
  assert.throws(() => parseKey(JSON.stringify({ ...base, 사례: [{ 단위: '1-1', 답: '', 판정: 'O', 일시: '', 출처: '' }] })), /사례/);
});

test('keyProblems: id 형식과 허용·핵심 자료형을 저장 때 잡는다(첫 전사에서 멈추지 않게)', () => {
  const p = keyProblems({ 학기: '2026 2학기', 대상: { 학년: 3, 반: [1] },
    정량: [{ id: '1-①', 문항: 1, 설명: '', 정답: 'a' }, { id: '2-1', 문항: '2', 설명: '', 정답: 'b', 허용: [15], 핵심: 'x' }], 정성: [] });
  assert.ok(p.some(s => s.includes("id '1-①'")));
  assert.ok(p.some(s => s.includes('2-1: 문항 번호')));
  assert.ok(p.some(s => s.includes('2-1: 허용은 글자 목록')));
  assert.ok(p.some(s => s.includes('2-1: 핵심은 글자 목록')));
  assert.deepEqual(keyProblems({ 학기: '2026 2학기', 대상: { 학년: 3, 반: [1] }, 정량: [{ id: 'E_1.a', 문항: 1, 설명: '', 정답: 'a', 허용: ['b'] }], 정성: [] }), []);
});
