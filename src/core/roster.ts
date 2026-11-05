import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { DataError, studentKey, type Student } from './types.js';

function toInt(v: unknown, where: string, line: number, col: string): number {
  const s = String(v ?? '').trim();
  const n = Number(s);
  if (s === '' || !Number.isFinite(n) || !Number.isInteger(n)) throw new DataError(`${where} ${line}줄: ${col}이(가) 숫자가 아님 (${s})`);
  return n;
}

/** rows[0]은 머리글. 열은 순서가 아니라 머리글(학년, 반, 번호, 이름)로 찾는다. 빈 줄은 건너뛴다. */
export function parseRosterRows(rows: unknown[][], where: string): Student[] {
  const head = (rows[0] ?? []).map(c => String(c ?? '').trim());
  const [학년열, 반열, 번호열, 이름열] = ['학년', '반', '번호', '이름'].map(h => head.indexOf(h));
  if ([학년열, 반열, 번호열, 이름열].includes(-1)) throw new DataError(`${where}: 첫 줄에 학년·반·번호·이름 머리글이 있어야 합니다`);
  const out: Student[] = [];
  const firstLine = new Map<string, number>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (!r || r.every(c => String(c ?? '').trim() === '')) return;
    const s: Student = { 학년: toInt(r[학년열], where, line, '학년'), 반: toInt(r[반열], where, line, '반'), 번호: toInt(r[번호열], where, line, '번호'),
      이름: String(r[이름열] ?? '').trim() || null };
    // 그대로 두면 점수가 먼저 나온 줄의 이름에 조용히 붙는다
    const k = studentKey(s.학년, s.반, s.번호);
    if (firstLine.has(k)) throw new DataError(`${where} ${line}줄: 학년·반·번호가 ${firstLine.get(k)}줄과 같습니다`);
    firstLine.set(k, line);
    out.push(s);
  });
  return out;
}

function decodeText(buf: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buf); } // 한글 엑셀의 CSV 기본 인코딩
}

const splitCsvLine = (line: string): string[] =>
  line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'));

/** exceljs 칸 값: 서식 있는 글(richText)·수식(result)·하이퍼링크(text)는 보이는 값으로 */
function cellText(v: unknown): unknown {
  if (!v || typeof v !== 'object' || v instanceof Date) return v;
  const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
  if (o.richText) return o.richText.map(x => x.text).join('');
  if ('formula' in o || 'sharedFormula' in o) return cellText(o.result ?? '');
  return o.text ?? '';
}

export async function readRoster(p: string): Promise<Student[]> {
  const ext = path.extname(p).toLowerCase();
  const where = path.basename(p);
  if (ext === '.csv') {
    const text = decodeText(await readFile(p));
    const rows = text.split(/\r?\n/).filter(l => l.trim() !== '').map(splitCsvLine);
    return parseRosterRows(rows, where);
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(p);
    const ws = wb.worksheets[0];
    if (!ws) throw new DataError(`${where}: 시트가 없습니다`);
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = row.values as unknown[]; // exceljs는 1부터 시작하는 배열을 준다
      rows.push(vals.slice(1).map(cellText));
    });
    return parseRosterRows(rows, where);
  }
  throw new DataError(`${where}: 명단은 xlsx 또는 csv 파일이어야 합니다`);
}
