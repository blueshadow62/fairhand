import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingPages } from '../src/renderer/lib/sheets.js';

test('pendingPages: 전사가 없는 장만(전사 시작이 할 장), 장 순서 그대로', () => {
  assert.deepEqual(pendingPages([1, 2, 3, 7], [{ page: 2 }, { page: 7 }]), [1, 3]);
  assert.deepEqual(pendingPages([1, 2], [{ page: 1 }, { page: 2 }, { page: 9 }]), []); // 그림이 없는 장의 전사는 세지 않는다
  assert.deepEqual(pendingPages([], []), []);
});
