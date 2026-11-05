import { parseArgs } from 'node:util';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadSet, checkAllTranscribed } from '../src/core/setio.js';
import { validateTranscripts } from '../src/core/transcript.js';
import { buildRows } from '../src/core/score.js';
import { readRoster } from '../src/core/roster.js';
import { writeResultXlsx } from '../src/core/xlsx.js';
import { resultFileName } from '../src/core/names.js';
import { DataError } from '../src/core/types.js';

// 프로젝트 경로에 빈칸이 있으면 npm이 Windows에서 빈칸 있는 인수를 ^..\a^ b^처럼 ^를 남긴 채 넘긴다.
// ponytail: 앞뒤가 모두 ^인 인수만 벗긴다. 이름이 정말 그런 경로면 틀리지만 명령줄은 1단계 검증용이다.
const unNpm = (s: string): string => (s.length > 1 && s.startsWith('^') && s.endsWith('^') ? s.replaceAll('^', '') : s);
const { values, positionals } = parseArgs({ allowPositionals: true, args: process.argv.slice(2).map(unNpm),
  options: { roster: { type: 'string' }, out: { type: 'string' } } });
const setDir = positionals[0];
if (!setDir) { console.error('사용법: npm run score -- "<세트 폴더>" [--roster <xlsx|csv>] [--out <폴더>]'); process.exit(2); }

const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version as string;

try {
  await checkAllTranscribed(setDir);
  const { key, transcripts } = await loadSet(setDir);
  validateTranscripts(key, transcripts);
  const roster = values.roster ? await readRoster(values.roster) : null;
  const { rows, unmatched } = buildRows(key, roster, transcripts);
  const engines = new Set(transcripts.map(t => t.전사정보 ? `${t.전사정보.엔진}/${t.전사정보.모델}/${t.전사정보.effort}/${t.전사정보.규칙}` : '사람'));
  const out = path.join(values.out ?? setDir, resultFileName(key, new Date()));
  await writeResultXlsx(key, rows, unmatched, out, {
    채점일시: new Date().toLocaleString('ko-KR'), 프로그램버전: version, 전사정보: [...engines].join(', ') });
  const 비고 = [...rows, ...unmatched].filter(r => r.비고).length;
  console.log(`${out}: ${rows.length}행, 미제출 ${rows.filter(r => r.비고.startsWith('미제출')).length}, 미확인 ${unmatched.length}, 비고 있는 행 ${비고}`);
} catch (e) {
  if (e instanceof DataError) { console.error(`멈춤: ${e.message}`); process.exit(1); }
  throw e;
}
