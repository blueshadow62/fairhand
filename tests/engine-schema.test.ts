import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { transcriptSchema, fromModelOutput } from '../src/engine/schema.js';
import { loadRules, systemPrompt, userText } from '../src/engine/rules.js';
import { judgeRequest } from '../src/engine/judge.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));

test('transcriptSchema: 단위는 정답표 id만 고르는 목록이고 추가 속성은 금지', () => {
  const s = transcriptSchema(key) as any;
  assert.deepEqual(s.required.sort(), ['page', 'grade', 'class', 'number', 'name', 'id_confidence', 'quant', 'qual', 'notes'].sort());
  assert.equal(s.properties.quant.type, 'array');
  assert.deepEqual(s.properties.quant.items.properties.id.enum, ['1-1', '3-1']);
  assert.deepEqual(s.properties.quant.items.required, ['id', 'answer', 'verdict']);
  assert.deepEqual(s.properties.qual.items.properties.id.enum, ['E1']);
  assert.deepEqual(s.properties.qual.items.required, ['id', 'responded', 'answer']);
  assert.deepEqual(s.properties.quant.items.properties.verdict.enum, ['O', 'X', '빈칸']);
  assert.deepEqual(s.properties.id_confidence.enum, ['확실', '추정', '불명']);
  assert.ok(!JSON.stringify(s).includes('"additionalProperties":true'));
});

test('transcriptSchema: 단위가 늘어도 구조가 커지지 않는다(API 양식 크기 제한)', () => {
  const big = { ...key, 정량: Array.from({ length: 60 }, (_, i) => ({ ...key.정량[0]!, id: `1-${i + 1}` })) };
  const objects = (k: typeof key) => (JSON.stringify(transcriptSchema(k)).match(/"type":"object"/g) ?? []).length;
  assert.equal(objects(big), objects(key));
});

test('transcriptSchema: 확장 질문이 없는 세트도 빈 enum을 만들지 않는다', () => {
  const s = transcriptSchema({ ...key, 정성: [] }) as any;
  assert.deepEqual(s.properties.qual.items.properties.id, { type: 'string' });
});

test('loadRules: 버전과 본문을 읽는다', async () => {
  const r = await loadRules();
  assert.equal(r.버전, 'transcribe-v1');
  assert.ok(r.본문.includes('## 학생 식별'));
  await assert.rejects(loadRules('없는버전'), /없는버전/);
});

test('systemPrompt·userText: 규칙·정답표·쪽 번호가 들어간다', async () => {
  const r = await loadRules();
  const p = systemPrompt(r, key);
  assert.ok(p.startsWith(r.본문));
  assert.ok(p.includes('"id": "3-1"'));
  assert.ok(p.includes('핵심 낱말'));
  assert.equal(userText(7), '이 답안지 그림 한 장을 전사하라. page는 7이다.');
});

test('transcriptSchema: 한글 id는 정답표를 읽을 때 거절돼 스키마까지 오지 않는다', () => {
  assert.throws(() => parseKey(JSON.stringify({ ...key, 정량: [{ ...key.정량[0]!, id: '문항1' }] })), /문항1/);
});

test('fromModelOutput: 영문 키 출력을 한글 전사 양식으로', () => {
  const out = fromModelOutput({ page: 1, grade: 3, class: 1, number: 2, name: null, id_confidence: '확실',
    quant: [{ id: '1-1', answer: '은영', verdict: 'O' }], qual: [{ id: 'E1', responded: true, answer: '다리' }], notes: ['x'] });
  assert.deepEqual(out, { page: 1, 학년: 3, 반: 1, 번호: 2, 이름: null, 식별확신: '확실',
    정량: { '1-1': { 답: '은영', 판정: 'O' } }, 정성: { E1: { 응답: true, 답: '다리' } }, 비고: ['x'] });
  assert.equal(fromModelOutput('글자'), '글자');
});

