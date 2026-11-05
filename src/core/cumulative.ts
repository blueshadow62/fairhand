import path from 'node:path';
import ExcelJS from 'exceljs';
import { fullScore, isConfirmed } from './key.js';
import { DataError, studentKey, type AnswerKey, type Row, type Student } from './types.js';

export interface SetSummary { 폴더: string; key: AnswerKey; rows: Row[]; 채점일시: string; 규칙: string }
export interface CumulativeSheets {
  학년: number;
  반별: { 반: number; header: string[]; rows: (string | number | null)[][] }[];
  세트: { 폴더: string; 글: string; 채점일시: string; 규칙: string; 만점: number; 상태: '포함' | '미확인' }[];
}

/** 학기 폴더의 세트들을 처음부터 다시 모은다. 덧붙이지 않는다. */
export function buildCumulative(sets: SetSummary[], roster: Student[] | null, 학년: number): CumulativeSheets {
  const included = sets.filter(s => isConfirmed(s.key) && s.key.대상.학년 === 학년);
  const students = new Map<string, Student>();
  const add = (s: Student) => { const k = studentKey(s.학년, s.반, s.번호); if (!students.has(k)) students.set(k, s); else if (!students.get(k)!.이름 && s.이름) students.get(k)!.이름 = s.이름; };
  for (const s of roster ?? []) if (s.학년 === 학년) add({ ...s });
  for (const set of included) for (const r of set.rows) if (r.학년 === 학년 && r.반 !== null && r.번호 !== null) add({ 학년, 반: r.반, 번호: r.번호, 이름: r.이름 });

  const score = (set: SetSummary, k: string): number | null => {
    const r = set.rows.find(r => r.반 !== null && r.번호 !== null && studentKey(학년, r.반, r.번호) === k);
    return r?.합계 ?? null;
  };
  const 반별 = [...new Set([...students.values()].map(s => s.반))].sort((a, b) => a - b).map(반 => ({
    반,
    header: ['학년', '반', '번호', '이름', ...included.map(s => s.key.글), '총점'],
    rows: [...students.values()].filter(s => s.반 === 반).sort((a, b) => a.번호 - b.번호).map(s => {
      const k = studentKey(학년, 반, s.번호);
      const scores = included.map(set => score(set, k));
      return [학년, 반, s.번호, s.이름, ...scores, scores.reduce<number>((a, b) => a + (b ?? 0), 0)];
    }),
  }));
  const 세트 = sets.filter(s => s.key.대상.학년 === 학년).map(s => ({
    폴더: s.폴더, 글: s.key.글, 채점일시: s.채점일시, 규칙: s.규칙, 만점: fullScore(s.key),
    상태: (isConfirmed(s.key) ? '포함' : '미확인') as '포함' | '미확인',
  }));
  return { 학년, 반별, 세트 };
}

export async function writeCumulativeXlsx(c: CumulativeSheets, out: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  for (const s of c.반별) {
    const ws = wb.addWorksheet(`${c.학년}-${s.반}`); // 시트 이름은 학년-반, 예: 3-1
    ws.addRow(s.header);
    for (const r of s.rows) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getColumn(4).width = 16;
  }
  const ws = wb.addWorksheet('세트');
  ws.addRow(['폴더', '글', '채점 일시', '규칙', '만점', '상태']);
  for (const s of c.세트) ws.addRow([s.폴더, s.글, s.채점일시, s.규칙, s.만점, s.상태]);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).width = 40; ws.getColumn(2).width = 24;
  try { await wb.xlsx.writeFile(out); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EISDIR') throw new DataError(`${path.basename(out)}을(를) 닫고 다시 저장해 주세요`);
    throw e;
  }
}
