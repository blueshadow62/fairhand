import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrash, purgeSet, restoreSet, trashSet, TRASH_DIR } from '../src/main/trash.js';
import { listSets } from '../src/main/paths.js';
import { DataError } from '../src/core/types.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));

async function semester(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-trash-'));
  await cp(FX, path.join(dir, '세트A'), { recursive: true });
  return dir;
}

test('trashSet → listTrash → restoreSet: 목록에 보이고 세트 목록에서는 사라졌다가 되살아난다', async () => {
  const dir = await semester();
  try {
    const e = await trashSet(dir, '세트A', new Date(2026, 10, 6, 9, 30, 0));
    assert.equal(e.원래이름, '세트A'); assert.ok(e.id.startsWith('세트A__20261106-093000'));
    assert.equal(e.전사수, 3);
    assert.deepEqual((await listSets(dir)).map(s => s.폴더), []);           // 휴지통 안은 세트가 아니다
    const list = await listTrash(dir);
    assert.equal(list.length, 1); assert.equal(list[0]!.글, e.글);
    const back = await restoreSet(dir, e.id);
    assert.equal(back, '세트A');
    assert.deepEqual((await listSets(dir)).map(s => s.폴더), ['세트A']);
    assert.deepEqual(await listTrash(dir), []);
    assert.ok(!existsSync(path.join(dir, '세트A', '휴지통.json')));         // 설명 파일은 따라오지 않는다
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('같은 이름이 이미 있으면 (2)로 되살리고, 영구 삭제는 지운다', async () => {
  const dir = await semester();
  try {
    const e = await trashSet(dir, '세트A');
    await cp(FX, path.join(dir, '세트A'), { recursive: true });
    assert.equal(await restoreSet(dir, e.id), '세트A (2)');
    const e2 = await trashSet(dir, '세트A (2)');
    await purgeSet(dir, e2.id);
    assert.deepEqual(await listTrash(dir), []);
    assert.deepEqual(await readdir(path.join(dir, TRASH_DIR)), []);
    await assert.rejects(purgeSet(dir, '..'), DataError);
    await assert.rejects(restoreSet(dir, '없는것'), DataError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
