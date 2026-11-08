import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SettingsStore } from '../src/main/settings.js';
import { SecretStore } from '../src/main/secrets.js';
import { loadSet } from '../src/core/setio.js';
import { DataError } from '../src/core/types.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
const NOW = () => new Date('2026-11-08T00:00:00Z');

// 픽스처: p01 1-1 '가나' O, 3-1 '열심히' X, E1 응답 / p02 1-1 '가나' O / p03 1-1 '' X, 3-1 '' 빈칸
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-unit-'));
  const set = path.join(dir, '세트A');
  await cp(FX, set, { recursive: true });
  await mkdir(path.join(set, 'pages'), { recursive: true });
  const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
  const page = async (n: number) => (await loadSet(set)).transcripts.find(t => t.page === n)!;
  const xlsx = async () => (await readdir(set)).filter(f => f.endsWith('.xlsx')).length;
  return { dir, set, bridge, page, xlsx };
}

test('setUnitResults: 묶음 판정을 그 단위·그 장에만 넣고, 사례를 기록하고, 엑셀을 한 번 만든다', async () => {
  const { dir, set, bridge, page, xlsx } = await setup();
  try {
    const r = await bridge.setUnitResults(set, { 단위: '1-1', 항목: [{ page: 1, 판정: 'X' }, { page: 2, 판정: 'X' }], 사례기록: true }, NOW);
    assert.equal(r.바뀐장수, 2); assert.equal(r.확인장수, 2); assert.equal(r.사례수, 1);
    assert.ok(r.엑셀 && !r.엑셀오류);
    assert.equal(await xlsx(), 1);
    const p1 = await page(1);
    assert.deepEqual(p1.정량['1-1'], { 답: '가나', 판정: 'X' });
    assert.deepEqual(p1.정량['3-1'], { 답: '열심히', 판정: 'X' }); // 다른 단위는 그대로
    assert.deepEqual(p1.확인단위, ['1-1']);
    assert.deepEqual(p1.비고, []); // 재판정 비고를 남기지 않는다
    assert.deepEqual((await page(3)).정량['1-1'], { 답: '', 판정: 'X' }); // 전체 재판정이면 빈칸으로 바뀌었을 장
    const { key } = await loadSet(set);
    assert.deepEqual(key.사례, [{ 단위: '1-1', 답: '가나', 판정: 'X', 일시: NOW().toISOString(), 출처: '문항별 검토' }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setUnitResults: 확인만 하면 판정·엑셀은 그대로, 모든 단위를 확인한 장은 확인 완료', async () => {
  const { dir, set, bridge, page, xlsx } = await setup();
  try {
    const r = await bridge.setUnitResults(set, { 단위: '3-1', 항목: [{ page: 1 }, { page: 3 }] }, NOW);
    assert.deepEqual(r, { 바뀐장수: 0, 확인장수: 2, 사례수: 0 });
    assert.equal(await xlsx(), 0);
    for (const 단위 of ['1-1', 'E1']) await bridge.setUnitResults(set, { 단위, 항목: [{ page: 1 }] }, NOW);
    const p1 = await page(1);
    assert.equal(p1.확인완료, true);
    assert.deepEqual(p1.정량['3-1'], { 답: '열심히', 판정: 'X' });
    assert.notEqual((await page(3)).확인완료, true);
    const again = await bridge.setUnitResults(set, { 단위: 'E1', 항목: [{ page: 1, 응답: true }] }, NOW);
    assert.deepEqual(again, { 바뀐장수: 0, 확인장수: 0, 사례수: 0 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setUnitResults: 잘못된 요청은 아무것도 쓰지 않고 거절', async () => {
  const { dir, set, bridge, page } = await setup();
  try {
    const before = JSON.stringify((await loadSet(set)).transcripts);
    for (const bad of [{ 단위: '1-1', 항목: [{ page: 1, 판정: 'O' }, { page: 9, 판정: 'O' }] }, { 단위: '9-9', 항목: [{ page: 1 }] }, { 단위: 'E1', 항목: [{ page: 1, 판정: 'O' }] }, '1-1', { 단위: '1-1', 항목: [{ page: -1 }] }])
      await assert.rejects(bridge.setUnitResults(set, bad, NOW), DataError, JSON.stringify(bad));
    assert.equal(JSON.stringify((await loadSet(set)).transcripts), before);
    assert.equal((await page(1)).확인단위, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
