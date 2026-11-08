import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRotation, pendingPages } from '../src/renderer/lib/sheets.js';

test('nextRotation: 시계 방향으로 90°씩, 270° 다음은 0°', () => {
  assert.deepEqual(([0, 90, 180, 270] as const).map(nextRotation), [90, 180, 270, 0]);
});

test('pendingPages: 전사가 없는 장만(전사 시작이 할 장), 장 순서 그대로', () => {
  assert.deepEqual(pendingPages([1, 2, 3, 7], [{ page: 2 }, { page: 7 }]), [1, 3]);
  assert.deepEqual(pendingPages([1, 2], [{ page: 1 }, { page: 2 }, { page: 9 }]), []); // 그림이 없는 장의 전사는 세지 않는다
  assert.deepEqual(pendingPages([], []), []);
});
