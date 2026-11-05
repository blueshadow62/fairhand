import { readdir, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseKey } from './key.js';
import { parseTranscript } from './transcript.js';
import { DataError, type AnswerKey, type Transcript } from './types.js';

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
  await rename(tmp, target);
}
