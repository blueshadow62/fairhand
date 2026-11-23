import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { unitMarks } from '../src/core/answer-pdf.js';
import { caseConflict, caseRevertRequest, planApplyCase, planCaseRevert, previewCases } from '../src/core/cases.js';
import { keyProblems, parseKey } from '../src/core/key.js';
import { decide, decidePage, findCase, findCaseFor, orderFreeGroup, rejudgeTranscript } from '../src/core/rejudge.js';
import { buildRows, scoreOne } from '../src/core/score.js';
import { loadSet } from '../src/core/setio.js';
import type { AnswerKey, Panjeong, QtyUnit, Transcript } from '../src/core/types.js';
import { changedUnitIds, mapUnits, remapCases, remapRegions } from '../src/core/unit-map.js';
import { planUnitResults } from '../src/core/unit-results.js';
import { writeResultXlsx } from '../src/core/xlsx.js';
import { judgePage, judgeRequest } from '../src/engine/judge.js';
import { transcribeRequest, type RawResult, type StructuredProvider } from '../src/engine/provider.js';
import { loadRules, systemPrompt } from '../src/engine/rules.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';
import { emptyRow, keyToRows, rowsToKey, validateRows, type UnitRow } from '../src/renderer/lib/key-form.js';

// 가짜 정답표: 2번 문항의 2-1~2-3은 순서 무관 묶음, 2-4는 같은 문항의 자리 단위, 1-1은 묶음 밖 단위
const OF = { 유형: '빈칸형' as const, 순서무관: true as const };
const units = (): QtyUnit[] => [
  { id: '1-1', 문항: 1, 설명: '이름', 정답: '지연', 유형: '단답형' },
  { id: '2-1', 문항: 2, 설명: '과일 1', 정답: '사과', 허용: ['능금'], ...OF },
  { id: '2-2', 문항: 2, 설명: '과일 2', 정답: '배', ...OF },
  { id: '2-3', 문항: 2, 설명: '과일 3', 정답: '감', ...OF },
  { id: '2-4', 문항: 2, 설명: '계절', 정답: '가을', 유형: '빈칸형' },
];
const mk = (over: Partial<AnswerKey> = {}): AnswerKey => ({ 세트: '가짜', 글: '가짜 글', 학기: '2026 2학기', 대상: { 학년: 1, 반: [1] }, 정량: units(), 정성: [], ...over });
const key = mk();
/** 순서 무관 표시를 모두 뗀 같은 정답표(켜기 전) */
const plain = (k: AnswerKey): AnswerKey => ({ ...k, 정량: k.정량.map(({ 순서무관: _, ...u }) => u) });
const tr = (page: number, a: Record<string, [string, Panjeong]>, over: Partial<Transcript> = {}): Transcript => ({
  page, 학년: 1, 반: 1, 번호: page, 이름: null, 식별확신: '확실',
  정량: Object.fromEntries(Object.entries(a).map(([id, [답, 판정]]) => [id, { 답, 판정 }])), 정성: {}, 비고: [], ...over,
});
const verdicts = (d: Record<string, { 판정: Panjeong; 근거: string } | null>) => Object.fromEntries(Object.entries(d).map(([id, v]) => [id, v ? `${v.판정} ${v.근거}` : null]));
const NOW = new Date('2026-11-23T00:00:00.000Z');

