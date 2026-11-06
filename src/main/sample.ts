import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { uniqueFolderName } from './paths.js';

export const SAMPLE_DIR = (root: string): string => path.join(root, 'resources', 'sample', '봄비');
const SAMPLE_NAME = '샘플_1학년_봄비오는날';

/** fs.cp 대신 readFile·writeFile로: 설치한 앱에서는 원본이 asar 안이라 Electron이 읽기만 대신해 준다 */
async function copyDir(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const d of await readdir(from, { withFileTypes: true })) {
    const a = path.join(from, d.name), b = path.join(to, d.name);
    if (d.isDirectory()) await copyDir(a, b); else await writeFile(b, await readFile(a));
  }
}

/** 학기 폴더에 샘플 세트를 넣는다. 이미 있으면 ' (2)'처럼 새 이름으로(덮어쓰지 않음) */
export async function copySampleSet(sampleDir: string, semesterDir: string): Promise<string> {
  const 폴더 = uniqueFolderName(semesterDir, SAMPLE_NAME, existsSync);
  await copyDir(sampleDir, path.join(semesterDir, 폴더));
  return 폴더;
}

/** 문서/글눈/YYYY-N학기. 3~8월 1학기, 9~12월 2학기, 1·2월은 앞 해의 2학기(학년도 기준) */
export function defaultSemesterDir(documentsDir: string, now: Date): string {
  const m = now.getMonth() + 1;
  const year = m <= 2 ? now.getFullYear() - 1 : now.getFullYear();
  return path.join(documentsDir, '글눈', `${year}-${m >= 3 && m <= 8 ? 1 : 2}학기`);
}

export async function makeDefaultSemester(documentsDir: string, now: Date = new Date()): Promise<string> {
  const dir = defaultSemesterDir(documentsDir, now);
  await mkdir(dir, { recursive: true });
  return dir;
}
