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
// 한 시트에 열 수가 다른 표가 이어져 있어 줄마다 뒤쪽 빈 칸을 떼고 비교한다
const trim = (a: unknown[]) => { let n = a.length; while (n && a[n - 1] === null) n--; return a.slice(0, n); };
const sheetRows = (ws: ExcelJS.Worksheet) => Array.from({ length: ws.rowCount }, (_, i) => trim(cells(ws, i + 1)));
const frozen = (ws: ExcelJS.Worksheet) => {
  const v = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
  return v?.state === 'frozen' ? [v.xSplit ?? 0, v.ySplit ?? 0] : null;
};
const bg = (c: ExcelJS.Cell) => (c.fill?.type === 'pattern' ? c.fill.fgColor?.argb ?? null : null);
const fg = (c: ExcelJS.Cell) => c.font?.color?.argb ?? null;

async function written(k = key, roster = ROSTER): Promise<ExcelJS.Workbook> {
  const { rows, unmatched } = buildRows(k, roster, ts);
  const out = path.join(tmp(), '채점결과.xlsx');
  await writeResultXlsx(k, rows, unmatched, out, info);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  return wb;
}

test('write_xlsx: 시트와 머리글, 행 수', async () => {
  const { rows, unmatched } = buildRows(key, ROSTER, ts);
  const out = path.join(tmp(), '채점결과.xlsx');
  await writeResultXlsx(key, rows, unmatched, out, info);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['결과', '문항 분석', '답안', '정답표', '정보']);
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

test('시트 보기: 결과·답안은 학년~이름 열과 머리 줄 고정에 필터, 나머지는 머리 줄 고정', async () => {
  const wb = await written();
  const look = (name: string) => { const ws = wb.getWorksheet(name)!; return [frozen(ws), ws.autoFilter ?? null]; };
  // 필터는 머리 줄부터 마지막 행(명단 3명 + 미확인 1장)까지
  assert.deepEqual(look('결과'), [[4, 1], 'A1:K5']);
  assert.deepEqual(look('답안'), [[4, 1], 'A1:G5']);
  assert.deepEqual(look('문항 분석'), [[0, 1], null]);
  assert.deepEqual(look('정답표'), [[0, 1], null]);
});

test('문항 분석: 단위별 O·X·빈칸과 비율, 응답형은 따로, 반별 점수', async () => {
  const ws = (await written()).getWorksheet('문항 분석')!;
  // 대상 3장 = 학생에 붙은 p01·p02 + 미확인 p03. 미제출(최가상)은 답안지가 없어 세지 않는다
  assert.deepEqual(sheetRows(ws), [
    ['단위 id', '문항', '유형', '설명', '배점', '대상 장 수', 'O', 'X', '빈칸', '정답률(%)', '빈칸 비율(%)'],
    ['1-1', 1, null, '샘플 빈칸', 1, 3, 2, 1, 0, 2 / 3, 0],
    ['3-1', 3, null, '샘플 문장', 1, 3, 0, 1, 2, 0, 2 / 3],
    [],
    ['단위 id', '문항', '유형', '설명', '배점', '대상 장 수', '응답 수', '미응답 수', '응답률(%)'],
    ['E1', 1, '응답형', '샘플 확장 질문', 1, 3, 1, 2, 1 / 3],
    [],
    ['반', '장 수', '평균 점수', '최고', '최저', '만점 대비 평균(%)'],
    [1, 2, 1.5, 2, 1, 0.5],
    ['미확인 답안지', 1, 0, 0, 0, 0],
  ]);
  for (const a of ['J2', 'K2', 'J3', 'K3', 'I6', 'F9', 'F10']) assert.equal(ws.getCell(a).numFmt, '0.0%', a);
  assert.equal(ws.getCell('C9').numFmt, '0.00');
});

test('문항 분석 반별: 반 번호 순, 낸 장이 없는 반은 장 수 0에 나머지 빈칸', async () => {
  const k = { ...key, 대상: { 학년: 3, 반: [2, 1] } };
  const t = sheetRows((await written(k, [...ROSTER, { 학년: 3, 반: 2, 번호: 1, 이름: '다른반' }])).getWorksheet('문항 분석')!);
  assert.deepEqual(t.slice(t.findIndex(r => r[0] === '반') + 1), [[1, 2, 1.5, 2, 1, 0.5], [2, 0], ['미확인 답안지', 1, 0, 0, 0, 0]]);
});

test('결과 시트 색: X는 옅은 빨강 바탕에 진한 빨강 글자, 빈칸은 옅은 노랑, O·정성·미제출은 그대로', async () => {
  const ws = (await written()).getWorksheet('결과')!;
  const at = ['1-1', '3-1', 'E1'].map(id => headers(ws).indexOf(id) + 1);
  const look = (n: number) => at.map(c => { const cell = ws.getRow(n).getCell(c); return [cell.value ?? null, bg(cell), fg(cell)]; });
  const X = ['X', 'FFFDEAE7', 'FFB42318'], BLANK = ['빈칸', 'FFFFF4CC', null], O = ['O', null, null], NONE = [null, null, null];
  assert.deepEqual(look(2), [O, X, O]); // 박가상
  assert.deepEqual(look(3), [O, BLANK, NONE]); // 이가상: 3-1·E1을 옮기지 않음
  assert.deepEqual(look(4), [NONE, NONE, NONE]); // 최가상: 미제출
  assert.deepEqual(look(5), [X, BLANK, NONE]); // 미확인 p03
});
