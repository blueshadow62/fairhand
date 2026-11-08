import test from 'node:test';
import assert from 'node:assert/strict';
import { coversSaved, nextRotation, pendingPages, SHEET_ACCEPT, sheetKind } from '../src/renderer/lib/sheets.js';

test('sheetKind: 끌어다 놓은 파일도 고르기 창과 같은 기준(PDF·사진), 이름이나 형식 하나로 알아본다', () => {
  assert.equal(sheetKind('3반.PDF', ''), 'pdf');
  assert.equal(sheetKind('scan', 'application/pdf'), 'pdf');
  assert.equal(sheetKind('p001.jpeg', 'image/jpeg'), 'image');
  assert.equal(sheetKind('사진', 'image/png'), 'image');
  for (const [name, type] of [['명단.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['메모.txt', 'text/plain'], ['정답표.json', 'application/json'], ['폴더', '']] as const)
    assert.equal(sheetKind(name, type), null, name);
  for (const ext of SHEET_ACCEPT.split(',')) assert.ok(sheetKind(`답안지${ext}`, ''), ext); // 고르기 창이 보이는 파일은 모두 받는다
});

test('coversSaved: 전사 시작(장을 정하지 않음)이나 새로 저장한 장을 모두 담은 전사만 그 장을 맡는다', () => {
  assert.equal(coversSaved([4, 5, 6], undefined), true);
  assert.equal(coversSaved([4, 5, 6], [4, 5, 6]), true);
  assert.equal(coversSaved([4, 5, 6], [2, 4, 5, 6, 9]), true);
  assert.equal(coversSaved([4, 5, 6], [5]), false); // 다시 전사할 장 하나만
  assert.equal(coversSaved([], [5]), true);
});

test('nextRotation: 시계 방향으로 90°씩, 270° 다음은 0°', () => {
  assert.deepEqual(([0, 90, 180, 270] as const).map(nextRotation), [90, 180, 270, 0]);
});

test('pendingPages: 전사가 없는 장만(전사 시작이 할 장), 장 순서 그대로', () => {
  assert.deepEqual(pendingPages([1, 2, 3, 7], [{ page: 2 }, { page: 7 }]), [1, 3]);
  assert.deepEqual(pendingPages([1, 2], [{ page: 1 }, { page: 2 }, { page: 9 }]), []); // 그림이 없는 장의 전사는 세지 않는다
  assert.deepEqual(pendingPages([], []), []);
});
