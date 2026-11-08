import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { parseTranscript, identified, validateTranscripts, findDuplicates } from '../src/core/transcript.js';
import { DataError, type Transcript } from '../src/core/types.js';

const FX = new URL('../../tests/fixtures/세트샘플/', import.meta.url);
const key = parseKey(readFileSync(new URL('정답표.json', FX), 'utf-8'));
const load = (n: string) => parseTranscript(readFileSync(new URL(`transcripts/${n}`, FX), 'utf-8'), n);

test('parseTranscript: 옛 이름확신을 식별확신으로 옮긴다', () => {
  const t = load('p02.json');
  assert.equal(t.식별확신, '추정');
  assert.equal((t as unknown as Record<string, unknown>)['이름확신'], undefined);
  assert.equal(t.이름, '이가샹');
});

test('parseTranscript: 빠진 이름은 null, 정량·정성 없으면 빈 객체', () => {
  const t = parseTranscript('{"page":9,"학년":3,"반":1,"번호":5,"식별확신":"확실","비고":[]}', 'p09.json');
  assert.equal(t.이름, null);
  assert.deepEqual(t.정량, {});
  assert.deepEqual(t.정성, {});
});

test('parseTranscript: 문법 오류·식별확신 오류·비고 오류는 파일명과 함께 DataError', () => {
  assert.throws(() => parseTranscript('{깨짐', 'p01.json'), (e: unknown) => e instanceof DataError && /p01\.json/.test(e.message));
  assert.throws(() => parseTranscript('{"page":1,"식별확신":"몰라","비고":[]}', 'p01.json'), /식별확신/);
  assert.throws(() => parseTranscript('{"page":1,"식별확신":"확실","비고":"x"}', 'p01.json'), /비고/);
});

test('identified: 불명이거나 번호가 없으면 false', () => {
  assert.equal(identified(load('p01.json')), true);
  assert.equal(identified(load('p03.json')), false);
});

test('validateTranscripts: 정답표에 없는 단위·판정 값·응답 문자열에서 멈춘다', () => {
  const base: Transcript = { page: 1, 학년: 3, 반: 1, 번호: 1, 이름: 'a', 식별확신: '확실', 정량: {}, 정성: {}, 비고: [] };
  assert.throws(() => validateTranscripts(key, [{ ...base, 정량: { '9-9': { 답: '', 판정: 'O' } } }]), /9-9/);
  assert.throws(() => validateTranscripts(key, [{ ...base, 정량: { '1-1': { 답: '', 판정: 'ㅇ' as never } } }]), /판정/);
  assert.throws(() => validateTranscripts(key, [{ ...base, 정성: { E1: { 응답: 'false' as never, 답: '' } } }]), /E1/);
  validateTranscripts(key, [load('p01.json'), load('p02.json'), load('p03.json')]);
});

test('findDuplicates: 같은 학생 두 장은 멈추지 않고 쪽 목록으로 돌려준다', () => {
  const a = load('p01.json'), b = { ...load('p01.json'), page: 7 };
  validateTranscripts(key, [a, b]);
  assert.deepEqual([...findDuplicates(key, [a, b, load('p02.json')])], [['3-1-1', [1, 7]]]);
});

test('parseTranscript·validateTranscripts: page는 1 이상 정수, 답은 글자여야 한다', () => {
  const key = parseKey(readFileSync(new URL('정답표.json', FX), 'utf-8'));
  const base = { 학년: 3, 반: 1, 번호: 1, 이름: null, 식별확신: '확실', 정량: {}, 정성: {}, 비고: [] };
  for (const page of [1.5, 0, -1, 'NaN']) assert.throws(() => parseTranscript(JSON.stringify({ ...base, page }), 'x'), (e: unknown) => e instanceof DataError && /page/.test(e.message));
  const t = parseTranscript(JSON.stringify({ ...base, page: 7 }), 'x');
  assert.throws(() => validateTranscripts(key, [{ ...t, 정량: { '1-1': { 답: null as unknown as string, 판정: 'X' } } }]), (e: unknown) => e instanceof DataError && /답은 글자/.test(e.message));
  assert.throws(() => validateTranscripts(key, [{ ...t, 정성: { E1: { 응답: true, 답: 3 as unknown as string } } }]), (e: unknown) => e instanceof DataError && /답은 글자/.test(e.message));
});

test('parseTranscript: 논술글(화면에만 쓰는 칸)은 글자 값만 남기고 모양이 틀리면 오류 대신 버린다. 옛 파일에는 없다', () => {
  const base = { page: 3, 학년: 3, 반: 1, 번호: 1, 이름: null, 식별확신: '확실', 정량: {}, 정성: {}, 비고: [] };
  assert.ok(!('논술글' in load('p01.json')));
  assert.deepEqual(parseTranscript(JSON.stringify({ ...base, 논술글: { 9: '글 전체', 10: 3, 11: '' } }), 'x').논술글, { 9: '글 전체', 11: '' });
  for (const 논술글 of ['글', ['글'], null, { 9: null }]) assert.ok(!('논술글' in parseTranscript(JSON.stringify({ ...base, 논술글 }), 'x')), JSON.stringify(논술글));
});
