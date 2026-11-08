import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_IDENTITY_MASK, identityMask, keyProblems, maskRectArg, parseKey } from '../src/core/key.js';
import { DataError } from '../src/core/types.js';
import { loadRules, systemPrompt } from '../src/engine/rules.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const key = parseKey(readFileSync(path.join(FX, '정답표.json'), 'utf-8'));
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
const rect = { x: 0, y: 0.05, w: 1, h: 0.1 };

test('신원가림: 이름가림과 같은 규칙으로 검사하고, 없으면 쪽 위 15%', () => {
  assert.deepEqual(keyProblems({ ...key, 신원가림: rect }), []);
  for (const m of [{ ...rect, x: 0.5 }, { ...rect, h: 0 }, { ...rect, y: -0.1 }, { ...rect, w: '1' }, null])
    assert.ok(keyProblems({ ...key, 신원가림: m }).some(p => p.includes('신원가림')), JSON.stringify(m));
  assert.deepEqual(identityMask(key), { x: 0, y: 0, w: 1, h: 0.15 });
  assert.equal(identityMask(key), DEFAULT_IDENTITY_MASK);
  assert.deepEqual(identityMask({ ...key, 신원가림: rect }), rect);
  assert.ok(Object.isFrozen(DEFAULT_IDENTITY_MASK));
});

test('maskRectArg: 네 수만 꺼내고(다른 칸은 버림) null·undefined는 끄기, 모양이 틀리면 거절', () => {
  assert.deepEqual(maskRectArg({ ...rect, 덤: '<script>' }), rect);
  assert.equal(maskRectArg(null), null);
  assert.equal(maskRectArg(undefined), null);
  for (const bad of ['x', 1, { x: 0, y: 0, w: 1 }, { ...rect, h: '0.1' }]) assert.throws(() => maskRectArg(bad), DataError, JSON.stringify(bad));
});

test('신원가림은 AI 지시문에 들어가지 않는다(화면에 칠하는 데만 쓴다)', async () => {
  const p = systemPrompt(await loadRules(), { ...key, 신원가림: rect });
  assert.ok(!p.includes('신원가림') && !p.includes('0.05'));
  assert.equal(p, systemPrompt(await loadRules(), key));
});

test('setIdentityMask: 켜고 끄기, 쪽 밖은 거절, 전사 중에도 된다. 문항 설정 저장(saveKey)은 영역을 바꾸지 못한다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-identity-'));
  try {
    const set = path.join(dir, '세트A');
    await cp(FX, set, { recursive: true });
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
    (bridge as any).current = new AbortController(); // 전사가 도는 중
    await assert.rejects(bridge.setNameMask(set, rect), /실행 중/);
    const on = await bridge.setIdentityMask(set, rect);
    assert.deepEqual(on.신원가림, rect);
    assert.deepEqual(JSON.parse(await readFile(path.join(set, '정답표.json'), 'utf-8')).신원가림, rect);
    (bridge as any).current = null;
    const { 신원가림: _dropped, ...rebuilt } = on; // 문항 설정 화면이 조립한 정답표에는 이 칸이 없다
    assert.deepEqual((await bridge.saveKey(set, rebuilt)).key.신원가림, rect);
    assert.deepEqual((await bridge.saveKey(set, { ...on, 신원가림: { ...rect, h: 0.5 } })).key.신원가림, rect);
    await assert.rejects(bridge.setIdentityMask(set, { ...rect, y: 0.95 }), /신원가림/);
    assert.equal((await bridge.setIdentityMask(set, null)).신원가림, undefined);
    assert.equal((await bridge.saveKey(set, { ...rebuilt, 신원가림: rect })).key.신원가림, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
