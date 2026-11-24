import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptAllSuggestions, acceptSuggestion, addSuggestions, discardSuggestion, nextSuggestion, nextUnit, regionAt, regionChanges, regionCount, sameRect, setRegion, startDraft, stepUnit, undoRegion, unitOrder, type Regions } from '../src/renderer/lib/region-batch.js';

const A = { x: 0.1, y: 0.2, w: 0.8, h: 0.1 }, B = { x: 0.1, y: 0.4, w: 0.3, h: 0.05 }, C = { x: 0.5, y: 0.4, w: 0.3, h: 0.05 };
const order = ['1-1', '1-2', '2-1', 'E1'];

test('unitOrder: 정답표 순서대로 정량 다음 정성', () => {
  const key = { 정량: [{ id: '2-1' }, { id: '1-1' }], 정성: [{ id: 'E1' }] } as any;
  assert.deepEqual(unitOrder(key), ['2-1', '1-1', 'E1']);
});

test('nextUnit: 뒤에서 답 칸이 없는 첫 단위, 없으면 앞으로 돌아가고, 모두 잡았으면 목록의 다음(끝이면 그대로)', () => {
  assert.equal(nextUnit(order, { '1-1': A }, '1-1'), '1-2');
  assert.equal(nextUnit(order, { '1-1': A, '1-2': B }, '1-1'), '2-1'); // 이미 잡은 단위는 건너뛴다
  assert.equal(nextUnit(order, { '2-1': A, E1: B }, 'E1'), '1-1'); // 끝에서 앞으로 돌아간다
  const all: Regions = { '1-1': A, '1-2': A, '2-1': A, E1: A };
  assert.equal(nextUnit(order, all, '1-2'), '2-1');
  assert.equal(nextUnit(order, all, 'E1'), 'E1');
  assert.equal(nextUnit(['1-1'], { '1-1': A }, '1-1'), '1-1');
});

test('stepUnit: 위·아래로 한 칸, 끝에서 멈춘다', () => {
  assert.equal(stepUnit(order, '1-2', 1), '2-1');
  assert.equal(stepUnit(order, '1-2', -1), '1-1');
  assert.equal(stepUnit(order, '1-1', -1), '1-1');
  assert.equal(stepUnit(order, 'E1', 1), 'E1');
  assert.equal(stepUnit(order, '없음', 1), '1-1');
});

test('regionAt: 누른 곳의 칸, 겹치면 작은 칸 먼저, 빈 곳은 null', () => {
  const big = { x: 0, y: 0.3, w: 1, h: 0.3 };
  const regions: Regions = { '1-1': big, '1-2': B, '2-1': C };
  assert.equal(regionAt(order, regions, { x: 0.2, y: 0.42 }), '1-2'); // 큰 칸 안의 작은 칸
  assert.equal(regionAt(order, regions, { x: 0.45, y: 0.35 }), '1-1');
  assert.equal(regionAt(order, regions, { x: 0.6, y: 0.42 }), '2-1');
  assert.equal(regionAt(order, regions, { x: 0.5, y: 0.9 }), null);
  assert.equal(regionAt(order, { '1-1': B, '1-2': { ...B } }, { x: 0.2, y: 0.42 }), '1-1'); // 크기가 같으면 목록 앞
  assert.equal(regionAt(['1-1'], { '9-9': B }, { x: 0.2, y: 0.42 }), null); // 목록에 없는 단위의 칸은 고르지 않는다
});

test('setRegion·undoRegion: 고침을 쌓고 여러 번 되돌리며, 되돌린 단위를 알려 준다', () => {
  const d0 = startDraft({ E1: C });
  const d1 = setRegion(d0, '1-1', A);
  const d2 = setRegion(d1, '1-1', B); // 이미 있으면 바꾼다
  const d3 = setRegion(d2, 'E1', null);
  assert.deepEqual(d3.regions, { '1-1': B });
  assert.equal(d3.edits.length, 3);
  assert.deepEqual(d0.regions, { E1: C }); // 앞의 상태는 바뀌지 않는다
  assert.equal(setRegion(d3, '1-1', { ...B }), d3); // 같은 칸이면 고침이 쌓이지 않는다
  assert.equal(setRegion(d3, '2-1', null), d3);
  const u1 = undoRegion(d3)!;
  assert.equal(u1.단위, 'E1'); assert.deepEqual(u1.draft.regions, { '1-1': B, E1: C });
  const u2 = undoRegion(u1.draft)!;
  assert.equal(u2.단위, '1-1'); assert.deepEqual(u2.draft.regions, { '1-1': A, E1: C });
  const u3 = undoRegion(u2.draft)!;
  assert.deepEqual(u3.draft.regions, { E1: C });
  assert.equal(undoRegion(u3.draft), null);
});

