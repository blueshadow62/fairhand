import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { addCase, decide, essayMarks, findCase, keyMatch, normalizeAnswer, pagesWithSameAnswer, rejudgeAll, rejudgeTranscript, removeCase } from '../src/core/rejudge.js';
import type { AnswerKey, Transcript } from '../src/core/types.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));

test('decide(논술형): 글 속에 정답 문장·용어(허용)가 그대로 있으면 O, 비었거나 못 찾으면 모델 판정을 둔다(X·빈칸을 덮지 않음)', () => {
  const essayKey: AnswerKey = { ...key, 정량: [
    { id: '5-1', 문항: 5, 설명: '인용 1', 정답: '배움은 삶이다', 유형: '논술형', 종류: '인용' },
    { id: '5-2', 문항: 5, 설명: '용어 1', 정답: '학습자 중심', 허용: ['학습자중심'], 유형: '논술형', 종류: '용어' }] };
  assert.deepEqual(decide(essayKey, '5-1', '그래서 배움은 삶이다 라고 했다'), { 판정: 'O', 근거: '정답' });
  assert.deepEqual(decide(essayKey, '5-2', '학습자중심 수업'), { 판정: 'O', 근거: '허용' });
  assert.equal(decide(essayKey, '5-1', ''), null); // 빈칸으로 바꾸지 않는다
  assert.equal(decide(essayKey, '5-1', '배움이 곧 삶'), null); // 바꿔 쓴 것은 모델 판정대로
});
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

test('essayMarks: 논술형 답에서 정답·허용 표기가 그대로 들어 있는 곳을 나누고, 이으면 NFC 답 그대로다', () => {
  const quote = { id: '5-1', 문항: 5, 설명: '인용 1', 정답: '배움은 삶이다.', 유형: '논술형' as const, 종류: '인용' as const };
  const term = { id: '5-2', 문항: 5, 설명: '용어 1', 정답: '학습자 중심', 허용: ['학습자중심', '중심'], 유형: '논술형' as const, 종류: '용어' as const };
  const join = (ps: { text: string }[]) => ps.map(p => p.text).join('');
  // 줄바꿈·여러 칸 띄어쓰기는 한 칸으로 보고 찾되, 표시는 원래 글 그대로(사이의 줄바꿈까지 한 조각)
  const a = '그래서 배움은\n  삶이다 라고 했다.';
  const pa = essayMarks(quote, a);
  assert.deepEqual(pa, [{ text: '그래서 ' }, { text: '배움은\n  삶이다', 근거: '정답' }, { text: ' 라고 했다.' }]);
  assert.equal(join(pa), a);
  // 허용 표기, 같은 표기가 두 번, 정답 안에 든 허용('중심')은 정답 하나로
  const b = '학습자중심 수업과 학습자 중심 평가, 학습자중심';
  assert.deepEqual(essayMarks(term, b).filter(p => p.근거).map(p => [p.text, p.근거]), [['학습자중심', '허용'], ['학습자 중심', '정답'], ['학습자중심', '허용']]);
  assert.equal(join(essayMarks(term, b)), b);
  // 못 찾으면 한 조각, 빈 답은 조각 없음, 바꿔 쓴 것은 칠하지 않는다
  assert.deepEqual(essayMarks(quote, '배움이 곧 삶'), [{ text: '배움이 곧 삶' }]);
  assert.deepEqual(essayMarks(quote, ''), []);
  // 자모로 나뉜(NFD) 글도 NFC로 맞춰 찾는다
  const nfd = '배움은 삶이다'.normalize('NFD');
  assert.deepEqual(essayMarks(quote, nfd), [{ text: '배움은 삶이다', 근거: '정답' }]);
  // 논술형이 아니면 나누지 않고 글도 바꾸지 않는다
  const short = { id: '1-1', 문항: 1, 설명: '단답', 정답: '가나', 유형: '단답형' as const };
  assert.deepEqual(essayMarks(short, '가나 다'), [{ text: '가나 다' }]);
  // keyMatch(판정과 같은 기준)가 맞다고 한 답에는 그 근거의 조각이 있다
  for (const [u, s] of [[quote, a], [term, b], [term, '중심 잡기'], [quote, '배움은 삶이다!!']] as const) {
    const m = keyMatch(u, s);
    assert.ok(m && essayMarks(u, s).some(p => p.근거 === m), `${u.id} ${s}`);
  }
});
