import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { transcriptSchema, fromModelOutput } from '../src/engine/schema.js';
import { loadRules, systemPrompt, userText } from '../src/engine/rules.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));

test('transcriptSchema: 모든 단위가 필수이고 추가 속성은 금지', () => {
  const s = transcriptSchema(key) as any;
  assert.deepEqual(s.required.sort(), ['page', 'grade', 'class', 'number', 'name', 'id_confidence', 'quant', 'qual', 'notes'].sort());
  assert.deepEqual(Object.keys(s.properties.quant.properties), ['1-1', '3-1']);
  assert.deepEqual(s.properties.quant.required, ['1-1', '3-1']);
  assert.deepEqual(s.properties.qual.required, ['E1']);
  assert.deepEqual(s.properties.quant.properties['1-1'].properties.verdict.enum, ['O', 'X', '빈칸']);
  assert.deepEqual(s.properties.id_confidence.enum, ['확실', '추정', '불명']);
  const text = JSON.stringify(s);
  assert.ok(!text.includes('"additionalProperties":true'));
  assert.ok((text.match(/"additionalProperties":false/g) ?? []).length >= 5);
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

test('transcriptSchema: 속성 이름은 영문·숫자만(구조화 출력 제한), 한글 id는 거절', () => {
  const text = JSON.stringify(transcriptSchema(key));
  for (const k of text.matchAll(/"properties":\{([^}]*?)\}/g)) for (const name of k[1]!.matchAll(/"([^"]+)":\{/g)) assert.match(name[1]!, /^[a-zA-Z0-9_.-]{1,64}$/);
  const bad = { ...key, 정량: [{ ...key.정량[0]!, id: '문항1' }] };
  assert.throws(() => transcriptSchema(bad), /문항1/);
});

test('fromModelOutput: 영문 키 출력을 한글 전사 양식으로', () => {
  const out = fromModelOutput({ page: 1, grade: 3, class: 1, number: 2, name: null, id_confidence: '확실',
    quant: { '1-1': { answer: '은영', verdict: 'O' } }, qual: { E1: { responded: true, answer: '다리' } }, notes: ['x'] });
  assert.deepEqual(out, { page: 1, 학년: 3, 반: 1, 번호: 2, 이름: null, 식별확신: '확실',
    정량: { '1-1': { 답: '은영', 판정: 'O' } }, 정성: { E1: { 응답: true, 답: '다리' } }, 비고: ['x'] });
  assert.equal(fromModelOutput('글자'), '글자');
});