test('systemPrompt: 대상 학년·반(·인원)을 알려 식별 범위를 좁힌다', async () => {
  const r = await loadRules();
  const p = systemPrompt(r, key);
  assert.ok(p.includes('# 대상') && p.includes(`${key.대상.학년}학년`) && p.includes('"추정"'));
  const withCount = systemPrompt(r, { ...key, 대상: { ...key.대상, 인원: { '1': 28 } } });
  assert.ok(withCount.includes('1반 28명(번호 1~28)'));
});

test('systemPrompt: 채점 규칙 절과 사례 절', async () => {
  const r = await loadRules();
  const p = systemPrompt(r, { ...key, 채점규칙: { 넓은말: '인정' }, 사례: [{ 단위: '1-1', 답: '은영이', 판정: 'X', 일시: 'x', 출처: 'p1' }] });
  assert.ok(p.includes('# 채점 규칙(이 세트)') && p.includes('넓') && p.includes('인정'));
  assert.ok(p.includes('# 판정 사례') && p.includes('- 1-1: "은영이" → X'));
  assert.ok(!p.includes('"사례"')); // 정답표 JSON 안에는 넣지 않는다
  assert.ok(!systemPrompt(r, key).includes('# 판정 사례'));
});

const essayUnits = [
  { id: '9-1', 문항: 9, 설명: '인용 1', 정답: '배움은 삶이다', 유형: '논술형' as const, 종류: '인용' as const },
  { id: '9-2', 문항: 9, 설명: '용어 1', 정답: '학습자 중심', 유형: '논술형' as const, 종류: '용어' as const },
  { id: '10-1', 문항: 10, 설명: '용어 1', 정답: '비계', 유형: '논술형' as const, 종류: '용어' as const },
];

test('transcriptSchema: 논술형 세트에만 essays(문항마다 글 전체)를 quant 앞에 둔다', () => {
  const plain = transcriptSchema(key) as any;
  assert.ok(!('essays' in plain.properties) && !plain.required.includes('essays'));
  const s = transcriptSchema({ ...key, 정량: [...key.정량, ...essayUnits] }) as any;
  // 글을 먼저 옮긴 뒤 단위마다 그 글에서 찾게 한다(구조화 출력은 양식의 칸 순서대로 낸다)
  assert.deepEqual(Object.keys(s.properties), ['page', 'grade', 'class', 'number', 'name', 'id_confidence', 'essays', 'quant', 'qual', 'notes']);
  assert.deepEqual(s.required, Object.keys(s.properties));
  assert.deepEqual(s.properties.essays.items.properties.question.enum, ['9', '10']); // 문항마다 한 번, 단위마다가 아니다
  assert.deepEqual(s.properties.essays.items.required, ['question', 'text']);
  assert.equal(s.properties.essays.items.additionalProperties, false);
  // 손으로 만든 정답표에서 문항 번호가 빠진 논술형 단위는 글 전체를 받지 않는다('undefined' 문항을 묻지 않게)
  const noNumber = { ...essayUnits[0]!, id: 'Z1', 문항: undefined as unknown as number };
  assert.deepEqual((transcriptSchema({ ...key, 정량: [...key.정량, noNumber, essayUnits[2]!] }) as any).properties.essays.items.properties.question.enum, ['10']);
  assert.ok(!('essays' in (transcriptSchema({ ...key, 정량: [...key.정량, noNumber] }) as any).properties));
});

test('fromModelOutput: essays는 문항 번호별 논술글로. 모양이 틀린 항목은 버리고 같은 문항은 앞의 것', () => {
  const base = { page: 1, grade: 3, class: 1, number: 2, name: null, id_confidence: '확실', quant: [], qual: [], notes: [] };
  const out = fromModelOutput({ ...base, essays: [{ question: '9', text: '첫 글\n둘째 문단' }, { question: '9', text: '또' }, { question: 10, text: 'x' }, { question: '11' }, '글자', { question: '10', text: '' }] }) as any;
  assert.deepEqual(out.논술글, { 9: '첫 글\n둘째 문단', 10: '' });
  assert.deepEqual((fromModelOutput({ ...base, essays: '글' }) as any).논술글, {});
  assert.ok(!('논술글' in (fromModelOutput(base) as any))); // 논술형이 없는 세트의 출력은 그대로
});

