import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildCumulative, writeCumulativeXlsx, type SetSummary } from '../core/cumulative.js';
import { cumulativeFileName, resultFileName } from '../core/names.js';
import { buildRows } from '../core/score.js';
import { loadSet, saveTranscript } from '../core/setio.js';
import { DataError, type Student, type Transcript } from '../core/types.js';
import { writeResultXlsx } from '../core/xlsx.js';
import { listSets } from './paths.js';

export interface ResultDeps { version: string; now?: () => Date }

export function friendlyFsError(e: unknown, what: string): DataError {
  if (e instanceof DataError) return e;
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EISDIR') return new DataError(`${what}이 다른 프로그램에서 열려 있어 쓸 수 없습니다. 닫은 뒤 다시 해 주세요`);
  return new DataError(`${what}을 쓰지 못했습니다: ${(e as Error)?.message ?? String(e)}`);
}

const stamp = (d: Date) => d.toLocaleString('ko-KR');

export async function rebuildResult(setDir: string, roster: Student[] | null, deps: ResultDeps): Promise<{ 엑셀: string }> {
  const now = deps.now ?? (() => new Date());
  const { key, transcripts } = await loadSet(setDir);
  if (!transcripts.length) throw new DataError('전사 파일이 하나도 없어 엑셀을 만들 수 없습니다');
  const { rows, unmatched } = buildRows(key, roster, transcripts);
  const out = path.join(setDir, resultFileName(key, now()));
  const 전사정보 = [...new Set(transcripts.map(t => t.전사정보 ? `${t.전사정보.엔진}/${t.전사정보.모델}/${t.전사정보.규칙}` : '사람'))].join(', ');
  try { await writeResultXlsx(key, rows, unmatched, out, { 채점일시: stamp(now()), 프로그램버전: deps.version, 전사정보 }); }
  catch (e) { throw friendlyFsError(e, '엑셀 파일'); }
  return { 엑셀: out };
}

/** 전사는 반드시 저장한다. 엑셀이 열려 있어 못 쓰면 그 사실만 알린다(검토 화면의 저장). */
export async function saveAndRebuild(setDir: string, t: Transcript, roster: Student[] | null, deps: ResultDeps): Promise<{ 엑셀?: string; 엑셀오류?: string }> {
  try { await saveTranscript(setDir, t); } catch (e) { throw friendlyFsError(e, `전사 파일 p${String(t.page).padStart(2, '0')}.json`); }
  try { return await rebuildResult(setDir, roster, deps); }
  catch (e) { return { 엑셀오류: e instanceof Error ? e.message : String(e) }; }
}

export async function buildAllCumulative(semesterDir: string, roster: Student[] | null, deps: ResultDeps): Promise<{ 파일: string[] }> {
  const now = deps.now ?? (() => new Date());
  const sets = await listSets(semesterDir); // 폴더명순(누가기록 열 순서)
  const byGrade = new Map<number, SetSummary[]>();
  let 학기 = '';
  for (const s of sets) {
    const { key, transcripts } = await loadSet(path.join(semesterDir, s.폴더));
    if (!transcripts.length) continue;
    const { rows } = buildRows(key, roster, transcripts); // unmatched는 넣지 않는다: '미확인 답안지' 학생이 생긴다
    학기 = 학기 || key.학기;
    const list = byGrade.get(key.대상.학년) ?? [];
    list.push({ 폴더: s.폴더, key, rows, 채점일시: stamp(now()), 규칙: transcripts[0]!.전사정보?.규칙 ?? '사람' });
    byGrade.set(key.대상.학년, list);
  }
  if (!byGrade.size) throw new DataError('채점된 세트가 없어 누가기록을 만들 수 없습니다');
  const 파일: string[] = [];
  for (const [학년, list] of byGrade) {
    const out = path.join(semesterDir, cumulativeFileName(학기, 학년, now()));
    try { await writeCumulativeXlsx(buildCumulative(list, roster, 학년), out); } catch (e) { throw friendlyFsError(e, '누가기록 파일'); }
    파일.push(out);
  }
  return { 파일 };
}