test('regionChanges: 처음과 달라진 단위만(지운 것은 null), 되돌려 같아진 단위는 넣지 않는다', () => {
  const initial: Regions = { '1-1': A, E1: C };
  let d = startDraft(initial);
  assert.deepEqual(regionChanges(initial, d.regions), {});
  d = setRegion(d, '1-2', B);
  d = setRegion(d, 'E1', null);
  d = setRegion(d, '1-1', B);
  d = setRegion(d, '1-1', { ...A }); // 처음 값으로 다시
  assert.deepEqual(regionChanges(initial, d.regions), { '1-2': B, E1: null });
  assert.deepEqual(regionChanges(undefined, { '1-1': A }), { '1-1': A });
});

test('sameRect·regionCount', () => {
  assert.ok(sameRect(null, undefined));
  assert.ok(!sameRect(A, null));
  assert.ok(!sameRect(A, { ...A, h: 0.11 }));
  assert.equal(regionCount(order, { '1-1': A, E1: C, '9-9': B }), 2);
  assert.equal(regionCount(order, undefined), 0);
});

test('AI 제안: 저장할 칸과 따로 두고, 받기·버리기·덮어쓰기·모두 받기가 되돌리기에 든다', () => {
  const initial: Regions = { E1: C };
  const d = addSuggestions(startDraft(initial), { '1-1': A, '1-2': B, '2-1': null, E1: B }, '1-1'); // 찾지 못한 단위는 건너뛰고, 이미 잡은 칸은 그대로
  assert.deepEqual(d.regions, { E1: C });
  assert.deepEqual(d.ai, { '1-1': A, '1-2': B, E1: B });
  assert.deepEqual(regionChanges(initial, d.regions), {}); // 받기 전에는 저장할 변경이 없다
  assert.equal(nextSuggestion(order, d.ai, '1-1'), '1-2');
  assert.equal(nextSuggestion(order, d.ai, 'E1'), '1-1'); // 끝에서 앞으로
  const a = acceptSuggestion(d, '1-1');
  assert.deepEqual([a.regions['1-1'], a.ai['1-1']], [A, undefined]);
  assert.equal(acceptSuggestion(a, '1-1'), a); // 제안이 없으면 그대로
  const dragged = setRegion(a, '1-2', C); // 사람이 끌면 제안은 사라진다
  assert.deepEqual([dragged.regions['1-2'], dragged.ai['1-2']], [C, undefined]);
  const dropped = discardSuggestion(dragged, 'E1'); // 버려도 이미 잡은 칸은 남는다
  assert.deepEqual([dropped.regions.E1, dropped.ai.E1], [C, undefined]);
  assert.equal(nextSuggestion(order, dropped.ai, '1-1'), null);
  assert.deepEqual(regionChanges(initial, dropped.regions), { '1-1': A, '1-2': C });
  let u = undoRegion(dropped)!; assert.equal(u.단위, 'E1'); assert.deepEqual(u.draft.ai.E1, B);
  u = undoRegion(u.draft)!; assert.equal(u.단위, '1-2'); assert.deepEqual([u.draft.regions['1-2'], u.draft.ai['1-2']], [undefined, B]);
  u = undoRegion(u.draft)!; assert.deepEqual([u.draft.regions['1-1'], u.draft.ai['1-1']], [undefined, A]);
  u = undoRegion(u.draft)!; assert.deepEqual(u.draft.ai, {}); // 제안 받아 오기도 한 번에 되돌린다
  const all = acceptAllSuggestions(d, ['1-1', '1-2']); // 목록에 든 단위만, 한 번의 고침
  assert.deepEqual(all.regions, { E1: C, '1-1': A, '1-2': B });
  assert.deepEqual(all.ai, { E1: B });
  assert.equal(all.edits.length, d.edits.length + 1);
  assert.deepEqual(undoRegion(all)!.draft.ai, d.ai);
  assert.equal(acceptAllSuggestions(startDraft(initial), order).edits.length, 0);
});
