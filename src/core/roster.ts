import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type ExcelJS from 'exceljs';
import { loadExcel } from './excel.js';
import { DataError, studentKey, type AnswerKey, type Student, type Transcript } from './types.js';

function toInt(v: unknown, where: string, line: number, col: string): number {
  const s = String(v ?? '').trim();
  const n = Number(s);
  if (s === '' || !Number.isFinite(n) || !Number.isInteger(n)) throw new DataError(`${where} ${line}줄: ${col}이(가) 숫자가 아님 (${s})`);
  return n;
}

/** rows[0]은 머리글. 열은 순서가 아니라 머리글(학년, 반, 번호, 이름)로 찾는다. 빈 줄은 건너뛴다. */
export function parseRosterRows(rows: unknown[][], where: string): Student[] {
  const head = (rows[0] ?? []).map(c => String(c ?? '').trim());
  const cols = ['학년', '반', '번호', '이름'].map(h => head.indexOf(h)) as [number, number, number, number];
  const [학년열, 반열, 번호열, 이름열] = cols;
  if (cols.includes(-1)) throw new DataError(`${where}: 첫 줄에 학년·반·번호·이름 머리글이 있어야 합니다`);
  const out: Student[] = [];
  const firstLine = new Map<string, number>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (!r || r.every(c => String(c ?? '').trim() === '')) return;
    const s: Student = { 학년: toInt(r[학년열] ?? '', where, line, '학년'), 반: toInt(r[반열] ?? '', where, line, '반'), 번호: toInt(r[번호열] ?? '', where, line, '번호'),
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
    const wb = new (await loadExcel()).Workbook();
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

const MATCH_TAG = '명단 대조:';
const MATCH_FAIL = '명단 대조 실패:';
const squeeze = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');

/** 글자 단위 편집 거리 */
function editDistance(a: string, b: string): number {
  const x = [...a], y = [...b];
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...y.map((_, j) => (i ? 0 : j + 1))]);
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length]![y.length]!;
}
const sharesChar = (a: string, b: string) => [...a].some(c => b.includes(c));

/**
 * 전사 한 장을 명단과 맞춘다(이 PC 안에서만, 모델 호출 없음).
 * 맞으면 그대로, 고치면 식별을 '추정'으로 내리고 근거를 비고에, 못 맞추면 고치지 않고 비고에 적는다.
 * 같은 장에 다시 돌려도 결과가 같다.
 */
export function matchRoster(t: Transcript, key: AnswerKey, roster: Student[]): { transcript: Transcript; 변경: string | null } {
  const inGrade = roster.filter(s => s.학년 === key.대상.학년 && s.이름);
  const target = inGrade.filter(s => key.대상.반.includes(s.반));
  const at = target.find(s => s.반 === t.반 && s.번호 === t.번호);
  const name = squeeze(t.이름);
  const kept = t.비고.filter(b => !b.startsWith(MATCH_FAIL));
  const finish = (next: Transcript): { transcript: Transcript; 변경: string | null } => {
    if (JSON.stringify(next) === JSON.stringify(t)) return { transcript: t, 변경: null };
    return { transcript: next, 변경: next.비고.find(b => !t.비고.includes(b)) ?? `${t.이름 ?? ''} → ${next.이름 ?? ''}` };
  };
  const fail = (why: string) => finish({ ...t, 식별확신: t.식별확신 === '확실' ? '추정' : t.식별확신, 비고: [...kept, `${MATCH_FAIL} ${why}`] });
  const fix = (s: Student, why: string | null) => finish({ ...t, 학년: s.학년, 반: s.반, 번호: s.번호, 이름: s.이름,
    식별확신: why ? '추정' : t.식별확신, 비고: why ? [...kept, `${MATCH_TAG} ${why}`] : kept });
  const place = (s: Student) => `${s.반}반 ${s.번호}번 ${s.이름}`;

  if (!name) {
    if (t.번호 === null || t.반 === null) return finish({ ...t, 비고: kept }); // 식별이 안 된 장은 검토 화면에서 고른다
    if (!at) return fail(`${t.반}반 ${t.번호}번이 명단에 없음`);
    // 이름을 가려 보낸 세트는 모든 장이 이렇게 채워지므로 비고를 늘리지 않는다
    return fix(at, key.이름가림 ? null : `이름을 읽지 못해 번호로 ${at.이름}을(를) 채움`);
  }
  if (squeeze(at?.이름) === name) return finish({ ...t, 비고: kept });

  const same = target.filter(s => squeeze(s.이름) === name);
  if (same.length === 1) return fix(same[0]!, `번호 불일치(답안지 ${t.반 ?? '?'}반 ${t.번호 ?? '?'}번), 이름이 같은 ${place(same[0]!)}(으)로 맞춤`);
  if (same.length > 1) return fail(`같은 이름이 ${same.length}명 있어 고르지 못함 (${name})`);
  // 대상 반이 빠졌을 때 비슷한 2반 학생으로 잘못 고치지 않게, 다른 반의 정확한 이름을 먼저 본다
  const elsewhere = inGrade.find(s => squeeze(s.이름) === name);
  if (elsewhere) return fail(`'${name}'은(는) 명단에 ${place(elsewhere)}(으)로 있음, 정답표의 대상 반을 확인`);

  // 이름이 정확하지 않을 때는 읽은 번호를 근거로 삼는다. 번호와 이름이 함께 어긋나면 다른 학생 점수가 될 수 있어 옮기지 않는다(실제 답안지에서 다른 반의 글자 하나 다른 학생으로 옮겨진 일이 있었다)
  const distance = (s: Student) => editDistance(name, squeeze(s.이름));
  const pool = t.반 !== null && key.대상.반.includes(t.반) ? target.filter(s => s.반 === t.반) : target;
  if (at && sharesChar(name, squeeze(at.이름))) {
    const closer = pool.filter(s => distance(s) < distance(at));
    if (!closer.length) return fix(at, `이름을 '${name}'(으)로 읽음, 같은 번호의 ${at.이름}(으)로 맞춤`);
    return fail(`이름 '${name}'이(가) 같은 번호의 ${at.이름}보다 ${place(closer[0]!)}에 가까워 고르지 못함`);
  }
  if (t.번호 === null) {
    const near = pool.filter(s => distance(s) === 1);
    if (near.length === 1) return fix(near[0]!, `번호를 읽지 못함, 이름 '${name}'과(와) 가장 비슷한 ${place(near[0]!)}(으)로 맞춤`);
  }
  return fail(`'${name}'과(와) 맞는 학생을 찾지 못함 (읽은 번호 ${t.반 ?? '?'}반 ${t.번호 ?? '?'}번)`);
}
