import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { addCase, findCase, normalizeAnswer, pagesWithSameAnswer, rejudgeAll, rejudgeTranscript, removeCase } from '../src/core/rejudge.js';
import type { AnswerKey, Transcript } from '../src/core/types.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const t = (page: number, 답: Record<string, [string, 'O' | 'X' | '빈칸']>, 비고: string[] = []): Transcript => ({
  page, 학년: 3, 반: 1, 번호: page, 이름: null, 식별확신: '확실',
  정량: Object.fromEntries(Object.entries(답).map(([id, [a, v]]) => [id, { 답: a, 판정: v }])),
  정성: { E1: { 응답: false, 답: '' } }, 비고,
});

test('normalizeAnswer: 공백·끝 문장부호·NFC만 정리하고 글자는 바꾸지 않는다', () => {
  assert.equal(normalizeAnswer('  최 은영 . '), '최 은영');
  assert.equal(normalizeAnswer('은영\n'), '은영');
  assert.equal(normalizeAnswer('은 영'), '은 영');
  assert.notEqual(normalizeAnswer('은영'), normalizeAnswer('은 영'));
});

test('rejudgeTranscript: 빈 답은 빈칸, 정답·허용 일치는 O, 그 밖은 유지, 비고에 근거', () => {
  const k: AnswerKey = { ...key, 정량: key.정량.map(u => u.id === '1-1' ? { ...u, 허용: ['최은영'] } : u) };
  const r = rejudgeTranscript(k, t(1, { '1-1': ['최은영.', 'X'], '3-1': ['', 'X'] }));
  assert.equal(r.transcript.정량['1-1']!.판정, 'O');
  assert.equal(r.transcript.정량['3-1']!.판정, '빈칸');
  assert.deepEqual(r.changes.map(c => [c.단위, c.이전, c.이후, c.근거]), [['1-1', 'X', 'O', '허용'], ['3-1', 'X', '빈칸', '빈칸']]);
  assert.ok(r.transcript.비고.some(b => b.startsWith('재판정: 1-1 X→O (허용), 3-1 X→빈칸 (빈칸)')));
  assert.equal(r.transcript.정량['1-1']!.답, '최은영.'); // 답은 그대로
  const same = rejudgeTranscript(k, t(1, { '1-1': ['은영이', 'X'], '3-1': ['붙임성', 'O'] })); // 뜻 판단은 하지 않는다
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.transcript.비고, []);
});

test('rejudgeTranscript: 두 번 돌려도 재판정 비고는 한 줄이고, 사례가 정답보다 먼저다', () => {
  const k = addCase(key, { 단위: '1-1', 답: '은영', 판정: 'X', 일시: '2026-11-06T00:00:00Z', 출처: '검토 p02' });
  const once = rejudgeTranscript(k, t(1, { '1-1': ['은영', 'O'], '3-1': ['', '빈칸'] })).transcript;
  assert.equal(once.정량['1-1']!.판정, 'X');
  const twice = rejudgeTranscript(k, once).transcript;
  assert.equal(twice.비고.filter(b => b.startsWith('재판정:')).length, 1);
  assert.deepEqual(twice.비고, once.비고);
});

test('rejudgeAll·pagesWithSameAnswer: 같은 답을 쓴 장만 바뀐다', () => {
  const ts = [t(1, { '1-1': ['인간관계', 'O'], '3-1': ['', '빈칸'] }), t(2, { '1-1': ['인간 관계', 'O'], '3-1': ['', '빈칸'] }), t(3, { '1-1': ['인간관계 ', 'O'], '3-1': ['', '빈칸'] })];
  assert.deepEqual(pagesWithSameAnswer(ts, '1-1', '인간관계', 1), [3]);
  const k = addCase(key, { 단위: '1-1', 답: '인간관계', 판정: 'X', 일시: 'x', 출처: '검토 p01' });
  const r = rejudgeAll(k, ts);
  assert.deepEqual(r.changed.map(c => c.page), [1, 3]);
  assert.equal(r.transcripts[1]!.정량['1-1']!.판정, 'O');
});

test('addCase·removeCase·findCase: 같은 단위·답은 교체, 지우면 없다', () => {
  let k = addCase(key, { 단위: '1-1', 답: '은영', 판정: 'X', 일시: 'a', 출처: 'p1' });
  k = addCase(k, { 단위: '1-1', 답: ' 은영 ', 판정: 'O', 일시: 'b', 출처: 'p2' });
  assert.equal(k.사례!.length, 1);
  assert.equal(findCase(k, '1-1', '은영')?.판정, 'O');
  assert.equal(findCase(k, '3-1', '은영'), undefined);
  assert.equal(removeCase(k, '1-1', '은영').사례!.length, 0);
});
