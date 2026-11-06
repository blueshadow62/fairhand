import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGuard, makeLeaveGuard, parsePageSpec, tag } from '../src/renderer/lib/screen-utils.js';
import type { LeaveChoice } from '../src/shared/ipc.js';

test('parsePageSpec: 범위·쉼표·중복·정렬, 거꾸로 된 범위와 글자는 null', () => {
  assert.deepEqual(parsePageSpec('1-3,7'), [1, 2, 3, 7]);
  assert.deepEqual(parsePageSpec(' 7, 3 - 4 ,3'), [3, 4, 7]);
  assert.equal(parsePageSpec('5-3,7'), null); // 전에는 문항 설정 쪽 판이 [7]만 돌려줬다
  assert.equal(parsePageSpec('a'), null);
  assert.equal(parsePageSpec(''), null);
  assert.equal(tag(7), 'p07');
});

test('makeGuard: 예외를 알림으로', async () => {
  const seen: string[] = [];
  const guard = makeGuard(m => seen.push(m));
  await guard(async () => { throw new Error('터짐'); });
  await guard(async () => undefined);
  assert.deepEqual(seen, ['터짐']);
});

test('makeLeaveGuard: 깨끗하면 바로, 머무르기/저장/버리기', async () => {
  let dirty = true, saved = 0, choice: LeaveChoice = 'stay';
  const leave = makeLeaveGuard({ askLeave: async () => choice }, { isDirty: () => dirty, save: async () => { saved++; dirty = false; }, discard: () => { dirty = false; } });
  assert.equal(await leave(), false);
  choice = 'save'; assert.equal(await leave(), true); assert.equal(saved, 1); assert.equal(dirty, false);
  dirty = true; choice = 'discard'; assert.equal(await leave(), true); assert.equal(dirty, false);
  assert.equal(await leave(), true); // 깨끗하면 묻지 않는다
  // 저장이 안 되면(검증 오류로 dirty가 남음) 머문다
  dirty = true; choice = 'save';
  const stay = makeLeaveGuard({ askLeave: async () => choice }, { isDirty: () => dirty, save: async () => undefined, discard: () => undefined });
  assert.equal(await stay(), false);
});