test('keyProblems 순서무관: 정수 문항, 요소형·논술형 아님, 묶음은 둘 이상이고 배점이 같아야 한다', () => {
  assert.deepEqual(keyProblems(key), []);
  const bad = (정량: unknown[], re: RegExp) => assert.ok(keyProblems({ ...key, 정량 }).some(p => re.test(p)), JSON.stringify(정량));
  bad([{ id: '2-1', 정답: '사과', 순서무관: true }, { id: '2-2', 정답: '배', 순서무관: true }], /2-1: 순서 무관 단위는 문항 번호가 있어야/);
  bad([{ id: '3-1', 문항: 3, 설명: '', 정답: '집', 유형: '요소형', 순서무관: true }, { id: '3-2', 문항: 3, 설명: '', 정답: '학교', 유형: '요소형', 순서무관: true }], /3번 문항 3-1: 요소형 단위에는 순서 무관을/);
  bad([{ id: '3-1', 문항: 3, 설명: '', 정답: '집', 유형: '논술형', 종류: '용어', 순서무관: true }], /논술형 단위에는 순서 무관을/);
  bad([{ id: '2-1', 문항: 2, 설명: '', 정답: '사과', ...OF }, { id: '2-2', 문항: 2, 설명: '', 정답: '배' }], /2번 문항: 순서 무관 단위가 하나뿐입니다\(2-1\)/);
  bad([{ id: '2-1', 문항: 2, 설명: '', 정답: '사과', ...OF }, { id: '2-2', 문항: 2, 설명: '', 정답: '배', ...OF, 배점: 2 }], /2번 문항: 순서 무관 단위\(2-1, 2-2\)의 배점이 모두 같아야/);
  bad([{ id: '2-1', 문항: 2, 설명: '', 정답: '사과', 순서무관: 'yes' }], /2-1: 순서무관 값은 true여야/);
  // 배점을 적지 않은 단위(1점)와 1점으로 적은 단위는 같은 배점이다. 문항이 다르면 다른 묶음이다
  assert.deepEqual(keyProblems({ ...key, 정량: [...units(), { id: '3-1', 문항: 3, 설명: '', 정답: 'a', ...OF, 배점: 1 }, { id: '3-2', 문항: 3, 설명: '', 정답: 'b', ...OF }] }), []);
  assert.deepEqual(orderFreeGroup(key, '2-2').map(u => u.id), ['2-1', '2-2', '2-3']);
  assert.deepEqual(orderFreeGroup(key, '2-4'), []); // 같은 문항이라도 표시가 없으면 자리 단위
});

test('decidePage: 순서를 바꿔 쓴 답(B·C·A)은 모두 O, 허용도 어느 칸에서든 맞는다', () => {
  assert.deepEqual(verdicts(decidePage(key, { '2-1': '배', '2-2': '감', '2-3': '사과' })), { '2-1': 'O 정답', '2-2': 'O 정답', '2-3': 'O 정답' });
  assert.deepEqual(verdicts(decidePage(key, { '2-1': '감', '2-2': ' 능금. ', '2-3': '배' })), { '2-1': 'O 정답', '2-2': 'O 허용', '2-3': 'O 정답' });
});

test('decidePage: 일부 오답은 정하지 않고(뜻으로 볼 일), 빈 칸은 빈칸, 같은 정답을 두 번 쓰면 뒤 칸이 X(중복)', () => {
  assert.deepEqual(verdicts(decidePage(key, { '2-1': '배', '2-2': '귤', '2-3': '' })), { '2-1': 'O 정답', '2-2': null, '2-3': '빈칸 빈칸' });
  assert.deepEqual(verdicts(decidePage(key, { '2-1': '배', '2-2': '배', '2-3': '사과' })), { '2-1': 'O 정답', '2-2': 'X 중복', '2-3': 'O 정답' });
  // 정답과 허용이 같은 정답의 표기라 함께 쓰면 중복이다
  assert.deepEqual(verdicts(decidePage(key, { '2-1': '능금', '2-2': '사과', '2-3': '감' })), { '2-1': 'O 허용', '2-2': 'X 중복', '2-3': 'O 정답' });
});

test('decidePage: 정답이 같은 단위가 둘인 묶음은 그 답을 두 칸까지 O로 친다', () => {
  const k = mk({ 정량: [{ id: '3-1', 문항: 3, 설명: '', 정답: '가', ...OF }, { id: '3-2', 문항: 3, 설명: '', 정답: '가', ...OF }, { id: '3-3', 문항: 3, 설명: '', 정답: '나', ...OF }] });
  const v = (a: string, b: string, c: string) => Object.values(verdicts(decidePage(k, { '3-1': a, '3-2': b, '3-3': c })));
  assert.deepEqual(v('가', '나', '가'), ['O 정답', 'O 정답', 'O 정답']);
  assert.deepEqual(v('가', '가', '가'), ['O 정답', 'O 정답', 'X 중복']);
  assert.deepEqual(v('나', '나', '가'), ['O 정답', 'X 중복', 'O 정답']);
});

