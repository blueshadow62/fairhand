import path from 'node:path';
import type ExcelJS from 'exceljs';
import { loadExcel } from './excel.js';
import { fullScore } from './key.js';
import { DataError, type AnswerKey, type Row } from './types.js';

export interface ResultInfo { 채점일시: string; 프로그램버전: string; 전사정보: string }

const WHO = ['학년', '반', '번호', '이름'] as const;

function finish(ws: ExcelJS.Worksheet, widths: Record<number, number> = {}, wrapCol?: number): void {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const [i, w] of Object.entries(widths)) ws.getColumn(Number(i)).width = w;
  if (wrapCol) ws.getColumn(wrapCol).alignment = { wrapText: true, vertical: 'top' };
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

  ws = wb.addWorksheet('답안');
  ws.addRow([...WHO, ...qty, ...qual]);
  for (const r of all) ws.addRow([...WHO.map(k => r[k]), ...[...qty, ...qual].map(i => r.답[i] ?? null)]);
  finish(ws, { 4: 20 });

  ws = wb.addWorksheet('정답표');
  ws.addRow(['id', '문항', '설명', '정답', '허용', '핵심']);
  for (const u of key.정량) ws.addRow([u.id, u.문항, u.설명, u.정답, (u.허용 ?? []).join(', '), (u.핵심 ?? []).join(', ')]);
  for (const u of key.정성) ws.addRow([u.id, u.문항, u.설명]);
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
