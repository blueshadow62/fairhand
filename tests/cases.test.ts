import test from 'node:test';
import assert from 'node:assert/strict';
import { caseCandidates, caseEffects, caseNote, caseRequest, caseRevertRequest, needsCaseConfirm, planApplyCase, planCaseRevert, previewCases, revertTranscript } from '../src/core/cases.js';
import type { AnswerKey, Panjeong, Transcript } from '../src/core/types.js';

const key: AnswerKey = { 세트: 's', 글: 'g', 학기: 'h', 대상: { 학년: 1, 반: [1] },
  정량: [
    { id: '1-1', 문항: 1, 설명: '사람', 정답: '지연', 허용: ['지연이'], 유형: '단답형' },
    { id: '2-1', 문항: 2, 설명: '수', 정답: '3', 허용: ['세'], 유형: '빈칸형' },
    { id: '5-1', 문항: 5, 설명: '인용', 정답: '배움은 삶이다', 유형: '논술형', 종류: '인용' },
  ],
  정성: [{ id: 'E1', 문항: 6, 설명: '생각' }] };
const tr = (page: number, a: Record<string, [string, Panjeong]>, 비고: string[] = []): Transcript => ({
  page, 학년: 1, 반: 1, 번호: page, 이름: null, 식별확신: '확실',
  정량: Object.fromEntries(Object.entries(a).map(([id, [답, 판정]]) => [id, { 답, 판정 }])), 정성: { E1: { 응답: false, 답: '' } }, 비고 });
// p1·p2·p4는 1-1에 '지연'(p4는 '지연.'), p3은 '민수', p5는 1-1이 비었다
const ts = [
  tr(1, { '1-1': ['지연', 'O'], '2-1': ['3', 'O'] }), tr(2, { '1-1': ['지연', 'O'], '2-1': ['2', 'X'] }, ['메모']),
  tr(3, { '1-1': ['민수', 'X'], '2-1': ['세', 'O'] }), tr(4, { '1-1': ['지연.', 'X'], '2-1': ['', '빈칸'] }), tr(5, { '1-1': ['', 'X'], '2-1': ['3', 'O'] }),
];
const NOW = new Date('2026-11-08T00:00:00Z');

test('caseCandidates: O·X로 바뀐 단위만(답이 있을 때), 빈칸으로 바꾸거나 그대로인 것은 빼고, 새 장은 O·X인 단위 모두', () => {
  const after = tr(2, { '1-1': ['지연', 'X'], '2-1': ['2', '빈칸'], '5-1': ['', 'X'] });
  assert.deepEqual(caseCandidates(key, ts[1], after), [{ 단위: '1-1', 답: '지연', 판정: 'X' }]);
  assert.deepEqual(caseCandidates(key, ts[1], ts[1]!), []);
  assert.deepEqual(caseCandidates(key, undefined, ts[0]!), [{ 단위: '1-1', 답: '지연', 판정: 'O' }, { 단위: '2-1', 답: '3', 판정: 'O' }]);
});

test('caseEffects·previewCases: 같은 단위에 같은(정규화한) 답을 쓴 다른 장 중 판정이 다른 장만, 저장하는 장은 빼고', () => {
  assert.deepEqual(caseEffects(ts, { 단위: '1-1', 답: '지연', 판정: 'X' }, 1), [{ page: 2, 단위: '1-1', 이전: 'O', 이후: 'X' }]); // p4는 이미 X
  assert.deepEqual(caseEffects(ts, { 단위: '1-1', 답: ' 지연 ', 판정: 'O' }), [{ page: 4, 단위: '1-1', 이전: 'X', 이후: 'O' }]);
  assert.deepEqual(caseEffects(ts, { 단위: '1-1', 답: '민수', 판정: 'O' }, 3), []);
  const [p] = previewCases(key, ts, [{ 단위: '1-1', 답: '지연', 판정: 'X' }], 1);
  assert.deepEqual(p, { 단위: '1-1', 답: '지연', 판정: 'X', 바뀔장: [{ page: 2, 단위: '1-1', 이전: 'O', 이후: 'X' }], 경고: '정답', 논술형: false });
  assert.equal(needsCaseConfirm([p!]), true);
});

