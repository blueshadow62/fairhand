import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { readRoster, parseRosterRows } from '../src/core/roster.js';
import { DataError } from '../src/core/types.js';

const CSV = fileURLToPath(new URL('../../tests/fixtures/세트샘플/명단.csv', import.meta.url));
const tmp = () => mkdtempSync(path.join(tmpdir(), 'geulnun-'));

test('readRoster_csv: utf-8 csv', async () => {
  const r = await readRoster(CSV);
  assert.equal(r.length, 4);
  assert.deepEqual(r[1], { 학년: 3, 반: 1, 번호: 2, 이름: '이가상' });
});

test('readRoster_csv_euckr: 한글 엑셀이 저장한 cp949 csv도 읽는다', async () => {
  const p = path.join(tmp(), '명단.csv');
  // "학년,반,번호,이름\r\n3,1,1,박가상\r\n" 의 cp949 바이트(Node에는 cp949 인코더가 없어 직접 적는다)
  const bytes = Buffer.from([
    0xc7, 0xd0, 0xb3, 0xe2, 0x2c, 0xb9, 0xdd, 0x2c, 0xb9, 0xf8, 0xc8, 0xa3, 0x2c, 0xc0, 0xcc, 0xb8, 0xa7, 0x0d, 0x0a,
    0x33, 0x2c, 0x31, 0x2c, 0x31, 0x2c, 0xb9, 0xda, 0xb0, 0xa1, 0xbb, 0xf3, 0x0d, 0x0a,
  ]);
  writeFileSync(p, bytes);
  const r = await readRoster(p);
  assert.deepEqual(r, [{ 학년: 3, 반: 1, 번호: 1, 이름: '박가상' }]);
});

test('readRoster_xlsx_coerces_numbers: 7.0이나 " 7 "도 정수로', async () => {
  const p = path.join(tmp(), '명단.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('명단');
  ws.addRow(['학년', '반', '번호', '이름']);
  ws.addRow([3, 1, 7.0, '한가상']);
  ws.addRow(['3', ' 1 ', ' 8 ', ' 공백 ']);
  ws.addRow([]);
  await wb.xlsx.writeFile(p);
  const r = await readRoster(p);
  assert.deepEqual(r, [{ 학년: 3, 반: 1, 번호: 7, 이름: '한가상' }, { 학년: 3, 반: 1, 번호: 8, 이름: '공백' }]);
});

test('parseRosterRows: 숫자가 아니면 어느 줄인지 적힌 DataError', () => {
  assert.throws(() => parseRosterRows([['학년', '반', '번호', '이름'], ['삼', 1, 1, 'a']], '명단.csv'),
    (e: unknown) => e instanceof DataError && /명단\.csv/.test(e.message) && /2줄/.test(e.message));
});

test('readRoster: 지원하지 않는 확장자', async () => {
  await assert.rejects(readRoster('명단.xls'), (e: unknown) => e instanceof DataError && /xlsx 또는 csv/.test(e.message));
});

test('parseRosterRows_duplicate_student_stops: 같은 학년·반·번호 두 줄이면 두 줄 번호와 함께 멈춘다', () => {
  assert.throws(() => parseRosterRows([['학년', '반', '번호', '이름'], [3, 1, 1, '가'], [3, 1, 2, '나'], [3, 1, 1, '다']], '명단.csv'),
    (e: unknown) => e instanceof DataError && /명단\.csv/.test(e.message) && /4줄/.test(e.message) && /2줄/.test(e.message));
});

test('parseRosterRows_reads_by_header: 열 순서가 달라도 머리글로 읽는다', () => {
  assert.deepEqual(parseRosterRows([['이름', '번호', '학년', '반'], ['가', 7, 3, 1]], '명단.csv'), [{ 학년: 3, 반: 1, 번호: 7, 이름: '가' }]);
});

test('parseRosterRows_header_required: 머리글이 없으면 멈춘다', () => {
  assert.throws(() => parseRosterRows([[3, 1, 1, '가'], [3, 1, 2, '나']], '명단.csv'),
    (e: unknown) => e instanceof DataError && /명단\.csv/.test(e.message) && /머리글/.test(e.message));
});
