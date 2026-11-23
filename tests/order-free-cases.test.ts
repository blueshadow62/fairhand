import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { caseRevertRequest, planApplyCase, planCaseRevert } from '../src/core/cases.js';
import { keyProblems, parseKey } from '../src/core/key.js';
import { caseActive, caseRecord, decidePage, findCase, findCaseFor, rejudgeTranscript, stampCase } from '../src/core/rejudge.js';
import type { AnswerKey, Case, Panjeong, QtyUnit, Transcript } from '../src/core/types.js';
import { casesOnChangedAnswers, mapUnits, remapCases } from '../src/core/unit-map.js';
import { planUnitResults } from '../src/core/unit-results.js';
import { loadRules, systemPrompt } from '../src/engine/rules.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';
import { keyToRows, rowsToKey } from '../src/renderer/lib/key-form.js';

// 가짜 정답표: 2번 문항 2-1(사과)·2-2(배)·2-3(감). on은 세 단위가 순서 무관, off는 자리 기준
const OF = { 유형: '빈칸형' as const, 순서무관: true as const };
const on: AnswerKey = {
  세트: '가짜', 글: '가짜 글', 학기: '2026 2학기', 대상: { 학년: 1, 반: [1] }, 정성: [],
  정량: [
    { id: '1-1', 문항: 1, 설명: '이름', 정답: '지연', 유형: '단답형' },
    { id: '2-1', 문항: 2, 설명: '과일 1', 정답: '사과', ...OF },
    { id: '2-2', 문항: 2, 설명: '과일 2', 정답: '배', ...OF },
    { id: '2-3', 문항: 2, 설명: '과일 3', 정답: '감', ...OF },
  ],
};
const off: AnswerKey = { ...on, 정량: on.정량.map(({ 순서무관: _, ...u }) => u) };
const withCases = (k: AnswerKey, 사례: Case[]): AnswerKey => ({ ...k, 사례 });
const cs = (단위: string, 답: string, 판정: 'O' | 'X', 묶음?: true): Case => ({ 단위, 답, 판정, 일시: '2026-11-20T00:00:00.000Z', 출처: '검토', ...(묶음 ? { 묶음 } : {}) });
const tr = (page: number, a: Record<string, [string, Panjeong]>): Transcript => ({
  page, 학년: 1, 반: 1, 번호: page, 이름: null, 식별확신: '확실',
  정량: Object.fromEntries(Object.entries(a).map(([id, [답, 판정]]) => [id, { 답, 판정 }])), 정성: {}, 비고: [],
});
const NOW = new Date('2026-11-23T00:00:00.000Z');

test('caseActive: 순서 무관이면 묶음 사례 전부와 자리 기준 O, 아니면 자리 기준 사례 전부와 묶음 X', () => {
  const v = (k: AnswerKey, c: Case) => caseActive(k, c);
  assert.deepEqual([v(on, cs('2-1', '배', 'X')), v(on, cs('2-1', '배', 'O')), v(on, cs('2-1', '배', 'X', true)), v(on, cs('2-1', '배', 'O', true))], [false, true, true, true]);
  assert.deepEqual([v(off, cs('2-1', '배', 'X')), v(off, cs('2-1', '배', 'O')), v(off, cs('2-1', '배', 'X', true)), v(off, cs('2-1', '배', 'O', true))], [true, true, true, false]);
  assert.equal(v(on, cs('1-1', '지연이', 'X')), true); // 묶음 밖 단위의 사례는 그대로
});

test('자리 기준 X 사례: 순서 무관을 켜면 판정을 바꾸지 않는다(맞는 답이 O→X(사례)가 되지 않는다)', () => {
  // 자리 기준일 때 2-1(사과) 칸에 쓴 '배'를 X로 정한 사례. 묶음에서는 '배'가 2-2의 정답이다
  const k = withCases(on, [cs('2-1', '배', 'X')]);
  assert.equal(findCase(k, '2-1', '배'), undefined);
  assert.equal(findCaseFor(k, '2-3', '배'), undefined);
  assert.equal(caseRecord(k, '2-1', '배')?.판정, 'X'); // 파일에는 그대로 있다
  const t = tr(1, { '2-1': ['배', 'O'], '2-2': ['감', 'O'], '2-3': ['사과', 'O'] });
  assert.deepEqual(rejudgeTranscript(k, t).changes, []);
  assert.deepEqual(decidePage(k, { '2-1': '배' })['2-1'], { 판정: 'O', 근거: '정답' });
  // 순서 무관을 끄면 그 사례가 다시 쓰인다
  assert.deepEqual(rejudgeTranscript(withCases(off, k.사례!), tr(2, { '2-1': ['배', 'O'] })).changes.map(c => `${c.단위} ${c.이전}→${c.이후} ${c.근거}`), ['2-1 O→X 사례']);
});

