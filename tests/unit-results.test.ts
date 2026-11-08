import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { parseTranscript } from '../src/core/transcript.js';
import { DataError, type AnswerKey, type Panjeong, type Transcript } from '../src/core/types.js';
import { planUnitResults, representative, setSheetDone, uncheckChanged, unitChecked, unitResultsRequest, type UnitResultsRequest } from '../src/core/unit-results.js';

// 픽스처 정답표: 정량 1-1·3-1, 정성 E1
const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const NOW = new Date('2026-11-08T00:00:00Z');
const tr = (page: number, a: string, v: Panjeong, extra: Partial<Transcript> = {}): Transcript => ({
  page, 학년: 3, 반: 1, 번호: page, 이름: null, 식별확신: '확실',
  정량: { '1-1': { 답: a, 판정: v }, '3-1': { 답: '핵심 낱말', 판정: 'O' } }, 정성: { E1: { 응답: true, 답: '생각' } }, 비고: [], ...extra });
const req = (단위: string, 항목: UnitResultsRequest['항목'], 사례기록 = false): UnitResultsRequest => ({ 단위, 항목, 사례기록 });
const plan = (ts: Transcript[], r: UnitResultsRequest, k: AnswerKey = key) => planUnitResults(k, ts, r, NOW);

test('parseTranscript: 확인단위는 글자 목록만, 없으면 그대로(옛 파일)', () => {
  const base = { page: 1, 식별확신: '확실', 비고: [] };
  assert.deepEqual(parseTranscript(JSON.stringify({ ...base, 확인단위: ['1-1', 'E1'] }), 'p01.json').확인단위, ['1-1', 'E1']);
  assert.equal(parseTranscript(JSON.stringify(base), 'p01.json').확인단위, undefined);
  for (const bad of ['1-1', [1], [null], {}]) assert.throws(() => parseTranscript(JSON.stringify({ ...base, 확인단위: bad }), 'p01.json'), /확인단위/);
});

test('unitResultsRequest: 모양 검사, 같은 값의 겹침은 하나로, 다른 값의 겹침은 거절', () => {
  for (const bad of [null, [], 'x', { 항목: [{ page: 1 }] }, { 단위: '', 항목: [{ page: 1 }] }, { 단위: '1-1', 항목: [] }, { 단위: '1-1' }])
    assert.throws(() => unitResultsRequest(bad), DataError, JSON.stringify(bad));
  for (const item of [{ page: 0 }, { page: 1.5 }, { page: '1' }, null, { page: 1, 판정: 'ㅇ' }, { page: 1, 응답: 'false' }])
    assert.throws(() => unitResultsRequest({ 단위: '1-1', 항목: [item] }), DataError, JSON.stringify(item));
  assert.throws(() => unitResultsRequest({ 단위: '1-1', 항목: Array.from({ length: 1001 }, (_, i) => ({ page: i + 1 })) }), /1000장/);
  const r = unitResultsRequest({ 단위: '1-1', 항목: [{ page: 2, 판정: 'O', 덤: 1 }, { page: 2, 판정: 'O' }, { page: 3 }], 사례기록: true });
  assert.deepEqual(r, { 단위: '1-1', 항목: [{ page: 2, 판정: 'O' }, { page: 3 }], 사례기록: true }); // 모르는 칸은 버린다
  assert.equal(unitResultsRequest({ 단위: '1-1', 항목: [{ page: 1 }], 사례기록: 'yes' }).사례기록, false);
  assert.throws(() => unitResultsRequest({ 단위: '1-1', 항목: [{ page: 2, 판정: 'O' }, { page: 2, 판정: 'X' }] }), /서로 다르게/);
});

test('unitResultsRequest·planUnitResults: 오류 글에 장 번호를 넣지 않는다(신원을 숨기는 화면)', () => {
  const messages: string[] = [];
  for (const bad of [{ 단위: '1-1', 항목: [{ page: 17.5 }] }, { 단위: '1-1', 항목: [{ page: 17, 판정: 'O' }, { page: 17, 판정: 'X' }] }])
    try { unitResultsRequest(bad); } catch (e) { messages.push((e as Error).message); }
  try { plan([tr(1, '가나', 'O')], req('1-1', [{ page: 17 }, { page: 18 }])); } catch (e) { messages.push((e as Error).message); }
  assert.equal(messages.length, 3);
  assert.match(messages[2]!, /2장/);
  for (const m of messages) assert.ok(!/17|18|p\d/.test(m), m);
});