test('decidePage: 가장 많은 칸이 맞게 짝짓는다(앞 칸이 먼저 고른 정답 때문에 뒤 칸이 틀리지 않게), 같으면 앞 칸이 먼저', () => {
  // 'y'는 A의 허용이자 B의 정답, 'x'는 A만. 앞 칸이 A를 가져가면 뒤 칸이 남는 정답이 없다
  const k = mk({ 정량: [{ id: '3-1', 문항: 3, 설명: '', 정답: 'x', 허용: ['y'], ...OF }, { id: '3-2', 문항: 3, 설명: '', 정답: 'y', ...OF }] });
  assert.deepEqual(verdicts(decidePage(k, { '3-1': 'y', '3-2': 'x' })), { '3-1': 'O 정답', '3-2': 'O 정답' });
  assert.deepEqual(verdicts(decidePage(k, { '3-1': 'y', '3-2': 'y' })), { '3-1': 'O 허용', '3-2': 'O 정답' });
  assert.deepEqual(verdicts(decidePage(k, { '3-1': 'x', '3-2': 'x' })), { '3-1': 'O 정답', '3-2': 'X 중복' });
});

test('decidePage: 묶음과 자리 단위가 섞인 문항. 자리 단위는 제 정답만 보고 묶음의 정답을 쓰지 않는다', () => {
  assert.deepEqual(verdicts(decidePage(key, { '1-1': '지연', '2-1': '가을', '2-2': '배', '2-3': '감', '2-4': '사과' })),
    { '1-1': 'O 정답', '2-1': null, '2-2': 'O 정답', '2-3': 'O 정답', '2-4': null });
  assert.deepEqual(verdicts(decidePage(key, { '2-4': '가을', '2-1': '사과' })), { '2-1': 'O 정답', '2-4': 'O 정답' }); // 없는 단위는 결과에도 없다
  // decide도 같은 장의 다른 칸을 받아 묶음째 본다. 받지 않으면 그 칸 하나만 쓴 장으로 본다
  assert.deepEqual(decide(key, '2-2', '사과', { '2-1': '사과', '2-2': '귤' }), { 판정: 'X', 근거: '중복' });
  assert.deepEqual(decide(key, '2-2', '사과'), { 판정: 'O', 근거: '정답' });
  assert.deepEqual(decide(key, '2-4', '사과'), null);
});

test('rejudgeTranscript: 자리대로 판정했던 X를 O로, 묶음 밖 단위와 비고 형식은 그대로', () => {
  const t = tr(1, { '1-1': ['지연', 'O'], '2-1': ['배', 'X'], '2-2': ['감', 'X'], '2-3': ['사과', 'X'], '2-4': ['가을', 'O'] });
  const r = rejudgeTranscript(key, t);
  assert.deepEqual(r.changes.map(c => `${c.단위} ${c.이전}→${c.이후} ${c.근거}`), ['2-1 X→O 정답', '2-2 X→O 정답', '2-3 X→O 정답']);
  assert.deepEqual(r.transcript.비고, ['재판정: 2-1 X→O (정답), 2-2 X→O (정답), 2-3 X→O (정답)']);
  assert.deepEqual(rejudgeTranscript(plain(key), t).changes, []); // 켜기 전에는 자리대로라 바뀌지 않는다
  const dup = rejudgeTranscript(key, tr(2, { '2-1': ['배', 'O'], '2-2': ['배', 'O'], '2-3': ['', '빈칸'] }));
  assert.deepEqual(dup.changes.map(c => `${c.단위} ${c.이전}→${c.이후} ${c.근거}`), ['2-2 O→X 중복']); // 2-1은 이미 O
});