test('systemPrompt: 논술형 세트는 글 전체를 essays로 받고, 단위의 답은 그 글에서 글자 그대로 옮기게 한다', async () => {
  const r = await loadRules();
  const plain = systemPrompt(r, key);
  assert.ok(!plain.includes('essays'));
  const p = systemPrompt(r, { ...key, 정량: [...key.정량, ...essayUnits] });
  const section = p.slice(p.indexOf('# 논술형 문항'), p.indexOf('# 정답표'));
  assert.ok(section.includes('`essays`에는 논술형 문항마다 항목 하나 `{question, text}`를 한 번씩 넣는다'));
  assert.ok(section.includes('answer에는 그 글(essays의 text)에서 그 요소에 해당하는 부분(문장이나 구절)을 글자 그대로 옮긴다'));
  // 문항 번호가 없어 양식에 essays가 없으면 지시문도 0.2.11의 논술형 절 그대로
  const old = systemPrompt(r, { ...key, 정량: [...key.정량, { ...essayUnits[0]!, 문항: undefined as unknown as number }] });
  assert.ok(!old.includes('essays') && old.includes('- answer에는 학생 글에서 그 요소에 해당하는 부분(문장이나 구절)을 그대로 옮긴다.'));
});

test('transcriptSchema: 답 위치를 켜면 quant 항목에 y(수 또는 null)를 붙이고, 끄면 그대로', () => {
  const plain = transcriptSchema(key) as any;
  assert.deepEqual(transcriptSchema(key, { 위치: false }), plain);
  const s = transcriptSchema(key, { 위치: true }) as any;
  assert.deepEqual(s.properties.quant.items.properties.y, { type: ['number', 'null'] });
  assert.deepEqual(s.properties.quant.items.required, ['id', 'answer', 'verdict', 'y']);
  assert.ok(!('y' in s.properties.qual.items.properties)); // 정성은 위치를 받지 않는다
  const { quant: _q, ...rest } = s.properties, { quant: _p, ...plainRest } = plain.properties;
  assert.deepEqual(rest, plainRest);
});

test('fromModelOutput: y는 단위의 위치로(null도 그대로 넘겨 parseTranscript가 버린다)', () => {
  const out = fromModelOutput({ page: 1, grade: 3, class: 1, number: 2, name: null, id_confidence: '확실',
    quant: [{ id: '1-1', answer: '은영', verdict: 'O', y: 0.42 }, { id: '3-1', answer: '', verdict: '빈칸', y: null }], qual: [], notes: [] }) as any;
  assert.deepEqual(out.정량, { '1-1': { 답: '은영', 판정: 'O', 위치: 0.42 }, '3-1': { 답: '', 판정: '빈칸', 위치: null } });
});

test('systemPrompt: 답 위치 절은 켰을 때만 붙고(논술형 절 뒤, 정답표 앞) 모델 재판정 지시문에는 없다', async () => {
  const r = await loadRules();
  assert.equal(systemPrompt(r, key, { 위치: false }), systemPrompt(r, key));
  assert.ok(!systemPrompt(r, key).includes('# 답 위치'));
  const essayKey = { ...key, 정량: [...key.정량, ...essayUnits] };
  const p = systemPrompt(r, essayKey, { 위치: true });
  assert.ok(p.includes('quant의 항목마다 `y`에 그 단위의 답이 있는 세로 위치를 적는다'));
  assert.ok(p.indexOf('# 논술형 문항') < p.indexOf('# 답 위치') && p.indexOf('# 답 위치') < p.indexOf('# 정답표'));
  const t = { page: 1, 학년: 3, 반: 1, 번호: 1, 이름: null, 식별확신: '확실' as const, 정량: {}, 정성: {}, 비고: [] };
  assert.ok(!judgeRequest(essayKey, r, t).system.includes('# 답 위치'));
});
