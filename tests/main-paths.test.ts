import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countProgress, isConfirmedTranscript, listSets, nextPageNumber, pagesToDelete, resolveSetDir, uniqueFolderName } from '../src/main/paths.js';
import { DataError } from '../src/core/types.js';

test('resolveSetDir: Windows 예약 이름과 끝 점·공백은 거절', () => {
  for (const bad of ['CON', 'nul', 'COM1', 'con.txt', '세트.']) assert.throws(() => resolveSetDir('C:\\학기', bad), DataError, bad);
  assert.equal(resolveSetDir('C:\\학기', 'console'), path.join('C:\\학기', 'console'));
});

test('resolveSetDir: 폴더 이름만 받고 학기 폴더 바로 아래로 제한', () => {
  assert.equal(resolveSetDir('D:\\학기', '2026 3학년'), path.join('D:\\학기', '2026 3학년'));
  for (const bad of ['', ' ', '..', '../x', 'a\\b', 'a/b', 'C:\\x', '2026 3학년\\..\\..\\etc'])
    assert.throws(() => resolveSetDir('D:\\학기', bad), DataError, bad);
});

test('listSets·nextPageNumber: 정답표가 있는 폴더만, 쪽 번호는 마지막+1', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-sets-'));
  try {
    const fx = fileURLToPath(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url));
    await mkdir(path.join(dir, '세트A', 'pages'), { recursive: true });
    await writeFile(path.join(dir, '세트A', '정답표.json'), await readFile(fx, 'utf-8'));
    await writeFile(path.join(dir, '세트A', 'pages', 'p01.jpg'), ''); await writeFile(path.join(dir, '세트A', 'pages', 'p07.jpg'), '');
    await mkdir(path.join(dir, '정답표없음'));
    const sets = await listSets(dir);
    assert.deepEqual(sets.map(s => [s.폴더, s.쪽수, s.전사수]), [['세트A', 2, 0]]);
    assert.equal(await nextPageNumber(path.join(dir, '세트A')), 8);
    assert.equal(await nextPageNumber(path.join(dir, '정답표없음')), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('isConfirmedTranscript: 확인완료가 true일 때만, 깨진 글은 확인이 아니다', () => {
  assert.equal(isConfirmedTranscript(JSON.stringify({ page: 1, 확인완료: true })), true);
  for (const text of [JSON.stringify({ page: 1, 확인완료: false }), JSON.stringify({ 확인완료: 'true' }), '{}', 'null', '5', '{ 깨진', ''])
    assert.equal(isConfirmedTranscript(text), false, text);
});

test('countProgress: 확인한 전사만 확인으로, 못 읽은 파일은 건너뛰고, 전사 파일이 없는 장은 미전사', () => {
  const f = (name: string, 확인: boolean | null) => ({ name, 확인 });
  assert.deepEqual(countProgress([1, 2, 3, 7], [
    f('p01.json', true), f('p02.json', false),
    f('p03.json', null), // 못 읽었어도 파일이 있어 전사 시작이 건너뛰므로 전사로는 센다
    f('p09.json', true), // 그림이 없는 전사도 검토 목록에 나온다
    f('p01.json.tmp', true), // 저장하다 남은 임시 파일은 전사가 아니다
    f('메모.txt', true),
  ]), { 전사수: 4, 확인수: 2, 미전사수: 1 }); // p07만 전사가 없다
  assert.deepEqual(countProgress([], []), { 전사수: 0, 확인수: 0, 미전사수: 0 });
  assert.deepEqual(countProgress([1, 2], []), { 전사수: 0, 확인수: 0, 미전사수: 2 });
  assert.equal(countProgress([100], [f('p100.json', false)]).미전사수, 0); // 100장째도 파일 이름 규칙(p100)이 같다
});

test('listSets: 전사 파일을 읽어 검토 확인 수와 전사 안 한 장 수를 세고(폴더 이름순), 바뀐 파일은 다시 읽는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-sets-'));
  try {
    const key = await readFile(fileURLToPath(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url)), 'utf-8');
    for (const name of ['세트B', '세트A']) {
      await mkdir(path.join(dir, name, 'pages'), { recursive: true });
      await writeFile(path.join(dir, name, '정답표.json'), key);
    }
    const b = path.join(dir, '세트B'), tr = (p: string) => path.join(b, 'transcripts', `${p}.json`);
    for (const p of ['p01', 'p02', 'p03']) await writeFile(path.join(b, 'pages', `${p}.jpg`), '');
    await mkdir(path.join(b, 'transcripts'));
    await writeFile(tr('p01'), JSON.stringify({ page: 1, 확인완료: true }));
    await writeFile(tr('p02'), '{ 깨진 파일');
    const row = async () => (await listSets(dir)).map(s => [s.폴더, s.쪽수, s.전사수, s.확인수, s.미전사수]);
    assert.deepEqual(await row(), [['세트A', 0, 0, 0, 0], ['세트B', 3, 2, 1, 1]]);
    // 검토에서 확인을 풀거나 깨진 전사를 고치거나 새로 전사하면 다음 목록에 바로 보인다(지난번에 읽은 값을 그대로 쓰지 않는다)
    await writeFile(tr('p01'), JSON.stringify({ page: 1, 확인완료: false }));
    await writeFile(tr('p02'), JSON.stringify({ page: 2, 확인완료: true }));
    await writeFile(tr('p03'), JSON.stringify({ page: 3, 확인완료: true }));
    assert.deepEqual(await row(), [['세트A', 0, 0, 0, 0], ['세트B', 3, 3, 2, 0]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('uniqueFolderName: 겹치면 (2), (3)', () => {
  const taken = new Set([path.join('D:\\학기', 'a'), path.join('D:\\학기', 'a (2)')]); // 경로 결합은 운영체제 규칙을 따른다
  assert.equal(uniqueFolderName('D:\\학기', 'a', p => taken.has(p)), 'a (3)');
  assert.equal(uniqueFolderName('D:\\학기', 'b', p => taken.has(p)), 'b');
});

test('pagesToDelete: 1 이상 정수만 받고, 겹침은 하나로 줄여 차례대로', () => {
  assert.deepEqual(pagesToDelete([7, 2, 7, 3]), [2, 3, 7]);
  for (const bad of [[], [0], [1.5], ['2'], [-1], 'p01', null, undefined, Array.from({ length: 1001 }, (_, i) => i + 1)])
    assert.throws(() => pagesToDelete(bad), DataError, JSON.stringify(bad)?.slice(0, 30));
});
