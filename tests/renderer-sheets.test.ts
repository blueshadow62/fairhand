import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFiles, coversSaved, dropSlot, hasFile, moveBefore, naturalCompare, nextRotation, pendingPages, saveRanges, SHEET_ACCEPT, sheetKind, sortByName } from '../src/renderer/lib/sheets.js';

test('moveBefore: before번째 앞으로 옮기고(목록 길이면 맨 뒤), 제자리·범위 밖은 그대로', () => {
  const abc = ['a', 'b', 'c'];
  assert.deepEqual(moveBefore(abc, 0, 2), ['b', 'a', 'c']); // a를 c 앞으로
  assert.deepEqual(moveBefore(abc, 0, 3), ['b', 'c', 'a']); // 맨 뒤로
  assert.deepEqual(moveBefore(abc, 2, 0), ['c', 'a', 'b']); // 맨 앞으로
  assert.deepEqual(moveBefore(abc, 1, 0), ['b', 'a', 'c']); // Alt+←: before = i - 1
  assert.deepEqual(moveBefore(abc, 1, 3), ['a', 'c', 'b']); // Alt+→: before = i + 2
  for (const [from, before] of [[1, 1], [1, 2], [0, -1], [2, 4], [3, 0], [-1, 1]] as const) assert.deepEqual(moveBefore(abc, from, before), abc, `${from}→${before}`);
  assert.deepEqual(abc, ['a', 'b', 'c']); // 새 목록을 돌려준다
});

test('dropSlot: 같은 줄에서 가장 가까운 칩의 가운데 기준 앞뒤, 여러 줄로 감긴 칩, 줄 사이 틈과 밖', () => {
  // 한 줄에 칩 둘(0, 1), 다음 줄에 칩 하나(2). 칩 높이 40, 줄 간격 10
  const boxes = [{ left: 0, top: 0, right: 100, bottom: 40 }, { left: 110, top: 0, right: 210, bottom: 40 }, { left: 0, top: 50, right: 100, bottom: 90 }];
  assert.deepEqual(dropSlot(boxes, 20, 20), { before: 0, chip: 0, after: false }); // 0의 왼쪽 절반
  assert.deepEqual(dropSlot(boxes, 80, 20), { before: 1, chip: 0, after: true }); // 0의 오른쪽 절반
  assert.deepEqual(dropSlot(boxes, 105, 20), { before: 1, chip: 0, after: true }); // 0과 1 사이 틈(가까운 쪽은 0)
  assert.deepEqual(dropSlot(boxes, 300, 20), { before: 2, chip: 1, after: true }); // 줄 끝 오른쪽 빈 곳
  assert.deepEqual(dropSlot(boxes, 90, 70), { before: 3, chip: 2, after: true }); // 둘째 줄 칩 뒤 = 맨 뒤
  assert.deepEqual(dropSlot(boxes, 30, 44), { before: 0, chip: 0, after: false }); // 줄 사이 틈의 위쪽 반은 윗줄
  assert.deepEqual(dropSlot(boxes, 30, 47), { before: 2, chip: 2, after: false }); // 아래쪽 반은 아랫줄
  assert.equal(dropSlot(boxes, 30, 200), null); // 어느 줄에도 걸치지 않음
  assert.equal(dropSlot([], 0, 0), null);
});

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
