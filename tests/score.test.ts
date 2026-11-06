import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { parseTranscript, validateTranscripts } from '../src/core/transcript.js';
import { scoreOne, buildRows } from '../src/core/score.js';
import type { Student, Transcript } from '../src/core/types.js';

const FX = new URL('../../tests/fixtures/세트샘플/', import.meta.url);
const key = parseKey(readFileSync(new URL('정답표.json', FX), 'utf-8'));
const ts = ['p01.json', 'p02.json', 'p03.json'].map(n => parseTranscript(readFileSync(new URL(`transcripts/${n}`, FX), 'utf-8'), n));
validateTranscripts(key, ts);
const ROSTER: Student[] = [
  { 학년: 3, 반: 1, 번호: 1, 이름: '박가상' },
  { 학년: 3, 반: 1, 번호: 2, 이름: '이가상' },
  { 학년: 3, 반: 1, 번호: 3, 이름: '최가상' },
  { 학년: 3, 반: 2, 번호: 1, 이름: '다른반' },
];

test('scores_and_order: 대상 반만, 번호순, 점수', () => {
  const { rows } = buildRows(key, ROSTER, ts);
  assert.deepEqual(rows.map(r => r.번호), [1, 2, 3]);
  assert.deepEqual([rows[0]!.합계, rows[0]!.정량, rows[0]!.정성], [2, 1, 1]);
  assert.equal(rows[0]!.비고, '');
});

test('missing_unit: 빠진 단위는 빈칸·false로 세고 비고에 남긴다', () => {
  const { rows } = buildRows(key, ROSTER, ts);
  assert.deepEqual([rows[1]!.합계, rows[1]!.판정['3-1'], rows[1]!.응답['E1']], [1, '빈칸', false]);
});

test('name_mismatch: 비고 조립 순서', () => {
  const { rows } = buildRows(key, ROSTER, ts);
  assert.equal(rows[1]!.비고, '식별 추정; 이름 불일치(답안지: 이가샹); 이름 흐림; 단위 누락: 3-1; 단위 누락: E1');
  assert.equal(rows[1]!.이름, '이가상');
});

test('absent_and_unmatched: 미제출과 미확인 답안지', () => {
  const { rows, unmatched } = buildRows(key, ROSTER, ts);
  assert.equal(rows[2]!.합계, null);
  assert.equal(rows[2]!.비고, '미제출');
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0]!.이름, '미확인 답안지(p03)');
  assert.equal(unmatched[0]!.합계, 0);
  assert.equal(unmatched[0]!.비고, '학생 식별 불가');
});

test('buildRows_no_roster: 명단 없으면 답안지가 있는 학생만, 이름은 답안지의 것', () => {
  const { rows, unmatched } = buildRows(key, null, ts);
  assert.deepEqual(rows.map(r => [r.번호, r.이름]), [[1, '박가상'], [2, '이가샹']]);
  assert.equal(rows[1]!.비고, '식별 추정; 이름 흐림; 단위 누락: 3-1; 단위 누락: E1');
  assert.equal(unmatched.length, 1);
});

test('buildRows_headcount_rows: 인원이 있으면 빈 번호를 미제출(인원 기준)으로', () => {
  const k = { ...key, 대상: { 학년: 3, 반: [1], 인원: { 1: 4 } as never } };
  const { rows } = buildRows(k, null, ts);
  assert.deepEqual(rows.map(r => r.번호), [1, 2, 3, 4]);
  assert.equal(rows[2]!.비고, '미제출(인원 기준)');
  assert.equal(rows[3]!.합계, null);
});

test('buildRows_duplicates: 같은 번호 두 장은 미확인으로 내리고 본 행은 미확정', () => {
  const dup: Transcript = { ...ts[0]!, page: 7, 비고: ['두 번째'] };
  const { rows, unmatched } = buildRows(key, ROSTER, [...ts, dup]);
  assert.equal(rows[0]!.합계, null);
  assert.equal(rows[0]!.비고, '미확정(번호 중복: p01, p07)');
  const pages = unmatched.map(u => u.page).sort((a, b) => a! - b!);
  assert.deepEqual(pages, [1, 3, 7]);
  assert.equal(unmatched.find(u => u.page === 7)!.비고, '번호 중복(p01, p07); 두 번째');
  assert.equal(unmatched.find(u => u.page === 7)!.이름, '미확인 답안지(p07)');
});

test('buildRows_other_class_without_roster: 대상 밖 반은 미확인', () => {
  const other: Transcript = { ...ts[0]!, page: 8, 반: 2 };
  const { unmatched } = buildRows(key, null, [other]);
  assert.equal(unmatched[0]!.비고, '대상 반 아님');
});

test('scoreOne: 합계 = 판정 O 수 + 응답 true 수', () => {
  const r = scoreOne(key, ts[0]!);
  assert.deepEqual([r.정량, r.정성, r.합계], [1, 1, 2]);
  assert.equal(r.답['E1'], '샘플 답 원문');
});
