import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, scheduleChecks, startUpdater, statusText } from '../src/main/update.js';

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

test('startUpdater: 개발 실행이면 disabled/dev, 확인해도 GitHub에 가지 않는다', async () => {
  const seen: unknown[] = [];
  const u = startUpdater({ enabled: () => true, packaged: false, onStatus: s => seen.push(s), log: () => undefined });
  await u.check();
  assert.deepEqual(u.status(), { kind: 'disabled', reason: 'dev' });
  assert.deepEqual(seen, []);
  u.stop();
});