test('previewCases 경고: 정답·허용과 같은 답을 X로 기록할 때만(O는 경고 없음), 논술형은 정답 문장이 들어 있으면', () => {
  const one = (단위: string, 답: string, 판정: 'O' | 'X') => previewCases(key, [], [{ 단위, 답, 판정 }], 1)[0]!;
  assert.equal(one('1-1', '지연이.', 'X').경고, '허용');
  assert.equal(one('2-1', '3', 'X').경고, '정답');
  assert.equal(one('1-1', '지연', 'O').경고, null);
  assert.equal(one('1-1', '민수', 'X').경고, null);
  const essay = one('5-1', '그래서 배움은  삶이다 라고 했다', 'X');
  assert.deepEqual([essay.경고, essay.논술형], ['정답', true]);
  // 다른 장이 안 바뀌고 경고도 없으면 묻지 않는다(보통의 저장)
  assert.equal(needsCaseConfirm([one('1-1', '민수', 'X')]), false);
  assert.equal(needsCaseConfirm([one('1-1', '지연', 'X')]), true);
  assert.equal(needsCaseConfirm([]), false);
});

test('planApplyCase: 사례를 넣고 같은 답의 장만 바꾸며 비고 한 줄, 다른 단위·빈 답 장은 그대로, 바꿔 쓴 사례를 돌려준다', () => {
  const k = { ...key, 사례: [{ 단위: '1-1', 답: '지연', 판정: 'O' as const, 일시: 'a', 출처: '검토 p09' }] };
  const r = planApplyCase(k, ts, { 단위: '1-1', 답: '지연', 판정: 'X', page: 1 }, NOW);
  assert.deepEqual(r.key.사례, [{ 단위: '1-1', 답: '지연', 판정: 'X', 일시: NOW.toISOString(), 출처: '검토 p01' }]);
  assert.deepEqual(r.이전사례, k.사례[0]);
  assert.deepEqual(r.변경, [{ page: 1, 단위: '1-1', 이전: 'O', 이후: 'X' }, { page: 2, 단위: '1-1', 이전: 'O', 이후: 'X' }]);
  assert.deepEqual(r.쓸전사.map(t => t.page), [1, 2]);
  const p2 = r.쓸전사[1]!;
  assert.deepEqual(p2.정량, { '1-1': { 답: '지연', 판정: 'X' }, '2-1': { 답: '2', 판정: 'X' } });
  assert.deepEqual(p2.비고, ['메모', '재판정: 1-1 O→X (사례)']);
  assert.equal(caseNote(r.변경[1]!), '재판정: 1-1 O→X (사례)');
  assert.equal(planApplyCase(key, ts, { 단위: '1-1', 답: '민수', 판정: 'X', page: 3 }, NOW).이전사례, undefined);
  assert.throws(() => planApplyCase(key, ts, { 단위: 'E1', 답: '가', 판정: 'O', page: 1 }, NOW), /단위 E1/); // 정성 단위는 사례가 없다
});

test('planCaseRevert·revertTranscript: 기록 전과 똑같이 돌리고, 그사이 바뀐 판정·사례는 그대로 둔다', () => {
  const plan = planApplyCase(key, ts, { 단위: '1-1', 답: '지연', 판정: 'X', page: 1 }, NOW);
  const after = ts.map(t => plan.쓸전사.find(x => x.page === t.page) ?? t);
  const others = plan.변경.filter(c => c.page !== 1);
  const r = planCaseRevert(plan.key, after, { 사례: [{ 단위: '1-1', 답: '지연', 판정: 'X' }], 변경: others });
  assert.deepEqual([r.사례, r.복원, r.건너뜀], [1, 1, 0]);
  assert.deepEqual(r.key, key); // 사례가 없던 정답표면 사례 칸도 없앤다
  assert.deepEqual(r.쓸전사, [ts[1]]);
  // 되돌리기 전에 p02를 다시 O로 고쳤다면(다른 경로) 그 장은 건너뛴다. 사례가 그사이 O로 바뀌었으면 지우지 않는다
  const changed = after.map(t => (t.page === 2 ? { ...t, 정량: { ...t.정량, '1-1': { 답: '지연', 판정: 'O' as const } } } : t));
  const k2 = { ...plan.key, 사례: [{ ...plan.key.사례![0]!, 판정: 'O' as const }] };
  const r2 = planCaseRevert(k2, changed, { 사례: [{ 단위: '1-1', 답: '지연', 판정: 'X' }], 변경: others });
  assert.deepEqual([r2.key, r2.쓸전사, r2.사례, r2.복원, r2.건너뜀], [null, [], 0, 0, 1]);
  // 바꿔 쓴 사례는 되살린다. 전사가 없어진 장은 건너뛴다
  const prev = { 단위: '1-1', 답: '지연', 판정: 'O' as const, 일시: 'a', 출처: '검토 p09' };
  const r3 = planCaseRevert(plan.key, after.filter(t => t.page !== 2), { 사례: [{ 단위: '1-1', 답: '지연', 판정: 'X', 이전사례: prev }], 변경: others });
  assert.deepEqual(r3.key?.사례, [prev]);
  assert.deepEqual([r3.복원, r3.건너뜀], [0, 1]);
  assert.throws(() => planCaseRevert(key, ts, { 사례: [{ 단위: '9-9', 답: '가', 판정: 'X' }], 변경: [] }), /단위 9-9/);
  // revertTranscript: 비고 줄은 사례가 남긴 마지막 한 줄만 지운다
  const t2 = { ...ts[1]!, 정량: { ...ts[1]!.정량, '1-1': { 답: '지연', 판정: 'X' as const } }, 비고: ['재판정: 1-1 O→X (사례)', '메모', '재판정: 1-1 O→X (사례)'] };
  assert.deepEqual(revertTranscript(t2, others).transcript.비고, ['재판정: 1-1 O→X (사례)', '메모']);
  assert.equal(revertTranscript(t2, [{ page: 9, 단위: '1-1', 이전: 'O', 이후: 'X' }]).transcript, t2); // 다른 장의 변경은 무시
});

