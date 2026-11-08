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
    // 다음 전사의 예상 시간에 쓸 기록: 기본 프로필(Claude Code, 노력 기본값)로 3장. 가짜 제공자는 토큰을 알려 주지 않는다
    const settings = new SettingsStore(path.join(dir, 'settings.json'));
    const rec = (await settings.load()).전사기록?.['cli||medium'];
    assert.deepEqual([rec?.장, rec?.토큰장], [3, 0]);
    assert.ok(rec!.초 >= 0);
    await bridge.tryPage(set, JPEG); // 시험 한 장도 같은 기록에 더한다
    assert.equal((await settings.load()).전사기록?.['cli||medium']?.장, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tryPage: 시험 한 장을 저장하지 않고 전사해 돌려준다(모델이 묻는 장 번호를 그대로 돌려줘도 통과)', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const keyPath = path.join(set, '정답표.json');
    const key = JSON.parse(await (await import('node:fs/promises')).readFile(keyPath, 'utf-8'));
    key.확인 = { 완료: true };
    await writeFile(keyPath, JSON.stringify(key), 'utf-8');
    const tr = await bridge.tryPage(set, JPEG);
    assert.deepEqual(Object.keys(tr.정량), ['1-1', '3-1']);
    await assert.rejects(readdir(path.join(set, 'transcripts'))); // 시험 결과는 저장하지 않는다
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('startRun·tryPage: 설정 답 위치 받기를 전사 요청에 넘긴다(끄면 위치 없이)', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const keyPath = path.join(set, '정답표.json');
    const key = JSON.parse(await (await import('node:fs/promises')).readFile(keyPath, 'utf-8'));
    key.확인 = { 완료: true };
    await writeFile(keyPath, JSON.stringify(key), 'utf-8');
    const asked: (boolean | undefined)[] = [];
    (bridge as any).provider = async () => ({ ...fakeProvider(), async transcribe(input: { page: number; 위치?: boolean }): Promise<RawResult> { asked.push(input.위치); return { output: out(input.page), model: 'fake' }; } });
    await bridge.tryPage(set, JPEG);
    const settings = new SettingsStore(path.join(dir, 'settings.json'));
    await settings.save({ 답위치: true });
    await bridge.tryPage(set, JPEG);
    await bridge.startRun(set, { pages: [1] }, () => undefined);
    assert.deepEqual(asked, [false, true, true]);
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

test('saveKey는 이름 가림을 바꾸지 못한다(문항 설정 저장으로 꺼져 이름이 나가지 않게), setNameMask로만 켜고 끈다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const rect = { x: 0.7, y: 0.05, w: 0.3, h: 0.05 };
    const on = await bridge.setNameMask(set, rect);
    assert.deepEqual(on.이름가림, rect);
    const { 이름가림: _dropped, ...rebuilt } = on; // 문항 설정 화면이 조립한 정답표에는 이 칸이 없다
    assert.deepEqual((await bridge.saveKey(set, rebuilt)).key.이름가림, rect);
    assert.deepEqual((await bridge.saveKey(set, { ...on, 이름가림: { ...rect, w: 0.1 } })).key.이름가림, rect);
    assert.equal((await bridge.setNameMask(set, null)).이름가림, undefined);
    assert.equal((await bridge.saveKey(set, { ...rebuilt, 이름가림: rect })).key.이름가림, undefined);
    await assert.rejects(bridge.setNameMask(set, { ...rect, x: 0.9 }), /이름가림/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