test('사례: 묶음의 어느 단위에 기록된 사례든 같은 답이면 따르고, 여러 개면 나중에 기록한 것', () => {
  const k = mk({ 사례: [{ 단위: '2-1', 답: '배즙', 판정: 'O', 일시: 'a', 출처: '검토' }, { 단위: '2-1', 답: '귤', 판정: 'X', 일시: 'a', 출처: '검토' }, { 단위: '2-2', 답: '귤', 판정: 'O', 일시: 'b', 출처: '검토' }] });
  assert.equal(findCase(k, '2-3', '배즙'), undefined);
  assert.equal(findCaseFor(k, '2-3', '배즙')?.판정, 'O');
  assert.equal(findCaseFor(k, '2-3', '귤')?.판정, 'O');
  assert.equal(findCaseFor(k, '2-4', '배즙'), undefined); // 자리 단위는 묶음의 사례를 보지 않는다
  assert.deepEqual(verdicts(decidePage(k, { '2-1': '사과', '2-2': '', '2-3': '배즙' })), { '2-1': 'O 정답', '2-2': '빈칸 빈칸', '2-3': 'O 사례' });
});

test('caseConflict: 묶음의 정답 전체로 본다(다른 칸의 정답·허용을 X로 기록하면 경고)', () => {
  assert.equal(caseConflict(key, { 단위: '2-1', 답: '감', 판정: 'X' }), '정답');
  assert.equal(caseConflict(key, { 단위: '2-3', 답: '능금', 판정: 'X' }), '허용');
  assert.equal(caseConflict(key, { 단위: '2-3', 답: '귤', 판정: 'X' }), null);
  assert.equal(caseConflict(key, { 단위: '2-4', 답: '감', 판정: 'X' }), null); // 자리 단위는 제 정답만
  assert.equal(caseConflict(plain(key), { 단위: '2-1', 답: '감', 판정: 'X' }), null);
});

test('사례 기록·되돌리기: 묶음의 다른 칸에 같은 답을 쓴 장도 바뀌고(확인 창에도 보이고), 되돌리면 그대로 돌아온다', () => {
  const ts = [
    tr(1, { '2-1': ['귤', 'X'], '2-2': ['배', 'O'], '2-3': ['감', 'O'], '2-4': ['귤', 'X'] }),
    tr(2, { '2-1': ['사과', 'O'], '2-2': ['배', 'O'], '2-3': ['귤', 'X'] }),
    tr(3, { '2-1': ['귤 ', 'X'], '2-2': ['', '빈칸'], '2-3': ['감', 'O'] }),
  ];
  const c = { 단위: '2-1', 답: '귤', 판정: 'O' as const };
  const [p] = previewCases(key, ts, [c], 1);
  assert.deepEqual(p!.바뀔장, [{ page: 2, 단위: '2-3', 이전: 'X', 이후: 'O' }, { page: 3, 단위: '2-1', 이전: 'X', 이후: 'O' }]); // 2-4(자리 단위)의 귤은 아니다
  const plan = planApplyCase(key, ts, { ...c, page: 1 }, NOW);
  assert.deepEqual(plan.변경.map(ch => `${ch.page} ${ch.단위}`), ['1 2-1', '2 2-3', '3 2-1']);
  const p2 = plan.쓸전사.find(t => t.page === 2)!;
  assert.equal(p2.정량['2-3']!.판정, 'O');
  assert.deepEqual(p2.비고, ['재판정: 2-3 X→O (사례)']);
  // 되돌리기 요청: 묶음의 다른 칸(2-3)의 변경은 정답표를 알아야 그 사례의 것으로 받는다
  const raw = { 사례: [c], 변경: plan.변경.filter(ch => ch.page !== 1) };
  assert.throws(() => caseRevertRequest(raw), /단위가 사례와 맞지 않습니다/);
  assert.throws(() => caseRevertRequest({ ...raw, 변경: [{ page: 1, 단위: '2-4', 이전: 'X', 이후: 'O' }] }, key), /단위가 사례와 맞지 않습니다/);
  const req = caseRevertRequest(raw, key);
  const after = ts.map(t => plan.쓸전사.find(x => x.page === t.page) ?? t);
  const back = planCaseRevert(plan.key, after, req);
  assert.equal(back.사례, 1); assert.equal(back.복원, 2); assert.equal(back.건너뜀, 0);
  assert.equal(back.key!.사례, undefined);
  for (const t of back.쓸전사) assert.deepEqual(t, ts.find(x => x.page === t.page));
});