test('caseRequest·caseRevertRequest: 렌더러 값의 모양을 검사하고 다른 칸은 버린다', () => {
  assert.deepEqual(caseRequest({ 단위: '1-1', 답: '지연', 판정: 'X', page: 2, 덤: 1 }), { 단위: '1-1', 답: '지연', 판정: 'X', page: 2 });
  for (const bad of [null, [], { 단위: '1-1', 답: '지연', 판정: '빈칸', page: 1 }, { 단위: '1-1', 답: '', 판정: 'O', page: 1 }, { 단위: '', 답: 'a', 판정: 'O', page: 1 }, { 단위: '1-1', 답: 'a', 판정: 'O', page: 1.5 }])
    assert.throws(() => caseRequest(bad), Error, JSON.stringify(bad));
  const ok = { 사례: [{ 단위: '1-1', 답: '지연', 판정: 'X', 덤: 1, 이전사례: { 단위: '1-1', 답: '지연.', 판정: 'O', 일시: 'a', 출처: 'b', 덤: 2 } }], 변경: [{ page: 2, 단위: '1-1', 이전: 'O', 이후: 'X', 덤: 3 }] };
  assert.deepEqual(caseRevertRequest(ok), { 사례: [{ 단위: '1-1', 답: '지연', 판정: 'X', 이전사례: { 단위: '1-1', 답: '지연.', 판정: 'O', 일시: 'a', 출처: 'b' } }], 변경: [{ page: 2, 단위: '1-1', 이전: 'O', 이후: 'X' }] });
  assert.deepEqual(caseRevertRequest({ ...ok, 변경: [] }).변경, []);
  const c = ok.사례[0]!, ch = ok.변경[0]!;
  const bads: [unknown, RegExp][] = [
    [{ 사례: [], 변경: [] }, /사례 목록/],
    [{ 사례: [c], 변경: 'x' }, /판정 목록/],
    [{ 사례: [c, { ...c, 답: ' 지연 ' }], 변경: [] }, /두 번/],
    [{ 사례: [c], 변경: [{ ...ch, 단위: '2-1' }] }, /단위가 사례와 맞지/],
    [{ 사례: [c], 변경: [{ ...ch, 이후: 'O' }] }, /판정 값/], // 사례 판정(X)이 아닌 '이후'
    [{ 사례: [c], 변경: [{ ...ch, 이전: 'X' }] }, /판정 값/],
    [{ 사례: [c], 변경: [{ ...ch, 이전: '?' }] }, /판정 값/],
    [{ 사례: [c], 변경: [ch, { ...ch }] }, /두 번/],
    [{ 사례: [c], 변경: [{ ...ch, page: 0 }] }, /장 번호/],
    [{ 사례: [{ ...c, 이전사례: { ...c.이전사례, 답: '민수' } }], 변경: [] }, /이전 사례/],
    [{ 사례: [{ ...c, 이전사례: { ...c.이전사례, 단위: '2-1' } }], 변경: [] }, /이전 사례/],
    [{ 사례: [{ ...c, 이전사례: { ...c.이전사례, 일시: 1 } }], 변경: [] }, /이전 사례/],
  ];
  for (const [raw, re] of bads) assert.throws(() => caseRevertRequest(raw), re, JSON.stringify(raw));
});
