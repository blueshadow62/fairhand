import path from 'node:path';
import type ExcelJS from 'exceljs';
import { loadExcel } from './excel.js';
import { fullScore, headcount, unitPoints } from './key.js';
import { DataError, type AnswerKey, type Panjeong, type Row } from './types.js';

/** 명단있음: 명단으로 행을 만들었는지. 없으면 반별 인원이 있는 반만 미제출을 알 수 있다 */
export interface ResultInfo { 채점일시: string; 프로그램버전: string; 전사정보: string; 명단있음?: boolean }

const WHO = ['학년', '반', '번호', '이름'] as const;
const PERCENT = '0.0%';

interface Look { widths?: Record<number, number>; wrapCol?: number; students?: boolean }

function finish(ws: ExcelJS.Worksheet, { widths = {}, wrapCol, students = false }: Look = {}): void {
  ws.getRow(1).font = { bold: true };
  // 학생 행 시트는 오른쪽 단위 열로 넘겨도 누구의 행인지 보이게 이름 열까지 고정한다.
  // 필터 범위는 엑셀이 직접 저장할 때처럼 마지막 행까지 잡는다
  ws.views = [{ state: 'frozen', ySplit: 1, ...(students ? { xSplit: WHO.length } : {}) }];
  if (students) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ws.columnCount } };
  for (const [i, w] of Object.entries(widths)) ws.getColumn(Number(i)).width = w;
  if (wrapCol) ws.getColumn(wrapCol).alignment = { wrapText: true, vertical: 'top' };
}

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** 결과를 훑을 때 틀린 칸과 빈칸이 눈에 띄게 */
function mark(cell: ExcelJS.Cell, v: Panjeong | undefined): void {
  if (v === 'X') { cell.fill = solid('FFFDEAE7'); cell.font = { color: { argb: 'FFB42318' } }; }
  else if (v === '빈칸') cell.fill = solid('FFFFF4CC');
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
    // 순서 무관 단위의 정답률은 '그 칸에 묶음의 정답 하나를 맞게 쓴 비율'이다(칸마다 판정). 계산은 같고 유형 칸에 표시만 한다
    add([u.id, u.문항, u.순서무관 === true ? `${u.유형 ?? '빈칸형'}(순서 무관)` : u.유형 ?? null, u.설명, unitPoints(u), n, o, by('X'), b, rate(o), rate(b)], [10, 11]);
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
  finish(ws, { widths: { 1: 14, 2: 7, 3: 10, 4: 30, 5: 7, 6: 18, 7: 8, 8: 10, 9: 10, 10: 10, 11: 13 }, wrapCol: 4 });
}

export async function writeResultXlsx(key: AnswerKey, rows: Row[], unmatched: Row[], out: string, info: ResultInfo): Promise<void> {
  const qty = key.정량.map(u => u.id);
  const qual = key.정성.map(u => u.id);
  const all = [...rows, ...unmatched];
  const wb = new (await loadExcel()).Workbook();

  let ws = wb.addWorksheet('결과');
  const lead = [...WHO, '합계', '정량', '정성', '비고'];
  ws.addRow([...lead, ...qty, ...qual]);
  for (const r of all) {
    const row = ws.addRow([...WHO.map(k => r[k]), r.합계, r.정량, r.정성, r.비고 || null,
      ...qty.map(i => r.판정[i] ?? null), ...qual.map(i => (r.응답[i] ? 'O' : null))]);
    qty.forEach((id, i) => mark(row.getCell(lead.length + 1 + i), r.판정[id]));
  }
  finish(ws, { widths: { 4: 20, 8: 50 }, wrapCol: 8, students: true });

  // 미제출자를 따로 출력·전달하려면 '결과'를 필터해야 했다. 붙은 장이 없는 대상 학생(미제출·번호 중복으로 미확정)을 반·번호 순으로 모은다
  ws = wb.addWorksheet('미제출');
  ws.addRow([...WHO, '사유']);
  const absent = rows.filter(r => r.page === null);
  for (const r of absent) ws.addRow([...WHO.map(k => r[k]), r.비고]);
  // 명단도 반별 인원도 없는 반은 낸 학생으로만 행을 만들어 미제출이 늘 0이다. '없습니다'로 오해하지 않게 따로 적는다
  const unknown = info.명단있음 ? [] : [...new Set(key.대상.반)].sort((a, b) => a - b).filter(반 => headcount(key, 반) === undefined);
  if (unknown.length) ws.addRow([`${unknown.join('·')}반은 명단이나 반별 인원이 없어 미제출 학생을 알 수 없습니다(설정 > 기본의 학생 명단, 또는 문항 설정의 반별 인원)`]);
  else if (!absent.length) ws.addRow(['미제출 학생이 없습니다']);
  finish(ws, { widths: { 4: 20, 5: 40 }, wrapCol: 5, students: absent.length > 0 });

  addAnalysis(wb, key, rows, unmatched);

  ws = wb.addWorksheet('답안');
  ws.addRow([...WHO, ...qty, ...qual]);
  for (const r of all) ws.addRow([...WHO.map(k => r[k]), ...[...qty, ...qual].map(i => r.답[i] ?? null)]);
  finish(ws, { widths: { 4: 20 }, students: true });

  ws = wb.addWorksheet('정답표');
  ws.addRow(['id', '문항', '설명', '정답', '허용', '핵심', '배점']);
  for (const u of key.정량) ws.addRow([u.id, u.문항, u.설명, u.정답, (u.허용 ?? []).join(', '), (u.핵심 ?? []).join(', '), unitPoints(u)]);
  for (const u of key.정성) ws.addRow([u.id, u.문항, u.설명, null, null, null, unitPoints(u)]);
  finish(ws, { widths: { 3: 30, 4: 34, 5: 20 } });

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
