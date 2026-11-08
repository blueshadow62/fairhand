import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFiles, coversSaved, hasFile, naturalCompare, nextRotation, pendingPages, saveRanges, SHEET_ACCEPT, sheetKind, sortByName } from '../src/renderer/lib/sheets.js';

test('saveRanges: 목록 차례로 장 번호를 이어 받고, 저장하지 않는 파일은 순번 없이 건너뛴다', () => {
  assert.deepEqual(saveRanges([{ 포함: true, 쪽수: 3 }, { 포함: false, 쪽수: 2 }, { 포함: true, 쪽수: 1 }], 4), [
    { 순번: 1, 처음: 4, 끝: 6 }, null, { 순번: 2, 처음: 7, 끝: 7 }]);
  assert.deepEqual(saveRanges([], 1), []);
  assert.deepEqual(saveRanges([{ 포함: false, 쪽수: 5 }], 1), [null]);
});

test('naturalCompare: 숫자는 수로(2 < 10, 001 < 010), 대소문자는 가리지 않는다', () => {
  assert.deepEqual(['scan10.pdf', 'scan2.pdf', 'Scan1.pdf'].sort(naturalCompare), ['Scan1.pdf', 'scan2.pdf', 'scan10.pdf']);
  assert.deepEqual(['010.jpg', '002.jpg', '001.jpg'].sort(naturalCompare), ['001.jpg', '002.jpg', '010.jpg']);
  assert.equal(naturalCompare('A반.pdf', 'a반.pdf'), 0);
});

test('appendFiles·sortByName·hasFile: 새 묶음은 그 안에서만 이름 순으로 맨 뒤에, 기존 순서는 그대로, 같은 지문은 같은 파일', () => {
  const f = (이름: string, 지문: string) => ({ 이름, 지문 });
  let list = appendFiles([], [f('3반.pdf', 'c'), f('10반.pdf', 'd')]);
  assert.deepEqual(list.map(x => x.이름), ['3반.pdf', '10반.pdf']); // 한 묶음 안은 이름 자연 순서
  list = [list[1]!, list[0]!]; // 손으로 바꾼 순서
  list = appendFiles(list, [f('2반.pdf', 'b'), f('1반.pdf', 'a')]);
  assert.deepEqual(list.map(x => x.이름), ['10반.pdf', '3반.pdf', '1반.pdf', '2반.pdf']); // 기존 순서 그대로, 새 파일은 뒤에
  assert.deepEqual(sortByName(list).map(x => x.이름), ['1반.pdf', '2반.pdf', '3반.pdf', '10반.pdf']);
  assert.deepEqual(list.map(x => x.이름), ['10반.pdf', '3반.pdf', '1반.pdf', '2반.pdf']); // 정렬은 새 목록을 돌려준다
  assert.deepEqual(sortByName([f('scan.pdf', 'x'), f('scan.pdf', 'y')]).map(x => x.지문), ['x', 'y']); // 이름이 같으면 원래 차례
  assert.equal(hasFile(list, 'b'), true); // 이름이 달라도 같은 지문이면 같은 파일
  assert.equal(hasFile(list, 'z'), false);
  assert.equal(hasFile([], 'a'), false);
});

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