test('자리 기준 O 사례는 묶음의 다른 칸에도 적용된다', () => {
  const k = withCases(on, [cs('2-1', '사과즙', 'O')]);
  assert.deepEqual(decidePage(k, { '2-1': '배', '2-3': '사과즙' })['2-3'], { 판정: 'O', 근거: '사례' });
});

test('묶음 사례: 순서 무관을 끄면 O는 쓰이지 않고 X는 쓰인다', () => {
  const cases = [cs('2-1', '사과즙', 'O', true), cs('2-1', '귤', 'X', true)];
  assert.deepEqual(decidePage(withCases(on, cases), { '2-1': '귤', '2-2': '사과즙' }), { '2-1': { 판정: 'X', 근거: '사례' }, '2-2': { 판정: 'O', 근거: '사례' } });
  const k = withCases(off, cases);
  assert.equal(findCase(k, '2-1', '사과즙'), undefined);
  assert.equal(findCase(k, '2-1', '귤')?.판정, 'X');
  assert.deepEqual(decidePage(k, { '2-1': '사과즙' })['2-1'], null);
});

test('기록하는 길: 순서 무관 단위에 기록한 사례에 묶음이 붙고, 아닌 단위에는 붙지 않는다', () => {
  assert.deepEqual(stampCase(on, cs('2-2', '귤', 'X')), cs('2-2', '귤', 'X', true));
  assert.deepEqual(stampCase(off, cs('2-2', '귤', 'X', true)), cs('2-2', '귤', 'X'));
  assert.deepEqual(stampCase(on, cs('1-1', '지연이', 'O')), cs('1-1', '지연이', 'O'));
  // 답안지별 검토(applyCase)
  const ts = [tr(1, { '2-1': ['귤', 'X'], '2-2': ['배', 'O'], '2-3': ['감', 'O'] }), tr(2, { '2-1': ['사과', 'O'], '2-2': ['귤', 'X'], '2-3': ['감', 'O'] })];
  assert.equal(planApplyCase(on, ts, { 단위: '2-1', 답: '귤', 판정: 'X', page: 1 }, NOW).key.사례?.[0]?.묶음, true);
  assert.equal(planApplyCase(off, ts, { 단위: '2-1', 답: '귤', 판정: 'X', page: 1 }, NOW).key.사례?.[0]?.묶음, undefined);
  // 문항별 검토(사례 기록)
  const plan = planUnitResults(on, ts, { 단위: '2-2', 항목: [{ page: 2, 판정: 'O' }], 사례기록: true }, NOW);
  assert.deepEqual(plan.사례.map(c => [c.단위, c.답, c.판정, c.묶음]), [['2-2', '귤', 'O', true]]);
});

test('바꿔 쓴 사례가 쓰이지 않던 사례여도 되돌리기가 묶음 값까지 그대로 되살린다', () => {
  const old = cs('2-1', '귤', 'X'); // 자리 기준 X(지금 쓰이지 않음)
  const k = withCases(on, [old]);
  const ts = [tr(1, { '2-1': ['귤', 'X'], '2-2': ['배', 'O'], '2-3': ['', '빈칸'] }), tr(2, { '2-1': ['사과', 'O'], '2-2': ['', '빈칸'], '2-3': ['귤', 'X'] })];
  const plan = planApplyCase(k, ts, { 단위: '2-1', 답: '귤', 판정: 'O', page: 1 }, NOW);
  assert.deepEqual(plan.이전사례, old);
  assert.deepEqual(plan.key.사례?.map(c => [c.단위, c.판정, c.묶음]), [['2-1', 'O', true]]);
  // 렌더러를 거친 요청(JSON)으로 되돌린다. 묶음이 있는 이전 사례도 받는다
  const req = caseRevertRequest(JSON.parse(JSON.stringify({ 사례: [{ 단위: '2-1', 답: '귤', 판정: 'O', 이전사례: plan.이전사례 }], 변경: plan.변경.filter(c => c.page !== 1) })), on);
  const back = planCaseRevert(plan.key, ts.map(t => plan.쓸전사.find(x => x.page === t.page) ?? t), req);
  assert.deepEqual(back.key!.사례, [old]);
  const grouped = cs('2-1', '귤', 'X', true);
  const req2 = caseRevertRequest({ 사례: [{ 단위: '2-1', 답: '귤', 판정: 'O', 이전사례: grouped }], 변경: [] }, on);
  assert.deepEqual(req2.사례[0]!.이전사례, grouped);
  assert.deepEqual(planCaseRevert(withCases(on, [cs('2-1', '귤', 'O', true)]), [], req2).key!.사례, [grouped]);
  assert.throws(() => caseRevertRequest({ 사례: [{ 단위: '2-1', 답: '귤', 판정: 'O', 이전사례: { ...grouped, 묶음: 1 } }], 변경: [] }), /이전 사례가 잘못/);
});

