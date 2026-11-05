import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseKey } from '../src/core/key.js';
import { parseTranscript } from '../src/core/transcript.js';
import { buildRows } from '../src/core/score.js';
import { writeResultXlsx } from '../src/core/xlsx.js';
import { DataError, type Student } from '../src/core/types.js';

const FX = new URL('../../tests/fixtures/세트샘플/', import.meta.url);
const key = parseKey(readFileSync(new URL('정답표.json', FX), 'utf-8'));
const ts = ['p01.json', 'p02.json', 'p03.json'].map(n => parseTranscript(readFileSync(new URL(`transcripts/${n}`, FX), 'utf-8'), n));
const ROSTER: Student[] = [
  { 학년: 3, 반: 1, 번호: 1, 이름: '박가상' }, { 학년: 3, 반: 1, 번호: 2, 이름: '이가상' }, { 학년: 3, 반: 1, 번호: 3, 이름: '최가상' },
];
const info = { 채점일시: '2026-11-05 15:00', 프로그램버전: '0.1.0', 전사정보: '사람' };
const tmp = () => mkdtempSync(path.join(tmpdir(), 'geulnun-'));
// exceljs의 row.values는 1부터 시작하고 빈 칸은 구멍이라, 칸마다 읽어 null로 맞춘다
const cells = (ws: ExcelJS.Worksheet, n: number) =>
  Array.from({ length: ws.columnCount }, (_, i) => ws.getRow(n).getCell(i + 1).value ?? null);
const headers = (ws: ExcelJS.Worksheet) => cells(ws, 1);

test('write_xlsx: 시트와 머리글, 행 수', async () => {
  const { rows, unmatched } = buildRows(key, ROSTER, ts);
  const out = path.join(tmp(), '채점결과.xlsx');
  await writeResultXlsx(key, rows, unmatched, out, info);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['결과', '답안', '정답표', '정보']);
  const ws = wb.getWorksheet('결과')!;
  assert.deepEqual(headers(ws), ['학년', '반', '번호', '이름', '합계', '정량', '정성', '비고', '1-1', '3-1', 'E1']);
  assert.equal(ws.rowCount, 1 + 3 + 1); // 명단 3명 + 미확인 1장
  assert.deepEqual(cells(ws, 2), [3, 1, 1, '박가상', 2, 1, 1, null, 'O', 'X', 'O']);
  assert.deepEqual(cells(ws, 4).slice(0, 8), [3, 1, 3, '최가상', null, null, null, '미제출']);
});

test('essay_answer_verbatim: 답안 시트에 정성 답 원문', async () => {
  const { rows, unmatched } = buildRows(key, ROSTER, ts);
  const out = path.join(tmp(), 'x.xlsx');
  await writeResultXlsx(key, rows, unmatched, out, info);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet('답안')!;
  const row = Object.fromEntries(headers(ws).map((h, i) => [String(h), cells(ws, 2)[i]]));
  assert.equal(row['E1'], '샘플 답 원문');
});

test('정보 시트: 만점·엔진·버전', async () => {
  const { rows, unmatched } = buildRows(key, ROSTER, ts);
  const out = path.join(tmp(), 'i.xlsx');
  await writeResultXlsx(key, rows, unmatched, out, info);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet('정보')!;
  const map = new Map<string, unknown>();
  ws.eachRow(r => { const v = r.values as unknown[]; map.set(String(v[1]), v[2]); });
  assert.equal(map.get('만점'), 3);
  assert.equal(map.get('프로그램 버전'), '0.1.0');
  assert.equal(map.get('전사'), '사람');
});

test('writeResultXlsx_locked_file_message: 못 쓰면 닫으라는 안내', async () => {
  const { rows, unmatched } = buildRows(key, ROSTER, ts);
  const dir = tmp(); // 디렉터리를 파일 경로로 주면 쓰기가 실패한다
  await assert.rejects(writeResultXlsx(key, rows, unmatched, dir, info),
    (e: unknown) => e instanceof DataError && /닫고 다시/.test(e.message));
});
