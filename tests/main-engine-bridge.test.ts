import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SettingsStore } from '../src/main/settings.js';
import { SecretStore } from '../src/main/secrets.js';
import type { RawResult, StructuredRequest, TranscribeProvider } from '../src/engine/provider.js';
import { DataError } from '../src/core/types.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const out = (page: number) => ({ page, grade: 3, class: 1, number: page, name: null, id_confidence: '확실', quant: [{ id: '1-1', answer: 'x', verdict: 'X' }, { id: '3-1', answer: '', verdict: '빈칸' }], qual: [{ id: 'E1', responded: false, answer: '' }], notes: [] });
const fakeProvider = (): TranscribeProvider => ({
  id: 'api',
  async complete(req: StructuredRequest): Promise<RawResult> { const page = Number(/page는 (\d+)/.exec(req.user)?.[1]); return { output: out(page), model: 'fake' }; },
  async transcribe(input): Promise<RawResult> { return { output: out(input.page), model: 'fake' }; },
});
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-bridge-'));
  const set = path.join(dir, '세트A');
  await cp(FX, set, { recursive: true });
  await rm(path.join(set, 'transcripts'), { recursive: true, force: true });
  await (await import('node:fs/promises')).mkdir(path.join(set, 'pages'), { recursive: true });
  for (const p of [1, 2, 3]) await writeFile(path.join(set, 'pages', `p0${p}.jpg`), JPEG);
  const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
  (bridge as any).provider = async () => fakeProvider(); // 실제 CLI/API 대신
  return { dir, set, bridge };
}

test('startRun: 확인 안 된 정답표는 거절', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const keyPath = path.join(set, '정답표.json');
    const key = JSON.parse(await (await import('node:fs/promises')).readFile(keyPath, 'utf-8'));
    delete key.확인;
    await writeFile(keyPath, JSON.stringify(key), 'utf-8');
    await assert.rejects(bridge.startRun(set, {}, () => undefined), (e: unknown) => e instanceof DataError && /확인/.test(e.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('startRun: 장마다 진행을 알리고 전사를 저장하며, 두 번 동시에는 거절', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const keyPath = path.join(set, '정답표.json');
    const key = JSON.parse(await (await import('node:fs/promises')).readFile(keyPath, 'utf-8'));
    key.확인 = { 완료: true, 일시: '2026-11-06' };
    await writeFile(keyPath, JSON.stringify(key), 'utf-8');
    const seen: number[] = [];
    const running = bridge.startRun(set, {}, e => seen.push(e.page));
    await assert.rejects(bridge.startRun(set, {}, () => undefined), /이미 실행 중/);
    const r = await running;
    assert.deepEqual(r.ok, [1, 2, 3]); assert.deepEqual(seen, [1, 2, 3]);
    assert.equal((await readdir(path.join(set, 'transcripts'))).length, 3);
    assert.ok(r.엑셀);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cancel: 중단하면 끝낸 장은 남고 나머지는 멈춘다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const keyPath = path.join(set, '정답표.json');
    const key = JSON.parse(await (await import('node:fs/promises')).readFile(keyPath, 'utf-8'));
    key.확인 = { 완료: true };
    await writeFile(keyPath, JSON.stringify(key), 'utf-8');
    const slow: TranscribeProvider = { ...fakeProvider(), async transcribe(input, signal) { await new Promise<void>((res, rej) => { const t = setTimeout(res, 30); signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('abort')); }); }); return { output: out(input.page), model: 'fake' }; } };
    (bridge as any).provider = async () => slow;
    const running = bridge.startRun(set, {}, e => { if (e.page === 1) bridge.cancel(); });
    const r = await running;
    assert.deepEqual(r.ok, [1]);
    assert.equal(bridge.running(), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
