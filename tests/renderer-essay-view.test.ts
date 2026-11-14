import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transcript } from '../src/core/types.js';
import { essaySpanViews, essayTextOf } from '../src/renderer/lib/essay-view.js';

test('essaySpanViews: 표기는 색(허용은 따로), 찾은 부분은 밑줄, 단위 표시는 tags일 때 표기의 첫 조각에만', () => {
  const ps = [
    { text: '나는 ' },
    { text: '배움은', 근거: '정답' as const, 단위: '5-1', 시작: true, 찾음: ['5-1'] },
    { text: ' 삶이다', 근거: '정답' as const, 단위: '5-1' },
    { text: '학습자중심', 근거: '허용' as const, 단위: '5-2', 시작: true },
    { text: ' 수업', 찾음: ['5-2', '5-3'] },
  ];
  const vs = essaySpanViews(ps, true);
  assert.deepEqual(vs.map(v => [v.text, v.cls, v.tag ?? null]), [
    ['나는 ', '', null], ['배움은', 'key-hit found', '5-1'], [' 삶이다', 'key-hit', null], ['학습자중심', 'key-hit allow', '5-2'], [' 수업', 'found', null]]);
  assert.equal(vs[1]!.title, '정답 표기 (5-1) · AI가 찾은 부분: 5-1');
  assert.equal(vs[4]!.title, 'AI가 찾은 부분: 5-2, 5-3');
  assert.equal(vs[0]!.title, '');
  // 한 단위만 칠하는 문항별 검토는 단위 표시를 하지 않는다
  const one = essaySpanViews(ps, false);
  assert.ok(one.every(v => v.tag === undefined));
  assert.equal(one[3]!.title, '허용 표기');
});

test('essayTextOf: 논술형 단위는 그 문항의 글 전체, 다른 유형이나 글을 받기 전의 장은 undefined', () => {
  const tr: Transcript = { page: 1, 학년: 3, 반: 1, 번호: 1, 이름: null, 식별확신: '확실', 정량: {}, 정성: {}, 비고: [], 논술글: { 9: '글 전체', 10: '' } };
  assert.equal(essayTextOf(tr, { 유형: '논술형', 문항: 9 }), '글 전체');
  assert.equal(essayTextOf(tr, { 유형: '논술형', 문항: 10 }), '');
  assert.equal(essayTextOf(tr, { 유형: '논술형', 문항: 11 }), undefined);
  assert.equal(essayTextOf(tr, { 유형: '단답형', 문항: 9 }), undefined);
  assert.equal(essayTextOf({ ...tr, 논술글: undefined }, { 유형: '논술형', 문항: 9 }), undefined);
});
