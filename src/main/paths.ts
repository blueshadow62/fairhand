import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseKey } from '../core/key.js';
import { listPages, pageImageName } from '../core/setio.js';
import { DataError } from '../core/types.js';
import type { SetInfo } from '../shared/ipc.js';

/** 렌더러가 보낸 장 번호 목록: 1 이상 정수만, 겹침은 하나로, 한 번에 1000장까지 */
export function pagesToDelete(pages: unknown): number[] {
  if (!Array.isArray(pages) || !pages.length) throw new DataError('지울 장이 없습니다');
  if (pages.length > 1000) throw new DataError('한 번에 1000장까지 지울 수 있습니다');
  if (!pages.every(p => Number.isInteger(p) && p >= 1)) throw new DataError('잘못된 장 번호가 있습니다');
  return [...new Set(pages as number[])].sort((a, b) => a - b);
}

/** 렌더러가 보낸 '폴더 이름'을 학기 폴더 바로 아래로만 푼다. 구분자·..·절대 경로는 거절. */
export function resolveSetDir(semesterDir: string, 폴더: string): string {
  const name = 폴더.trim();
  // Windows 예약 이름(CON, NUL…)은 장치로 풀려 읽기가 멈추고, 끝 점·공백은 다른 이름으로 풀린다
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\..*)?$/i.test(name) || /[. ]$/.test(name)) throw new DataError(`세트 폴더 이름이 잘못되었습니다: '${폴더}'`);
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

export const pageFile = (setDir: string, page: number): string => path.join(setDir, 'pages', pageImageName(page));

export function uniqueFolderName(semesterDir: string, base: string, exists: (p: string) => boolean): string {
  let name = base;
  for (let n = 2; exists(path.join(semesterDir, name)); n++) name = `${base} (${n})`;
  return name;
}
