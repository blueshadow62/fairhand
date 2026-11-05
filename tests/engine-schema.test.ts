import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { transcriptSchema } from '../src/engine/schema.js';
import { loadRules, systemPrompt, userText } from '../src/engine/rules.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));

test('transcriptSchema: 모든 단위가 필수이고 추가 속성은 금지', () => {
  const s = transcriptSchema(key) as any;
  assert.deepEqual(s.required.sort(), ['page', '학년', '반', '번호', '이름', '식별확신', '정량', '정성', '비고'].sort());
  assert.deepEqual(Object.keys(s.properties.정량.properties), ['1-1', '3-1']);
  assert.deepEqual(s.properties.정량.required, ['1-1', '3-1']);
  assert.deepEqual(s.properties.정성.required, ['E1']);
  assert.deepEqual(s.properties.정량.properties['1-1'].properties.판정.enum, ['O', 'X', '빈칸']);
  assert.deepEqual(s.properties.식별확신.enum, ['확실', '추정', '불명']);
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