test('planUnitResults: 묶음 칸의 글을 고치면 같은 장의 다른 칸과 함께 글자 판정한다(다른 칸의 판정은 그대로)', () => {
  const ts = [tr(1, { '2-1': ['사과', 'O'], '2-2': ['배', 'O'], '2-3': ['귤', 'X'] })];
  const edit = (답: string) => planUnitResults(key, ts, { 단위: '2-3', 항목: [{ page: 1, 답 }] }, NOW).쓸전사[0]!;
  assert.equal(edit('배').정량['2-3']!.판정, 'X'); // 2-2가 이미 쓴 정답
  assert.deepEqual(edit('배').확인단위, ['2-3']);
  assert.equal(edit('감').정량['2-3']!.판정, 'O');
  assert.equal(edit('사과').정량['2-1']!.판정, 'O');
  const r = planUnitResults(key, ts, { 단위: '2-3', 항목: [{ page: 1, 답: '단감' }] }, NOW);
  assert.equal(r.판정필요, 1); // 글자로 정해지지 않으면 선생님이 고른다
});

test('systemPrompt: 순서무관이 없으면 절이 붙지 않고, 있으면 묶음과 함께 절 하나가 붙는다(전사·모델 재판정 모두)', async () => {
  const rules = await loadRules();
  const without = systemPrompt(rules, plain(key));
  assert.ok(!without.includes('순서 무관') && !without.includes('순서무관'));
  const withIt = systemPrompt(rules, key);
  assert.equal(withIt.split('# 순서 무관 단위').length, 2);
  assert.ok(withIt.includes('이 세트의 묶음: 2번 문항(2-1, 2-2, 2-3).'));
  assert.ok(withIt.includes('answer는 전사 규칙대로 칸 자리대로 옮긴다'));
  assert.ok(withIt.includes('앞 칸만 "O"이고 뒤 칸은 "X"다'));
  // 붙는 것은 이 절과 정답표의 순서무관 표시뿐이다
  const section = withIt.slice(withIt.indexOf('# 순서 무관 단위'), withIt.indexOf('# 정답표'));
  assert.equal(withIt.replace(section, '').replace(/,\n {3}"순서무관": true/g, ''), without);
  assert.ok(judgeRequest(key, rules, tr(1, {})).system.includes('# 순서 무관 단위'));
  assert.ok(!judgeRequest(plain(key), rules, tr(1, {})).system.includes('# 순서 무관 단위'));
  const req = transcribeRequest({ imageJpegBase64: '', key, rules, page: 1, effort: 'high' });
  assert.ok(req.system.includes('# 순서 무관 단위'));
  assert.deepEqual(transcribeRequest({ imageJpegBase64: '', key, rules, page: 1, effort: 'high' }).schema, transcribeRequest({ imageJpegBase64: '', key: plain(key), rules, page: 1, effort: 'high' }).schema); // 출력 양식은 그대로
});

test('judgePage: 묶음의 글자 판정이 모델보다 먼저, 정하지 못한 칸만 모델 판정', async () => {
  const p: StructuredProvider = { id: 'api', async complete(): Promise<RawResult> {
    return { output: { quant: [{ id: '1-1', verdict: 'O' }, { id: '2-1', verdict: 'X' }, { id: '2-2', verdict: 'O' }, { id: '2-3', verdict: 'O' }, { id: '2-4', verdict: 'X' }] }, model: 'm' };
  } };
  const t = tr(1, { '1-1': ['지연', 'O'], '2-1': ['배', 'X'], '2-2': ['배', 'O'], '2-3': ['단감', 'X'], '2-4': ['가을', 'O'] });
  const r = await judgePage(p, key, await loadRules(), t, new AbortController().signal);
  assert.deepEqual(r.changes.map(c => `${c.단위} ${c.이전}→${c.이후} ${c.근거}`), ['2-1 X→O 정답', '2-2 O→X 중복', '2-3 X→O 모델']);
  assert.deepEqual(r.transcript.비고, ['모델 재판정: 2-1 X→O (정답), 2-2 O→X (중복), 2-3 X→O']);
});

