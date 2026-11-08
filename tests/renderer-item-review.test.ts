import test from 'node:test';
import assert from 'node:assert/strict';
import { anonLabels, anonOrder, groupAnswers, progress, sortGroups, unitSummaries, type AnswerGroup } from '../src/renderer/lib/item-review.js';
import type { AnswerKey, Panjeong, Transcript } from '../src/core/types.js';

const key = { 세트: 's', 글: 'g', 학기: 'h', 대상: { 학년: 3, 반: [1] },
  정량: [{ id: '1-1', 문항: 1, 설명: '빈칸', 정답: '가나' }, { id: '2-1', 문항: 2, 설명: '단답', 정답: '다' }],
  정성: [{ id: 'E1', 문항: 3, 설명: '생각' }] } as AnswerKey;
const tr = (page: number, a: string, v: Panjeong, extra: Partial<Transcript> = {}): Transcript => ({
  page, 학년: 3, 반: 1, 번호: page, 이름: `학생${page}`, 식별확신: '확실',
  정량: { '1-1': { 답: a, 판정: v }, '2-1': { 답: '다', 판정: 'O' } }, 정성: { E1: { 응답: true, 답: '' } }, 비고: [], ...extra });

test('groupAnswers: normalizeAnswer 기준으로 묶고 대표 답·판정 분포·갈림·확인 수를 센다', () => {
  const ts = [tr(1, '가나.', 'O'), tr(2, ' 가나', 'X', { 확인단위: ['1-1'] }), tr(3, '가나.', 'O', { 확인완료: true }), tr(4, '', '빈칸'), tr(5, '다라', 'X')];
  const g = new Map(groupAnswers(ts, '1-1').map(x => [x.정규, x]));
  assert.deepEqual([...g.keys()].sort(), ['', '가나', '다라']);
  const 가나 = g.get('가나')!;
  assert.equal(가나.대표, '가나.');
  assert.deepEqual(가나.장, [1, 2, 3]);
  assert.deepEqual(가나.판정, { O: 2, X: 1, 빈칸: 0 });
  assert.equal(가나.갈림, true);
  assert.equal(가나.확인, 2);
  assert.equal(g.get('')!.대표, '');
  assert.equal(g.get('다라')!.갈림, false);
  // 전사에 단위가 없으면 빈 답·빈칸으로 본다
  const missing = tr(6, '', '빈칸'); delete missing.정량['1-1'];
  assert.deepEqual(groupAnswers([missing], '1-1'), [{ 정규: '', 대표: '', 장: [6], 판정: { O: 0, X: 0, 빈칸: 1 }, 갈림: false, 확인: 0 }]);
});

test('sortGroups: 갈린 묶음 → 미확인 → 장 수 많은 순 → 답 가나다순', () => {
  const g = (대표: string, n: number, 갈림 = false, 확인 = 0): AnswerGroup => ({ 정규: 대표, 대표, 장: Array.from({ length: n }, (_, i) => i + 1), 판정: { O: n, X: 0, 빈칸: 0 }, 갈림, 확인 });
  const order = sortGroups([g('하', 5, false, 5), g('나', 1), g('다', 3), g('가', 1), g('라', 2, true, 2)]).map(x => x.대표);
  assert.deepEqual(order, ['라', '다', '가', '나', '하']);
});

test('anonOrder: 장 번호와 무관한 순서. 같은 소금·단위면 늘 같고, 소금·단위가 바뀌면 달라진다', () => {
  const pages = Array.from({ length: 30 }, (_, i) => i + 1);
  const a = anonOrder('s1', '1-1', pages);
  assert.deepEqual([...a].sort((x, y) => x - y), pages); // 빠짐·겹침 없음
  assert.deepEqual(anonOrder('s1', '1-1', [...pages].reverse()), a); // 넘긴 순서와도 무관
  assert.notDeepEqual(a, pages);
  assert.notDeepEqual(anonOrder('s2', '1-1', pages), a);
  assert.notDeepEqual(anonOrder('s1', '2-1', pages), a);
  const labels = anonLabels('s1', '1-1', pages);
  assert.deepEqual([...labels.values()].sort((x, y) => x - y), pages);
  assert.equal(labels.get(a[0]!), 1);
});

test('unitSummaries·progress: 정량 → 정성 순서, 확인 수는 확인단위나 확인 완료인 장', () => {
  const ts = [tr(1, '가나', 'O', { 확인완료: true }), tr(2, '가나', 'X', { 확인단위: ['1-1', 'E1'] }), tr(3, '다라', 'X')];
  const s = unitSummaries(key, ts);
  assert.deepEqual(s.map(x => [x.id, x.정량, x.확인, x.전체, x.갈림]), [['1-1', true, 2, 3, 1], ['2-1', true, 1, 3, 0], ['E1', false, 2, 3, 0]]);
  assert.deepEqual(progress(key, ts), { 단위: 0, 단위전체: 3, 장: 1, 장전체: 3 });
  assert.deepEqual(progress(key, ts.map(t => ({ ...t, 확인완료: true }))), { 단위: 3, 단위전체: 3, 장: 3, 장전체: 3 });
  assert.deepEqual(progress(key, []), { 단위: 0, 단위전체: 3, 장: 0, 장전체: 0 });
});
