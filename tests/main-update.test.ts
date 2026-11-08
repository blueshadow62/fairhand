import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { reduce, scheduleChecks, startUpdater, statusText } from '../src/main/update.js';

/** electron-updater 대신: 확인하면 9.9.9가 있다고 하고, 받으라고 하면 바로 다 받는다 */
class FakeUpdater extends EventEmitter {
  autoDownload = true; autoInstallOnAppQuit = true; logger: unknown = {};
  calls: string[] = [];
  async checkForUpdates() { this.calls.push('check'); this.emit('checking-for-update'); this.emit('update-available', { version: '9.9.9' }); return null; }
  async downloadUpdate() { this.calls.push('download'); this.emit('download-progress', { percent: 50 }); this.emit('update-downloaded', { version: '9.9.9' }); return []; }
  quitAndInstall(silent: boolean, runAfter: boolean) { this.calls.push(`install ${silent} ${runAfter}`); }
}
const winUpdater = (fake: FakeUpdater, busy = () => false, seen: string[] = []) =>
  startUpdater({ enabled: () => true, packaged: true, platform: 'win32', busy, loadUpdater: async () => fake as never, onStatus: s => seen.push(s.kind), log: () => undefined });

test('startUpdater: 확인은 새 버전이 있다고만 알리고, 내려받아 설치를 눌러야 받은 뒤 바로 설치한다', async () => {
  const fake = new FakeUpdater(); const seen: string[] = [];
  const u = winUpdater(fake, () => false, seen);
  try {
    await u.check();
    assert.equal(fake.autoDownload, false);
    assert.deepEqual(u.status(), { kind: 'available', version: '9.9.9' });
    await u.check(); // 이미 찾았으면 다시 묻지 않고, 받지도 않는다
    assert.deepEqual(fake.calls, ['check']);
    await u.download();
    assert.deepEqual(fake.calls, ['check', 'download', 'install true true']);
    assert.deepEqual(seen, ['checking', 'available', 'downloading', 'downloading', 'downloaded']); // 0%로 먼저 잠근 뒤 50%
  } finally { u.stop(); }
});

test('startUpdater: 전사 중에 다 받으면 설치를 미루고, 다시 시작해 적용을 눌러야 설치한다', async () => {
  const fake = new FakeUpdater();
  const u = winUpdater(fake, () => true);
  try {
    await u.download(); // 찾기 전에는 받지 않는다
    assert.deepEqual(fake.calls, []);
    await u.check(); await u.download();
    assert.deepEqual(u.status(), { kind: 'downloaded', version: '9.9.9' });
    assert.deepEqual(fake.calls, ['check', 'download']);
    u.install();
    assert.deepEqual(fake.calls, ['check', 'download', 'install true true']);
  } finally { u.stop(); }
});

test('reduce: 확인 → 있음 → 내려받기 → 받음, 오류는 조용한 상태, 끄면 disabled', () => {
  let s = reduce({ kind: 'idle' }, { type: 'check' }); assert.equal(s.kind, 'checking');
  s = reduce(s, { type: 'available', version: '0.3.0' }); assert.deepEqual(s, { kind: 'available', version: '0.3.0' });
  s = reduce(s, { type: 'progress', percent: 42.4 }); assert.deepEqual(s, { kind: 'downloading', percent: 42 });
  s = reduce(s, { type: 'downloaded', version: '0.3.0' }); assert.deepEqual(s, { kind: 'downloaded', version: '0.3.0' });
  for (const ev of [{ type: 'check' }, { type: 'none', version: '0.3.0' }, { type: 'available', version: '0.4.0' }, { type: 'on' }] as const)
    assert.deepEqual(reduce(s, ev), s, `받은 뒤 ${ev.type}에도 install 전까지 downloaded`);
  assert.deepEqual(reduce({ kind: 'checking' }, { type: 'error', message: 'x' }), { kind: 'error', message: 'x' });
  assert.deepEqual(reduce({ kind: 'idle' }, { type: 'off' }), { kind: 'disabled', reason: 'off' });
  assert.deepEqual(reduce({ kind: 'disabled', reason: 'off' }, { type: 'on' }), { kind: 'idle' });
  assert.deepEqual(reduce({ kind: 'disabled', reason: 'dev' }, { type: 'check' }), { kind: 'disabled', reason: 'dev' }); // 개발 실행은 변하지 않는다
});

test('statusText: 한국어·영어, 버전·퍼센트 포함', () => {
  assert.ok(statusText({ kind: 'downloaded', version: '0.3.0' }, 'ko').includes('0.3.0'));
  assert.ok(statusText({ kind: 'downloading', percent: 42 }, 'en').includes('42'));
  assert.ok(!/[가-힣]/.test(statusText({ kind: 'error', message: 'x' }, 'en')));
});

test('scheduleChecks: 처음 한 번 뒤 주기적으로, 멈추면 더 없음', () => {
  const calls: number[] = []; let t = 0;
  const timers: { at: number; fn: () => void; every?: number }[] = [];
  const fakeTimeout = ((fn: () => void, ms: number) => { timers.push({ at: t + ms, fn }); return 1; }) as any;
  const fakeInterval = ((fn: () => void, ms: number) => { timers.push({ at: t + ms, fn, every: ms }); return 2; }) as any;
  const stop = scheduleChecks(() => calls.push(t), { firstDelayMs: 10, intervalMs: 100, setTimeout: fakeTimeout, setInterval: fakeInterval, clearTimeout: () => undefined, clearInterval: () => undefined });
  const tick = (to: number) => { for (const x of timers) while (x.at <= to) { t = x.at; x.fn(); if (x.every) x.at += x.every; else x.at = Infinity; } };
  tick(250);
  assert.deepEqual(calls, [10, 100, 200]);
  stop();
});

test('startUpdater: 맥(서명 없는 시험판)은 disabled/manual, 확인·켜기로도 바뀌지 않고 GitHub에 가지 않는다', async () => {
  const seen: unknown[] = [];
  const u = startUpdater({ enabled: () => true, packaged: true, platform: 'darwin', onStatus: s => seen.push(s), log: () => undefined });
  await u.check(); u.setEnabled(true);
  assert.deepEqual(u.status(), { kind: 'disabled', reason: 'manual' });
  assert.deepEqual(seen, []);
  assert.deepEqual(reduce({ kind: 'disabled', reason: 'manual' }, { type: 'on' }), { kind: 'disabled', reason: 'manual' });
  assert.match(statusText({ kind: 'disabled', reason: 'manual' }, 'ko'), /맥 시험판/);
  u.stop();
});

test('startUpdater: 개발 실행이면 disabled/dev, 확인해도 GitHub에 가지 않는다', async () => {
  const seen: unknown[] = [];
  const u = startUpdater({ enabled: () => true, packaged: false, onStatus: s => seen.push(s), log: () => undefined });
  await u.check();
  assert.deepEqual(u.status(), { kind: 'disabled', reason: 'dev' });
  assert.deepEqual(seen, []);
  u.stop();
});
