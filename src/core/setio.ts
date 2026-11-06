import { readdir, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseKey } from './key.js';
import { parseTranscript } from './transcript.js';
import { DataError, type AnswerKey, type Transcript, type UploadRecord } from './types.js';

export const transcriptFileName = (page: number): string => `p${String(page).padStart(2, '0')}.json`;

const pageNo = (name: string): number | null => {
  const m = /^p(\d+)\.(json|jpg)$/i.exec(name);
  return m ? Number(m[1]) : null;
};

async function numbered(dir: string, ext: 'json' | 'jpg'): Promise<{ page: number; name: string }[]> {
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return []; }
  return names.filter(n => n.toLowerCase().endsWith(`.${ext}`))
    .map(name => ({ page: pageNo(name), name })).filter((x): x is { page: number; name: string } => x.page !== null)
    .sort((a, b) => a.page - b.page); // 문자열 정렬이면 p100이 p99보다 앞에 온다
}

export const listPages = async (dir: string): Promise<number[]> => (await numbered(path.join(dir, 'pages'), 'jpg')).map(x => x.page);

export async function loadSet(dir: string): Promise<{ key: AnswerKey; transcripts: Transcript[] }> {
  const keyPath = path.join(dir, '정답표.json');
  let text: string;
  try { text = await readFile(keyPath, 'utf-8'); } catch { throw new DataError(`${dir}: 정답표.json이 없습니다`); }
  const key = parseKey(text, '정답표.json');
  const tdir = path.join(dir, 'transcripts');
  const transcripts: Transcript[] = [];
  for (const { page, name } of await numbered(tdir, 'json')) {
    const t = parseTranscript(await readFile(path.join(tdir, name), 'utf-8'), name);
    // 그대로 두면 저장할 때 다른 번호의 파일이 생겨 같은 학생이 두 장이 된다
    if (t.page !== page) throw new DataError(`${name}: 안의 page(${t.page})가 파일 이름과 다릅니다`);
    transcripts.push(t);
  }
  return { key, transcripts };
}

/** 전사를 빠뜨린 장의 학생이 '미제출'로 기록되지 않게 먼저 멈춘다 */
export async function checkAllTranscribed(dir: string): Promise<void> {
  const done = new Set((await numbered(path.join(dir, 'transcripts'), 'json')).map(x => x.page));
  if (done.size === 0) throw new DataError('전사 파일이 하나도 없음');
  const missing = (await listPages(dir)).filter(p => !done.has(p));
  if (missing.length) throw new DataError(`전사 없는 장: ${missing.map(p => `p${String(p).padStart(2, '0')}`).join(', ')}`);
}

/** 쓰다가 끊겨도 전사가 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기한다 */
export async function saveTranscript(dir: string, t: Transcript): Promise<void> {
  const tdir = path.join(dir, 'transcripts');
  await mkdir(tdir, { recursive: true });
  const { 이름확신: _legacy, ...clean } = t as Transcript & { 이름확신?: unknown };
  const target = path.join(tdir, transcriptFileName(t.page));
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 1), 'utf-8');
  try { await rename(tmp, target); }
  catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EBUSY') throw new DataError(`${transcriptFileName(t.page)}이 다른 프로그램에서 열려 있어 저장할 수 없습니다`);
    throw e;
  }
}

const uploadsFile = (dir: string): string => path.join(dir, '올린파일.json');
export async function loadUploads(dir: string): Promise<UploadRecord[]> {
  try { const v: unknown = JSON.parse(await readFile(uploadsFile(dir), 'utf-8')); return Array.isArray(v) ? (v as UploadRecord[]) : []; } catch { return []; }
}
export async function appendUpload(dir: string, r: UploadRecord): Promise<void> {
  const all = await loadUploads(dir); all.push(r);
  await writeFile(uploadsFile(dir), JSON.stringify(all, null, 1), 'utf-8');
}

/** 장 그림과 그 장의 전사를 지운다. 번호는 다시 매기지 않는다(뒤 장을 당기면 다른 장의 전사가 어긋난다) */
export async function removePage(dir: string, page: number): Promise<{ 전사있었음: boolean }> {
  if (!Number.isInteger(page) || page < 1) throw new DataError(`잘못된 장 번호: ${page}`);
  const tag = `p${String(page).padStart(2, '0')}`;
  try { await rm(path.join(dir, 'pages', `${tag}.jpg`)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new DataError(`${tag} 그림이 없습니다`); throw e; }
  try { await rm(path.join(dir, 'transcripts', transcriptFileName(page))); return { 전사있었음: true }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { 전사있었음: false }; throw e; }
}
