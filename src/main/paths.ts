import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseKey } from '../core/key.js';
import { listPages } from '../core/setio.js';
import { DataError } from '../core/types.js';
import type { SetInfo } from '../shared/ipc.js';

/** 렌더러가 보낸 '폴더 이름'을 학기 폴더 바로 아래로만 푼다. 구분자·..·절대 경로는 거절. */
export function resolveSetDir(semesterDir: string, 폴더: string): string {
  const name = 폴더.trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new DataError(`세트 폴더 이름이 잘못되었습니다: '${폴더}'`);
  const dir = path.join(semesterDir, name);
  const rel = path.relative(semesterDir, dir);
  if (rel !== name || path.isAbsolute(rel)) throw new DataError(`세트 폴더가 학기 폴더 밖을 가리킵니다: '${폴더}'`);
  return dir;
}

export async function listSets(semesterDir: string): Promise<SetInfo[]> {
  let names: string[] = [];
  try { names = (await readdir(semesterDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const out: SetInfo[] = [];
  for (const 폴더 of names.sort((a, b) => a.localeCompare(b, 'ko'))) {
    const dir = path.join(semesterDir, 폴더);
    let key;
    try { key = parseKey(await readFile(path.join(dir, '정답표.json'), 'utf-8')); } catch { continue; } // 정답표가 없거나 깨진 폴더는 세트가 아니다
    const 전사수 = (await readdir(path.join(dir, 'transcripts')).catch(() => [] as string[])).filter(n => /^p\d+\.json$/i.test(n)).length;
    out.push({ 폴더, key, 쪽수: (await listPages(dir)).length, 전사수 });
  }
  return out;
}

export async function nextPageNumber(setDir: string): Promise<number> {
  const pages = await listPages(setDir);
  return pages.length ? Math.max(...pages) + 1 : 1;
}

export const pageFile = (setDir: string, page: number): string => path.join(setDir, 'pages', `p${String(page).padStart(2, '0')}.jpg`);

export function uniqueFolderName(semesterDir: string, base: string, exists: (p: string) => boolean): string {
  let name = base;
  for (let n = 2; exists(path.join(semesterDir, name)); n++) name = `${base} (${n})`;
  return name;
}
