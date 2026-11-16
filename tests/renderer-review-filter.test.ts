import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilter, missingStudents, toItems } from '../src/renderer/lib/review-filter.js';
import type { AnswerKey, Transcript } from '../src/core/types.js';

const t = (page: number, 번호: number | null, extra: Partial<Transcript> = {}): Transcript => ({ page, 학년: 3, 반: 1, 번호, 이름: null, 식별확신: '확실', 정량: {}, 정성: {}, 비고: [], ...extra });

test('toItems: 같은 학년·반·번호가 두 장이면 중복', () => {
  const items = toItems([t(1, 5), t(2, 5), t(3, 6)]);
  assert.deepEqual(items.map(i => i.중복), [true, true, false]);
});

test('applyFilter: 문제 먼저, 비고만, 반, 검색', () => {
  const items = toItems([t(1, 1), t(2, 2, { 비고: ['x'] }), t(3, 3, { 식별확신: '불명', 번호: null }), t(4, 4, { 반: 2 }), t(5, 1)]);
  assert.deepEqual(applyFilter(items, { 비고만: false, 문제먼저: true, 반: null, 검색: '', 미확인만: false }).map(i => i.page), [1, 5, 3, 2, 4]);
  assert.deepEqual(applyFilter(items, { 비고만: true, 문제먼저: false, 반: null, 검색: '', 미확인만: false }).map(i => i.page), [2]);
  assert.deepEqual(applyFilter(items, { 비고만: false, 문제먼저: false, 반: 2, 검색: '', 미확인만: false }).map(i => i.page), [4]);
  assert.deepEqual(applyFilter(items, { 비고만: false, 문제먼저: false, 반: null, 검색: '4', 미확인만: false }).map(i => i.page), [4]);
});

test('applyFilter: 반·번호 순, 읽지 못한 번호는 뒤, 번호를 고치면 제자리로', () => {
  const none = { 비고만: false, 문제먼저: false, 반: null, 검색: '', 미확인만: false };
  // 3쪽은 반만 읽혀 1반 끝, 6쪽은 아무것도 못 읽어 맨 끝
  const sheets = [t(1, 3, { 반: 2 }), t(2, 10), t(3, null, { 식별확신: '불명' }), t(4, 2), t(5, 1, { 반: 2 }), t(6, null, { 학년: null, 반: null, 식별확신: '불명' })];
  assert.deepEqual(applyFilter(toItems(sheets), none).map(i => i.page), [4, 2, 3, 5, 1, 6]);
  sheets[1] = t(2, 1); // 손글씨 10을 1로 고쳐 저장
  assert.deepEqual(applyFilter(toItems(sheets), none).map(i => i.page), [2, 4, 3, 5, 1, 6]);
});

test('missingStudents: 명단이 없으면 인원 기준, 있으면 명단 기준', () => {
  const key = { 세트: 's', 글: 'g', 학기: 'h', 대상: { 학년: 3, 반: [1], 인원: { '1': 3 } }, 정량: [], 정성: [] } as AnswerKey;
  assert.deepEqual(missingStudents(key, [t(1, 1), t(2, 3)], null), [{ 학년: 3, 반: 1, 번호: 2, 이름: null }]);
  assert.deepEqual(missingStudents(key, [t(1, 1)], [{ 학년: 3, 반: 1, 번호: 1, 이름: '가' }, { 학년: 3, 반: 1, 번호: 2, 이름: '나' }]), [{ 학년: 3, 반: 1, 번호: 2, 이름: '나' }]);
});
