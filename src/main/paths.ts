import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseKey } from '../core/key.js';
import { listPages, pageImageName, transcriptFileName } from '../core/setio.js';
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

/** transcripts 폴더에서 전사로 세는 파일 이름(세트 목록의 전사 수가 전부터 쓰던 규칙) */
const isTranscriptName = (n: string): boolean => /^p\d+\.json$/i.test(n);

/** 검토에서 확인 완료한 전사의 글인지. 깨진 글은 확인으로 치지 않는다(검토 화면이 열 때 알린다) */
export function isConfirmedTranscript(text: string): boolean {
  try { return (JSON.parse(text) as { 확인완료?: unknown } | null)?.확인완료 === true; } catch { return false; }
}

/**
 * 세트 목록 한 칸의 진행 수. files는 transcripts 폴더의 파일 이름과 확인 여부(못 읽었으면 null).
 * 못 읽은 파일은 확인으로 세지 않고 넘어간다(파일 하나 때문에 시작 화면 목록이 비지 않게).
 * 미전사수는 전사 파일이 없는 장이다. 채점 실행의 '전사 시작'도 같은 이름의 파일이 있는지로 할 장을 고른다
 */
export function countProgress(pages: number[], files: { name: string; 확인: boolean | null }[]): Pick<SetInfo, '전사수' | '확인수' | '미전사수'> {
  const own = files.filter(f => isTranscriptName(f.name));
  const names = new Set(own.map(f => f.name.toLowerCase()));
  return { 전사수: own.length, 확인수: own.filter(f => f.확인 === true).length, 미전사수: pages.filter(p => !names.has(transcriptFileName(p))).length };
}

// 시작 화면이 보일 때마다 세트 목록을 다시 읽는다. 전사 파일을 여는 것이 stat보다 열 배 넘게 느려서(1,500장에 약 200ms)
// 수정 시각과 크기가 그대로인 파일은 지난번에 읽은 확인 여부를 쓴다. 확인을 켜고 끄면 글 길이(true·false)가 달라져 크기도 바뀐다
const confirmedCache = new Map<string, { mtimeMs: number; size: number; 확인: boolean }>();
async function readConfirmed(file: string): Promise<boolean | null> {
  try {
    const { mtimeMs, size } = await stat(file);
    const hit = confirmedCache.get(file);
    if (hit?.mtimeMs === mtimeMs && hit.size === size) return hit.확인;
    const 확인 = isConfirmedTranscript(await readFile(file, 'utf-8'));
    if (confirmedCache.size >= 20_000) confirmedCache.clear(); // 지운 세트의 항목이 끝없이 쌓이지 않게
    confirmedCache.set(file, { mtimeMs, size, 확인 });
    return 확인;
  } catch { return null; }
}

async function readTranscripts(dir: string): Promise<{ name: string; 확인: boolean | null }[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(isTranscriptName);
  return Promise.all(names.map(async name => ({ name, 확인: await readConfirmed(path.join(dir, name)) })));
}

async function readSetInfo(semesterDir: string, 폴더: string): Promise<SetInfo | null> {
  const dir = path.join(semesterDir, 폴더);
  let key;
  try { key = parseKey(await readFile(path.join(dir, '정답표.json'), 'utf-8')); } catch { return null; } // 정답표가 없거나 깨진 폴더는 세트가 아니다
  const [pages, files] = await Promise.all([listPages(dir), readTranscripts(path.join(dir, 'transcripts'))]);
  return { 폴더, key, 쪽수: pages.length, ...countProgress(pages, files) };
}

/** 학기 폴더의 세트(폴더 이름순). 검토 확인 수 때문에 전사 파일을 모두 보므로 세트들도 한꺼번에 읽는다 */
export async function listSets(semesterDir: string): Promise<SetInfo[]> {
  let names: string[] = [];
  try { names = (await readdir(semesterDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const sets = await Promise.all(names.sort((a, b) => a.localeCompare(b, 'ko')).map(폴더 => readSetInfo(semesterDir, 폴더)));
  return sets.filter((s): s is SetInfo => s !== null);
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