test('planUnitResults: 그 단위·그 장만 바꾸고 확인 표시, 다른 단위와 다른 장은 그대로', () => {
  const ts = [tr(1, '가나', 'O'), tr(2, '가나', 'O'), tr(3, '다라', 'X')];
  const p = plan(ts, req('1-1', [{ page: 1, 판정: 'X' }, { page: 2, 판정: 'X' }]));
  assert.equal(p.바뀐장수, 2); assert.equal(p.확인장수, 2);
  assert.deepEqual(p.쓸전사.map(t => t.page), [1, 2]);
  for (const t of p.쓸전사) {
    assert.deepEqual(t.정량['1-1'], { 답: '가나', 판정: 'X' });
    assert.deepEqual(t.정량['3-1'], { 답: '핵심 낱말', 판정: 'O' });
    assert.deepEqual(t.확인단위, ['1-1']);
    assert.equal(t.확인완료, undefined);
  }
  assert.equal(ts[0]!.정량['1-1']!.판정, 'O'); // 받은 전사는 고치지 않는다
  assert.equal(ts[0]!.확인단위, undefined);
});

test('planUnitResults: 지금 판정과 같으면 확인 표시만, 이미 확인했으면 쓸 것이 없다', () => {
  const p = plan([tr(1, '가나', 'O')], req('1-1', [{ page: 1, 판정: 'O' }]));
  assert.equal(p.바뀐장수, 0); assert.equal(p.확인장수, 1);
  assert.deepEqual(p.쓸전사[0]!.확인단위, ['1-1']);
  const again = plan(p.쓸전사, req('1-1', [{ page: 1, 판정: 'O' }]));
  assert.deepEqual(again, { 쓸전사: [], 바뀐장수: 0, 확인장수: 0, 사례: [] });
  const done = plan([tr(1, '가나', 'O', { 확인완료: true })], req('1-1', [{ page: 1 }])); // 답안지별에서 확인 완료한 장은 이미 확인한 것
  assert.equal(done.확인장수, 0);
  assert.deepEqual(done.쓸전사[0]!.확인단위, ['1-1']);
});

test('planUnitResults: 모든 단위(정량+정성)를 확인하면 그 장을 확인 완료로', () => {
  let ts = [tr(1, '가나', 'O')];
  for (const 단위 of ['1-1', '3-1']) { ts = plan(ts, req(단위, [{ page: 1 }])).쓸전사; assert.notEqual(ts[0]!.확인완료, true); }
  const last = plan(ts, req('E1', [{ page: 1 }])).쓸전사[0]!;
  assert.deepEqual(last.확인단위, ['1-1', '3-1', 'E1']);
  assert.equal(last.확인완료, true);
});

test('planUnitResults: 정성은 응답만, 정량은 판정만, 정답표에 없는 단위·전사 없는 장은 거절', () => {
  const ts = [tr(1, '가나', 'O'), tr(2, '', '빈칸')];
  const q = plan(ts, req('E1', [{ page: 1, 응답: false }, { page: 2, 응답: true }]));
  assert.equal(q.바뀐장수, 1);
  assert.deepEqual(q.쓸전사.map(t => [t.page, t.정성.E1!.응답, t.정량['1-1']!.판정]), [[1, false, 'O'], [2, true, '빈칸']]);
  assert.throws(() => plan(ts, req('E1', [{ page: 1, 판정: 'O' }])), /정성 단위/);
  assert.throws(() => plan(ts, req('1-1', [{ page: 1, 응답: true }])), /정량 단위/);
  assert.throws(() => plan(ts, req('9-9', [{ page: 1 }])), /9-9/);
  assert.throws(() => plan(ts, req('1-1', [{ page: 1 }, { page: 5 }])), /1장/);
});

test('planUnitResults: 전사에 그 단위가 없으면 빈 답으로 보고 판정을 넣는다', () => {
  const t = tr(1, '가나', 'O');
  delete t.정량['3-1'];
  const p = plan([t], req('3-1', [{ page: 1, 판정: 'X' }]));
  assert.deepEqual(p.쓸전사[0]!.정량['3-1'], { 답: '', 판정: 'X' });
  assert.equal(plan([t], req('3-1', [{ page: 1, 판정: '빈칸' }])).바뀐장수, 0);
});