test('문항 설정: 빈칸형 행의 순서 무관이 정답표로 가고, 다시 열기·내보내기/가져오기에서 유지된다', () => {
  const meta = { 글: '가짜 글', 학기: '2026 2학기', 학년: 1, 반: [1], 인원: {} };
  const row = (문항: number, 유형: UnitRow['유형'], 정답: string, more: Partial<UnitRow> = {}): UnitRow => ({ ...emptyRow(문항, 유형), 설명: 정답, 정답, ...more });
  const rows = [row(1, '단답형', '지연', { 순서무관: true }), row(2, '빈칸형', '사과', { 순서무관: true }), row(2, '빈칸형', '배', { 순서무관: true }), row(2, '빈칸형', '가을')];
  const k = rowsToKey(meta, rows);
  assert.deepEqual(k.정량.map(u => [u.id, u.순서무관 ?? null]), [['1-1', null], ['2-1', true], ['2-2', true], ['2-3', null]]); // 빈칸형이 아니면 넣지 않는다
  const back = keyToRows(parseKey(JSON.stringify(k))); // 저장한 파일·내보낸 파일을 다시 읽은 것
  assert.deepEqual(back.rows.map(r => r.순서무관 === true), [false, true, true, false]);
  assert.deepEqual(rowsToKey(back.meta, back.rows), k);
  assert.ok(!('순서무관' in keyToRows(plain(k)).rows[1]!)); // 끈 행은 칸을 두지 않는다(옛 행 모양 그대로)
  assert.deepEqual(validateRows(meta, rows), []);
  assert.ok(validateRows(meta, [row(2, '빈칸형', '사과', { 순서무관: true }), row(2, '빈칸형', '배')]).some(e => e.includes('2번 문항')));
  assert.ok(validateRows(meta, [row(2, '빈칸형', '사과', { 순서무관: true }), row(2, '빈칸형', '배', { 순서무관: true, 배점: '2' })]).some(e => e.includes('배점')));
});

test('단위 id 다시 매기기: 순서 무관을 켜거나 끄는 것만으로는 사례·답 칸이 떨어져 나가지 않는다', () => {
  const on = key, off = plain(key);
  for (const [a, b] of [[off, on], [on, off]] as const) {
    const map = mapUnits(a, b);
    assert.deepEqual([...map].filter(([id, to]) => id !== to), []);
    assert.deepEqual(changedUnitIds(a, b), []);
    const regions = remapRegions({ '2-1': { x: 0, y: 0, w: 0.1, h: 0.1 }, '2-3': { x: 0, y: 0.2, w: 0.1, h: 0.1 } }, map);
    assert.deepEqual([regions.옮김, regions.지움, Object.keys(regions.답영역 ?? {})], [0, 0, ['2-1', '2-3']]);
    const cases = remapCases([{ 단위: '2-2', 답: '배즙', 판정: 'O', 일시: 'a', 출처: 'b' }], undefined, map, b);
    assert.deepEqual([cases.옮김, cases.지움, cases.사례.length], [0, 0, 1]);
  }
});

test('답안지 PDF·점수: B·C·A로 쓴 장은 다시 판정 뒤 세 칸 모두 학생이 쓴 칸에 동그라미, 점수는 칸 배점 그대로', () => {
  const region = (y: number) => ({ x: 0.1, y, w: 0.2, h: 0.05 });
  const k = mk({ 답영역: { '2-1': region(0.2), '2-2': region(0.3), '2-3': region(0.4), '2-4': region(0.5) } });
  const t = rejudgeTranscript(k, tr(1, { '1-1': ['', '빈칸'], '2-1': ['배', 'X'], '2-2': ['감', 'X'], '2-3': ['사과', 'X'], '2-4': ['봄', 'X'] }, { 확인완료: true })).transcript;
  assert.deepEqual(unitMarks(k, t).map(m => [m.단위, m.표시, m.영역.y]), [['2-1', 'circle', 0.2], ['2-2', 'circle', 0.3], ['2-3', 'circle', 0.4], ['2-4', 'slash', 0.5]]);
  assert.equal(scoreOne(k, t).정량, 3);
});

