import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildCumulative, writeCumulativeXlsx, type SetSummary } from '../src/core/cumulative.js';
import type { AnswerKey, Row, Student } from '../src/core/types.js';

const row = (반: number, 번호: number, 이름: string | null, 합계: number | null): Row =>
  ({ 학년: 3, 반, 번호, 이름, 합계, 정량: 합계, 정성: 0, 비고: 합계 === null ? '미제출' : '', page: null, 판정: {}, 답: {}, 응답: {} });
const key = (글: string, 완료: boolean): AnswerKey =>
  ({ 세트: 글, 글, 학기: '2026 2학기', 대상: { 학년: 3, 반: [1] }, 확인: { 완료 }, 정량: [{ id: '1-1', 문항: 1, 설명: '', 정답: 'a' }], 정성: [{ id: 'E1', 문항: 1, 설명: '' }] });
const sets: SetSummary[] = [
  { 폴더: '2026-2학기_3학년_첫글', key: key('첫글', true), rows: [row(1, 1, '박가상', 2), row(1, 2, null, null)], 채점일시: '2026-10-01', 규칙: 'transcribe-v1' },
  { 폴더: '2026-2학기_3학년_둘째글', key: key('둘째글', true), rows: [row(1, 1, null, 1), row(1, 3, '전학생', 2)], 채점일시: '2026-11-01', 규칙: 'transcribe-v1' },
  { 폴더: '2026-2학기_3학년_미확인글', key: key('미확인글', false), rows: [row(1, 1, null, 9)], 채점일시: '2026-11-05', 규칙: 'transcribe-v1' },
];
const roster: Student[] = [{ 학년: 3, 반: 1, 번호: 1, 이름: '박가상' }, { 학년: 3, 반: 1, 번호: 2, 이름: '이가상' }];

test('buildCumulative: 학생 합집합, 세트별 합계, 총점, 미확인 세트 제외', () => {
  const c = buildCumulative(sets, roster, 3);
  assert.equal(c.반별.length, 1);
  const s = c.반별[0];
  assert.deepEqual(s.header, ['학년', '반', '번호', '이름', '첫글', '둘째글', '총점']);
  assert.deepEqual(s.rows, [
    [3, 1, 1, '박가상', 2, 1, 3],
    [3, 1, 2, '이가상', null, null, 0],
    [3, 1, 3, '전학생', null, 2, 2],
  ]);
  assert.deepEqual(c.세트.map(x => [x.글, x.상태, x.만점]), [['첫글', '포함', 2], ['둘째글', '포함', 2], ['미확인글', '미확인', 2]]);
});

test('writeCumulativeXlsx: 반 시트와 세트 시트', async () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'geulnun-')), '누가.xlsx');
  await writeCumulativeXlsx(buildCumulative(sets, roster, 3), out);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['3-1', '세트']);
  assert.deepEqual((wb.getWorksheet('3-1')!.getRow(2).values as unknown[]).slice(1), [3, 1, 1, '박가상', 2, 1, 3]);
});

test('buildCumulative: 두 세트의 글이 같으면 머리글에 폴더 이름을 덧붙여 구분한다', () => {
  const same: SetSummary[] = [
    { 폴더: '세트갑', key: key('같은글', true), rows: [row(1, 1, null, 1)], 채점일시: '', 규칙: '' },
    { 폴더: '세트을', key: key('같은글', true), rows: [row(1, 1, null, 2)], 채점일시: '', 규칙: '' },
  ];
  assert.deepEqual(buildCumulative(same, null, 3).반별[0]!.header, ['학년', '반', '번호', '이름', '같은글(세트갑)', '같은글(세트을)', '총점']);
});