test('지시문의 판정 사례 절에는 지금 쓰이는 사례만 들어간다', async () => {
  const rules = await loadRules();
  const cases = [cs('2-1', '배', 'X'), cs('2-1', '사과즙', 'O'), cs('2-2', '귤', 'O', true), cs('2-2', '참외', 'X', true)];
  const lines = (k: AnswerKey) => systemPrompt(rules, k).split('\n').filter(l => /^- 2-\d: "/.test(l));
  assert.deepEqual(lines(withCases(on, cases)), ['- 2-1: "사과즙" → O', '- 2-2: "귤" → O', '- 2-2: "참외" → X']);
  assert.deepEqual(lines(withCases(off, cases)), ['- 2-1: "배" → X', '- 2-1: "사과즙" → O', '- 2-2: "참외" → X']);
  // 순서 무관 단위와 묶음 사례가 없으면 사례 절은 전과 같다(모두 들어간다)
  assert.equal(lines(withCases(off, cases.slice(0, 2))).length, 2);
});

test('정답표 검사·왕복: 사례의 묶음은 true만 받고, 저장·가져오기·문항 설정·단위 id 다시 매기기에서 유지된다', () => {
  const k = withCases(on, [cs('2-2', '귤', 'O', true), cs('1-1', '지연이', 'O')]);
  assert.deepEqual(keyProblems(k), []);
  assert.ok(keyProblems({ ...k, 사례: [{ ...cs('2-2', '귤', 'O'), 묶음: 'yes' }] }).some(p => /사례 1: 묶음 값은 true여야/.test(p)));
  const parsed = parseKey(JSON.stringify(k));
  assert.deepEqual(parsed.사례, k.사례);
  const r = keyToRows(parsed);
  assert.deepEqual(rowsToKey(r.meta, r.rows, undefined, parsed.사례).사례, k.사례);
  const moved = remapCases(k.사례, undefined, mapUnits(k, off), off);
  assert.deepEqual(moved.사례, k.사례);
});

test('casesOnChangedAnswers: 쓰이지 않는 사례는 확인할 사례·어긋난 사례로 알리지 않는다', () => {
  const next: AnswerKey = { ...on, 정량: on.정량.map(u => (u.id === '2-1' ? { ...u, 허용: ['배'] } : u)), 사례: [cs('2-1', '배', 'X'), cs('2-1', '감', 'X', true)] };
  const r = casesOnChangedAnswers(on, next, mapUnits(on, next));
  assert.deepEqual(r, [{ 단위: '2-1', 답: '감', 판정: 'X', 어긋남: true }]);
});

test('세트에서: 자리 기준 X 사례가 있는 문항에 순서 무관을 켜고 다시 판정해도 O→X(사례)가 나오지 않는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-ofc-'));
  const set = path.join(dir, '세트');
  try {
    await mkdir(path.join(set, 'transcripts'), { recursive: true });
    await mkdir(path.join(set, 'pages'), { recursive: true });
    await writeFile(path.join(set, '정답표.json'), JSON.stringify({ ...off, 확인: { 완료: true }, 사례: [cs('2-1', '배', 'X')] }), 'utf-8');
    const t = tr(1, { '1-1': ['지연', 'O'], '2-1': ['배', 'O'], '2-2': ['사과', 'O'], '2-3': ['감', 'O'] }); // 모델이 순서 무관으로 O를 준 장
    await writeFile(path.join(set, 'transcripts', 'p01.json'), JSON.stringify(t), 'utf-8');
    await writeFile(path.join(set, 'pages', 'p01.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
    const saved = await bridge.saveKey(set, { ...on, 확인: { 완료: true }, 사례: [cs('2-1', '배', 'X')] });
    assert.deepEqual(saved.key.사례, [cs('2-1', '배', 'X')]); // 지우지 않는다
    assert.deepEqual((await bridge.rejudge(set)).바뀐장, []);
    const file = JSON.parse(await readFile(path.join(set, 'transcripts', 'p01.json'), 'utf-8')) as Transcript;
    assert.equal(file.정량['2-1']!.판정, 'O');
    assert.ok(((JSON.parse(await readFile(path.join(set, '정답표.json'), 'utf-8')) as AnswerKey).정량 as QtyUnit[]).some(u => u.순서무관));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
