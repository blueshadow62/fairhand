import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseKey } from '../core/key.js';
import { listPages } from '../core/setio.js';
import { DataError } from '../core/types.js';
import type { TrashEntry } from '../shared/ipc.js';
import { resolveSetDir, uniqueFolderName } from './paths.js';

/**
 * 프로그램 안 휴지통: 학기 폴더 아래 `.휴지통/<원래이름>__<시각>/`로 옮긴다.
 * Windows 휴지통과 달리 프로그램이 목록을 보여 주고 되살리거나 영구 삭제할 수 있다.
 * `.휴지통` 안에는 정답표.json이 바로 없으므로 listSets에 세트로 잡히지 않는다.
 */
export const TRASH_DIR = '.휴지통';
const MANIFEST = '휴지통.json';
const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

function trashItemDir(semesterDir: string, id: string): string {
  if (!id.trim() || id === '.' || id === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(id)) throw new DataError(`휴지통 항목 이름이 잘못되었습니다: '${id}'`);
  return path.join(semesterDir, TRASH_DIR, id);
}

export async function trashSet(semesterDir: string, 폴더: string, now: Date = new Date()): Promise<TrashEntry> {
  const from = resolveSetDir(semesterDir, 폴더);
  if (!existsSync(from)) throw new DataError(`세트 폴더가 없습니다: ${폴더}`);
  let info: Partial<TrashEntry> = {};
  try {
    const key = parseKey(await readFile(path.join(from, '정답표.json'), 'utf-8'));
    const 전사수 = (await readdir(path.join(from, 'transcripts')).catch(() => [] as string[])).filter(n => /^p\d+\.json$/i.test(n)).length;
    info = { 글: key.글, 학년: key.대상.학년, 반: key.대상.반, 쪽수: (await listPages(from)).length, 전사수 };
  } catch { /* 정답표가 깨진 세트도 휴지통으로는 보낼 수 있다 */ }
  await mkdir(path.join(semesterDir, TRASH_DIR), { recursive: true });
  const id = uniqueFolderName(path.join(semesterDir, TRASH_DIR), `${폴더}__${stamp(now)}`, existsSync);
  const to = trashItemDir(semesterDir, id);
  try { await rename(from, to); } catch (e) { throw new DataError(`세트를 휴지통으로 옮기지 못했습니다(파일이 열려 있는지 확인): ${(e as Error).message}`); }
  const entry: TrashEntry = { id, 원래이름: 폴더, 삭제일시: now.toISOString(), ...info };
  await writeFile(path.join(to, MANIFEST), JSON.stringify(entry, null, 1), 'utf-8');
  return entry;
}

export async function listTrash(semesterDir: string): Promise<TrashEntry[]> {
  const dir = path.join(semesterDir, TRASH_DIR);
  let names: string[] = [];
  try { names = (await readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const out: TrashEntry[] = [];
  for (const id of names) {
    try { out.push({ ...JSON.parse(await readFile(path.join(dir, id, MANIFEST), 'utf-8')), id }); }
    catch { out.push({ id, 원래이름: id.replace(/__\d{8}-\d{6}.*$/, ''), 삭제일시: '' }); }
  }
  return out.sort((a, b) => b.삭제일시.localeCompare(a.삭제일시));
}

/** 되살린다. 같은 이름의 세트가 생겼으면 ' (2)'를 붙인다. 되살린 폴더 이름을 돌려준다 */
export async function restoreSet(semesterDir: string, id: string): Promise<string> {
  const from = trashItemDir(semesterDir, id);
  if (!existsSync(from)) throw new DataError('휴지통에 그런 항목이 없습니다');
  let 원래이름 = id.replace(/__\d{8}-\d{6}.*$/, '');
  try { 원래이름 = (JSON.parse(await readFile(path.join(from, MANIFEST), 'utf-8')) as TrashEntry).원래이름 || 원래이름; } catch { /* 설명 파일 없으면 이름에서 */ }
  const 폴더 = uniqueFolderName(semesterDir, 원래이름, existsSync);
  const to = resolveSetDir(semesterDir, 폴더);
  try { await rename(from, to); } catch (e) { throw new DataError(`되살리지 못했습니다: ${(e as Error).message}`); }
  await rm(path.join(to, MANIFEST), { force: true }); // 옮기기가 실패해도 휴지통 목록의 설명이 남도록 뒤에 지운다
  return 폴더;
}

/** 영구 삭제. 되돌릴 수 없다 */
export async function purgeSet(semesterDir: string, id: string): Promise<void> {
  const dir = trashItemDir(semesterDir, id);
  if (!existsSync(dir)) throw new DataError('휴지통에 그런 항목이 없습니다');
  try { await rm(dir, { recursive: true, force: true }); } catch (e) { throw new DataError(`영구 삭제하지 못했습니다(파일이 열려 있는지 확인): ${(e as Error).message}`); }
}