test('채점결과 엑셀 문항 분석: 순서 무관 단위는 유형 칸에 표시만 하고 계산은 그대로', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-of-xlsx-'));
  try {
    const ts = [tr(1, { '1-1': ['지연', 'O'], '2-1': ['배', 'O'], '2-2': ['감', 'O'], '2-3': ['귤', 'X'], '2-4': ['가을', 'O'] })];
    const { rows, unmatched } = buildRows(key, null, ts);
    const out = path.join(dir, '채점결과.xlsx');
    await writeResultXlsx(key, rows, unmatched, out, { 채점일시: 'a', 프로그램버전: 't', 전사정보: '사람' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet('문항 분석')!;
    const line = (n: number) => Array.from({ length: 10 }, (_, i) => ws.getRow(n).getCell(i + 1).value ?? null);
    assert.deepEqual(line(1).slice(0, 3), ['단위 id', '문항', '유형']); // 열 구성은 그대로
    assert.deepEqual(line(2).slice(0, 3), ['1-1', 1, '단답형']);
    assert.deepEqual(line(3), ['2-1', 2, '빈칸형(순서 무관)', '과일 1', 1, 1, 1, 0, 0, 1]);
    assert.deepEqual(line(5).slice(0, 3), ['2-3', 2, '빈칸형(순서 무관)']);
    assert.deepEqual(line(6).slice(0, 3), ['2-4', 2, '빈칸형']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('세트에서: 순서 무관을 켜 저장하면 확인이 풀리고 사례·답 칸이 남으며, 다시 판정이 X를 O로 고치고 바뀐 단위의 확인을 푼다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-of-'));
  const set = path.join(dir, '세트');
  try {
    await mkdir(path.join(set, 'transcripts'), { recursive: true });
    await mkdir(path.join(set, 'pages'), { recursive: true });
    const old = { ...plain(key), 확인: { 완료: true }, 사례: [{ 단위: '2-2', 답: '배즙', 판정: 'O', 일시: 'a', 출처: '검토 p01' }], 답영역: { '2-1': { x: 0, y: 0.2, w: 0.2, h: 0.05 } } };
    await writeFile(path.join(set, '정답표.json'), JSON.stringify(old), 'utf-8');
    const pages = [
      tr(1, { '1-1': ['지연', 'O'], '2-1': ['배', 'X'], '2-2': ['사과', 'X'], '2-3': ['감', 'O'], '2-4': ['가을', 'O'] }, { 확인완료: true }),
      tr(2, { '1-1': ['지연', 'O'], '2-1': ['사과', 'O'], '2-2': ['배', 'O'], '2-3': ['감', 'O'], '2-4': ['가을', 'O'] }, { 확인완료: true }),
    ];
    for (const t of pages) {
      await writeFile(path.join(set, 'transcripts', `p0${t.page}.json`), JSON.stringify(t), 'utf-8');
      await writeFile(path.join(set, 'pages', `p0${t.page}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
    // 문항 설정 화면처럼 답 칸 없이 새로 조립한 정답표를 보낸다
    const { 답영역: _r, ...sent } = { ...key, 확인: { 완료: true }, 사례: old.사례 };
    const saved = await bridge.saveKey(set, sent);
    assert.equal(saved.key.확인?.완료, false); // 채점 내용이 바뀐 저장이라 확인을 지운다
    assert.deepEqual(saved.정리, { 사례: { 옮김: 0, 지움: 0 }, 답칸: { 옮김: 0, 지움: 0 } });
    const onDisk = JSON.parse(await readFile(path.join(set, '정답표.json'), 'utf-8'));
    assert.deepEqual(onDisk.정량.filter((u: QtyUnit) => u.순서무관).map((u: QtyUnit) => u.id), ['2-1', '2-2', '2-3']);
    assert.deepEqual(Object.keys(onDisk.답영역), ['2-1']);
    assert.equal(onDisk.사례.length, 1);
    const r = await bridge.rejudge(set);
    assert.deepEqual(r.바뀐장, [{ page: 1, 변경: ['2-1 X→O', '2-2 X→O'] }]);
    assert.deepEqual(r.다시확인, [1]);
    const p1 = (await loadSet(set)).transcripts.find(t => t.page === 1)!;
    assert.equal(p1.확인완료, false);
    assert.deepEqual([...p1.확인단위!].sort(), ['1-1', '2-3', '2-4']); // 바뀐 단위만 다시 본다
    assert.equal((await loadSet(set)).transcripts.find(t => t.page === 2)!.확인완료, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
