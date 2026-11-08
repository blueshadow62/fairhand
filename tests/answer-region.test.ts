import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keptRegions, keyProblems, parseKey } from '../src/core/key.js';
import { DataError } from '../src/core/types.js';
import { loadRules, systemPrompt } from '../src/engine/rules.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const key = parseKey(readFileSync(path.join(FX, '정답표.json'), 'utf-8')); // 정량 1-1·3-1, 정성 E1
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
const r1 = { x: 0.1, y: 0.2, w: 0.8, h: 0.05 }, rE = { x: 0.1, y: 0.6, w: 0.8, h: 0.1 };

test('답영역: 단위 id → 이름가림과 같은 사각형 규칙, 정답표에 없는 단위는 거절', () => {
  assert.deepEqual(keyProblems({ ...key, 답영역: { '1-1': r1, E1: rE } }), []);
  for (const bad of [[], 'x', null]) assert.ok(keyProblems({ ...key, 답영역: bad }).some(p => p.includes('답영역')), JSON.stringify(bad));
  assert.ok(keyProblems({ ...key, 답영역: { '9-9': r1 } }).some(p => p.includes('9-9')));
  for (const m of [{ ...r1, x: 0.5 }, { ...r1, h: 0 }, { ...r1, y: '0.2' }, null])
    assert.ok(keyProblems({ ...key, 답영역: { '1-1': m } }).some(p => p.includes('답영역 1-1')), JSON.stringify(m));
});

test('keptRegions: 정답표에 남은 단위의 영역만, 남는 것이 없으면 undefined', () => {
  const regions = { '1-1': r1, '3-1': r1, E1: rE };
  assert.deepEqual(keptRegions(regions, { 정량: key.정량.filter(u => u.id !== '3-1'), 정성: key.정성 }), { '1-1': r1, E1: rE });
  assert.equal(keptRegions(regions, { 정량: [], 정성: [] }), undefined);
  assert.equal(keptRegions(undefined, key), undefined);
});

test('답영역은 AI 지시문에 들어가지 않는다', async () => {
  const rules = await loadRules();
  assert.equal(systemPrompt(rules, { ...key, 답영역: { '1-1': r1 } }), systemPrompt(rules, key));
});

test('setAnswerRegion: 단위마다 켜고 지우기, 전사 중에도 된다. 없는 단위·쪽 밖·글자 아닌 단위는 거절', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-region-'));
  try {
    const set = path.join(dir, '세트A');
    await cp(FX, set, { recursive: true });
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
    (bridge as any).current = new AbortController(); // 전사가 도는 중
    assert.deepEqual((await bridge.setAnswerRegion(set, '1-1', r1)).답영역, { '1-1': r1 });
    assert.deepEqual((await bridge.setAnswerRegion(set, 'E1', rE)).답영역, { '1-1': r1, E1: rE });
    assert.deepEqual((await bridge.setAnswerRegion(set, '1-1', null)).답영역, { E1: rE });
    assert.equal((await bridge.setAnswerRegion(set, 'E1', null)).답영역, undefined); // 다 지우면 칸을 두지 않는다
    assert.ok(!('답영역' in JSON.parse(await readFile(path.join(set, '정답표.json'), 'utf-8'))));
    await assert.rejects(bridge.setAnswerRegion(set, '9-9', r1), /9-9/);
    await assert.rejects(bridge.setAnswerRegion(set, 7, r1), DataError);
    await assert.rejects(bridge.setAnswerRegion(set, '1-1', { ...r1, y: 0.99 }), /답영역 1-1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveKey: 문항 설정 저장은 답영역을 되살리고(확인 표시도 그대로), 지운 단위의 영역은 버린다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-region-'));
  try {
    const set = path.join(dir, '세트A');
    await cp(FX, set, { recursive: true });
    const keyPath = path.join(set, '정답표.json');
    await writeFile(keyPath, JSON.stringify({ ...key, 확인: { 완료: true } }), 'utf-8');
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
    await bridge.setAnswerRegion(set, '1-1', r1);
    await bridge.setAnswerRegion(set, '3-1', r1);
    const screen = { ...key, 확인: { 완료: true } }; // 문항 설정 화면이 조립한 정답표(답영역 칸 없음)
    const saved = await bridge.saveKey(set, screen);
    assert.deepEqual(saved.답영역, { '1-1': r1, '3-1': r1 });
    assert.equal(saved.확인?.완료, true); // 최상위 칸이라 채점 내용 비교에 들지 않는다
    assert.deepEqual((await bridge.saveKey(set, { ...screen, 답영역: { '1-1': rE } })).답영역?.['1-1'], r1); // 화면이 보낸 값은 받지 않는다
    const fewer = await bridge.saveKey(set, { ...screen, 정량: key.정량.filter(u => u.id !== '3-1') });
    assert.deepEqual(fewer.답영역, { '1-1': r1 });
    assert.deepEqual(JSON.parse(await readFile(keyPath, 'utf-8')).답영역, { '1-1': r1 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
