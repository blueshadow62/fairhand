import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedoPages } from '../src/renderer/lib/redo-pages.js';

// 가짜 자료: 장 1~8, 이름은 지어낸 것
const pages = [1, 2, 3, 4, 5, 6, 7, 8];
const trs = [
  { page: 1, 이름: '가나다' }, { page: 2, 이름: ' 라마바 ' }, { page: 3, 이름: null },
  { page: 5, 이름: '가나다' }, { page: 9, 이름: '사아자' }, // 9장은 세트에 없다(지운 장의 전사)
];
const ok = (p: number[], byName: { 이름: string; pages: number[] }[] = []) => ({ pages: p, byName, bad: [], unknown: [], missing: [] });

test('resolveRedoPages: 장 번호·p 번호·범위는 parsePageSpec과 같은 뜻', () => {
  assert.deepEqual(resolveRedoPages('7', pages, trs), ok([7]));
  assert.deepEqual(resolveRedoPages('p7', pages, trs), ok([7]));
  assert.deepEqual(resolveRedoPages('P07, p1-p3', pages, trs), ok([1, 2, 3, 7]));
  assert.deepEqual(resolveRedoPages(' 7, 3 - 4 ,3', pages, trs), ok([3, 4, 7]));
  // 반-번호처럼 보여도 숫자-숫자는 장 범위다
  assert.deepEqual(resolveRedoPages('3-6', pages, trs), ok([3, 4, 5, 6]));
});

test('resolveRedoPages: 이름(앞뒤 공백 무시)과 섞어 쓰기', () => {
  assert.deepEqual(resolveRedoPages('라마바', pages, trs), ok([2], [{ 이름: '라마바', pages: [2] }]));
  assert.deepEqual(resolveRedoPages(' 라마바 , p7,1-2', pages, trs), ok([1, 2, 7], [{ 이름: '라마바', pages: [2] }]));
});

test('resolveRedoPages: 같은 이름 여러 장은 모두, 이름별로 장을 알린다', () => {
  assert.deepEqual(resolveRedoPages('가나다, 가나다', pages, trs), ok([1, 5], [{ 이름: '가나다', pages: [1, 5] }]));
});

test('resolveRedoPages: 없는 이름·세트에 없는 장·틀린 번호는 따로 알린다', () => {
  const r = resolveRedoPages('없는이름, 사아자, 12, 5-3, 1-2-3, 2', pages, trs);
  assert.deepEqual(r.pages, [2]);
  assert.deepEqual(r.unknown, ['없는이름', '사아자']); // 지운 장의 전사 이름으로는 찾지 않는다
  assert.deepEqual(r.missing, [12]);
  assert.deepEqual(r.bad, ['5-3', '1-2-3']);
});

test('resolveRedoPages: 빈 입력은 아무것도 없다', () => {
  assert.deepEqual(resolveRedoPages('', pages, trs), ok([]));
  assert.deepEqual(resolveRedoPages(' , ', pages, trs), ok([]));
});
