import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSets, nextPageNumber, pagesToDelete, resolveSetDir, uniqueFolderName } from '../src/main/paths.js';
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