test('planUnitResults 사례: 같은 답을 쓴 장 전부를 같은 O·X로 바꿨을 때만, 대표 답으로', () => {
  const ts = [tr(1, '가나.', 'O'), tr(2, '가나', 'O'), tr(3, ' 가나 ', 'X'), tr(4, '다라', 'O'), tr(5, '', 'X')];
  const all = [1, 2, 3].map(page => ({ page, 판정: 'X' as Panjeong }));
  const p = plan(ts, req('1-1', all, true));
  assert.deepEqual(p.사례, [{ 단위: '1-1', 답: '가나', 판정: 'X', 일시: NOW.toISOString(), 출처: '문항별 검토' }]);
  assert.equal(p.바뀐장수, 2);
  assert.deepEqual(plan(ts, req('1-1', all)).사례, []); // 사례 기록을 끈 요청
  assert.deepEqual(plan(ts, req('1-1', [{ page: 1, 판정: 'X' }], true)).사례, []); // 묶음에서 한 장만
  assert.deepEqual(plan(ts, req('1-1', [{ page: 3, 판정: 'O' }, { page: 1, 판정: 'O' }, { page: 2, 판정: 'X' }], true)).사례, []); // 묶음 안에서 갈림
  assert.deepEqual(plan(ts, req('1-1', [{ page: 4, 판정: 'O' }], true)).사례, []); // 바뀐 것 없음
  assert.deepEqual(plan(ts, req('1-1', [{ page: 5, 판정: 'X' }], true)).사례, []); // 빈 답
  assert.deepEqual(plan(ts, req('1-1', [1, 2, 3].map(page => ({ page, 판정: '빈칸' as Panjeong })), true)).사례, []); // 빈칸은 사례가 아니다
  assert.deepEqual(plan(ts, req('E1', [{ page: 1, 응답: false }], true)).사례, []); // 정성은 사례가 없다
  const withCase: AnswerKey = { ...key, 사례: [{ 단위: '1-1', 답: '가나', 판정: 'X', 일시: 'x', 출처: 'y' }] };
  assert.deepEqual(plan(ts, req('1-1', all, true), withCase).사례, []); // 이미 같은 사례
});

test('representative·unitChecked', () => {
  assert.equal(representative(['가나.', ' 가나.', '가나 ']), '가나.');
  assert.equal(representative(['나', '가']), '가'); // 수가 같으면 가나다순
  assert.equal(representative([]), '');
  assert.equal(unitChecked(tr(1, '', '빈칸', { 확인단위: ['1-1'] }), '1-1'), true);
  assert.equal(unitChecked(tr(1, '', '빈칸', { 확인단위: ['1-1'] }), '3-1'), false);
  assert.equal(unitChecked(tr(1, '', '빈칸', { 확인완료: true }), '3-1'), true);
});

test('setSheetDone: 답안지별에서 확인 완료를 풀면 확인단위도 비워 문항별에서 다시 미확인, 켜면 그대로', () => {
  const t = tr(1, '가나', 'O', { 확인완료: true, 확인단위: ['1-1', '3-1', 'E1'] });
  setSheetDone(t, false);
  assert.equal(t.확인완료, false);
  assert.equal(t.확인단위, undefined);
  assert.equal(unitChecked(t, '1-1'), false);
  const u = tr(2, '가나', 'O', { 확인단위: ['1-1'] });
  setSheetDone(u, true);
  assert.deepEqual([u.확인완료, u.확인단위], [true, ['1-1']]);
});

test('uncheckChanged: 다시 판정이 바꾼 단위의 확인을 빼고 확인 완료를 푼다. 바뀐 단위를 확인하지 않은 장은 그대로', () => {
  // 답안지별에서 확인 완료한 장: 모든 단위를 확인한 것이라 바뀌지 않은 단위의 확인은 남긴다(문항별에서 바뀐 단위만 미확인)
  const sheet = uncheckChanged(tr(1, '가나', 'O', { 확인완료: true }), key, ['1-1']);
  assert.equal(sheet.다시확인, true);
  assert.deepEqual([sheet.transcript.확인완료, sheet.transcript.확인단위], [false, ['3-1', 'E1']]);
  assert.deepEqual([unitChecked(sheet.transcript, '1-1'), unitChecked(sheet.transcript, '3-1')], [false, true]);
  // 문항별에서 단위마다 확인한 장
  const units = uncheckChanged(tr(2, '가나', 'O', { 확인단위: ['1-1', '3-1'] }), key, ['1-1']);
  assert.deepEqual([units.다시확인, units.transcript.확인완료, units.transcript.확인단위], [true, false, ['3-1']]);
  // 남는 확인이 없으면 칸을 두지 않는다. 판정·답·비고는 건드리지 않는다
  const only = tr(3, '가나', 'X', { 확인완료: true, 확인단위: ['1-1', '3-1', 'E1'], 비고: ['재판정: 1-1 O→X (정답)'] });
  const none = uncheckChanged(only, key, ['1-1', '3-1', 'E1']);
  const { 확인단위: _marks, ...rest } = only;
  assert.deepEqual(none.transcript, { ...rest, 확인완료: false });
  // 바뀐 단위를 확인하지 않았거나 바뀐 것이 없으면 같은 장을 그대로 돌려준다
  for (const [t, changed] of [[tr(4, '가나', 'O', { 확인단위: ['3-1'] }), ['1-1']], [tr(5, '가나', 'O'), ['1-1']], [tr(6, '가나', 'O', { 확인완료: true }), []]] as [Transcript, string[]][]) {
    const r = uncheckChanged(t, key, changed);
    assert.equal(r.transcript, t);
    assert.equal(r.다시확인, false);
  }
});
