import path from 'node:path';
import type ExcelJS from 'exceljs';
import { loadExcel } from './excel.js';
import { fullScore, unitPoints } from './key.js';
import { DataError, type AnswerKey, type Panjeong, type Row } from './types.js';

export interface ResultInfo { 채점일시: string; 프로그램버전: string; 전사정보: string }

const WHO = ['학년', '반', '번호', '이름'] as const;
const PERCENT = '0.0%';

function finish(ws: ExcelJS.Worksheet, widths: Record<number, number> = {}, wrapCol?: number): void {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const [i, w] of Object.entries(widths)) ws.getColumn(Number(i)).width = w;
  if (wrapCol) ws.getColumn(wrapCol).alignment = { wrapText: true, vertical: 'top' };
}

/**
 * 전사된 장(미확인 답안지 포함)을 센다. 미제출은 답안지가 없어 뺀다.
 * 응답형(정성)은 맞고 틀림이 없어 O·X 열에 넣는 대신 열 이름이 다른 표로 따로 둔다
 */
function addAnalysis(wb: ExcelJS.Workbook, key: AnswerKey, rows: Row[], unmatched: Row[]): void {
  const ws = wb.addWorksheet('문항 분석');
  const scored = [...rows, ...unmatched].filter(r => r.합계 !== null);
  const n = scored.length;
  const count = (f: (r: Row) => boolean) => scored.filter(f).length;
  const rate = (k: number) => (n ? k / n : null);
  const add = (values: (string | number | null)[], percentCols: number[] = []) => {
    const row = ws.addRow(values);
    for (const c of percentCols) row.getCell(c).numFmt = PERCENT;
    return row;
  };
  const table = (head: string[]) => { ws.addRow([]); add(head).font = { bold: true }; };

  add(['단위 id', '문항', '유형', '설명', '배점', '대상 장 수', 'O', 'X', '빈칸', '정답률(%)', '빈칸 비율(%)']);
  for (const u of key.정량) {
    const by = (v: Panjeong) => count(r => (r.판정[u.id] ?? '빈칸') === v);
    const o = by('O'), b = by('빈칸');
    add([u.id, u.문항, u.유형 ?? null, u.설명, unitPoints(u), n, o, by('X'), b, rate(o), rate(b)], [10, 11]);
  }
  if (key.정성.length) {
    table(['단위 id', '문항', '유형', '설명', '배점', '대상 장 수', '응답 수', '미응답 수', '응답률(%)']);
    for (const u of key.정성) {
      const yes = count(r => r.응답[u.id] === true);
      add([u.id, u.문항, '응답형', u.설명, unitPoints(u), n, yes, n - yes, rate(yes)], [9]);
    }
  }

  table(['반', '장 수', '평균 점수', '최고', '최저', '만점 대비 평균(%)']);
  const full = fullScore(key);
  const groups: [number | string, Row[]][] = [...new Set(key.대상.반)].sort((a, b) => a - b).map(반 => [반, rows.filter(r => r.반 === 반)]);
  // 학생에 붙지 않은 장은 어느 반인지 아직 정해지지 않았다
  if (unmatched.length) groups.push(['미확인 답안지', unmatched]);
  for (const [반, list] of groups) {
    const s = list.flatMap(r => (r.합계 === null ? [] : [r.합계]));
    const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
    const row = add([반, s.length, avg, s.length ? Math.max(...s) : null, s.length ? Math.min(...s) : null, avg !== null && full ? avg / full : null], [6]);
    row.getCell(3).numFmt = '0.00';
  }
  finish(ws, { 1: 14, 2: 7, 3: 10, 4: 30, 5: 7, 6: 18, 7: 8, 8: 10, 9: 10, 10: 10, 11: 13 }, 4);
}

export async function writeResultXlsx(key: AnswerKey, rows: Row[], unmatched: Row[], out: string, info: ResultInfo): Promise<void> {
  const qty = key.정량.map(u => u.id);
  const qual = key.정성.map(u => u.id);
  const all = [...rows, ...unmatched];
  const wb = new (await loadExcel()).Workbook();

  let ws = wb.addWorksheet('결과');
  ws.addRow([...WHO, '합계', '정량', '정성', '비고', ...qty, ...qual]);
  for (const r of all) ws.addRow([...WHO.map(k => r[k]), r.합계, r.정량, r.정성, r.비고 || null,
    ...qty.map(i => r.판정[i] ?? null), ...qual.map(i => (r.응답[i] ? 'O' : null))]);
  finish(ws, { 4: 20, 8: 50 }, 8);
  addAnalysis(wb, key, rows, unmatched);

  ws = wb.addWorksheet('답안');
  ws.addRow([...WHO, ...qty, ...qual]);
  for (const r of all) ws.addRow([...WHO.map(k => r[k]), ...[...qty, ...qual].map(i => r.답[i] ?? null)]);
  finish(ws, { 4: 20 });

  ws = wb.addWorksheet('정답표');
  ws.addRow(['id', '문항', '설명', '정답', '허용', '핵심', '배점']);
  for (const u of key.정량) ws.addRow([u.id, u.문항, u.설명, u.정답, (u.허용 ?? []).join(', '), (u.핵심 ?? []).join(', '), unitPoints(u)]);
  for (const u of key.정성) ws.addRow([u.id, u.문항, u.설명, null, null, null, unitPoints(u)]);
  finish(ws, { 3: 30, 4: 34, 5: 20 });

  ws = wb.addWorksheet('정보');
  for (const [k, v] of [
    ['세트', key.세트], ['글', key.글], ['학기', key.학기], ['학년', key.대상.학년], ['반', key.대상.반.join(', ')],
    ['만점', fullScore(key)], ['채점 일시', info.채점일시], ['전사', info.전사정보], ['프로그램 버전', info.프로그램버전],
    ['정답표 확인', key.확인?.완료 ? `완료 ${key.확인.일시 ?? ''}`.trim() : '미확인'],
  ]) ws.addRow([k, v]);
  ws.getColumn(1).width = 16; ws.getColumn(2).width = 60;

  try { await wb.xlsx.writeFile(out); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EISDIR')
      throw new DataError(`${path.basename(out)}을(를) 닫고 다시 저장해 주세요`);
    throw e;
  }
}
