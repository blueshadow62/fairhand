import test from 'node:test';
import assert from 'node:assert/strict';
import { advancedOpenAtStart, isSettingsTab, serialSaver, SETTINGS_TABS } from '../src/renderer/lib/settings-form.js';

const settle = () => new Promise(r => setImmediate(r)); // 밀린 약속(마이크로태스크)이 다 돈 뒤

/** 손으로 끝내는 가짜 저장: 시작할 때의 상태를 적어 두고, 끝내기(ok·fail)를 기다린다 */
function fakeSave(state: { v: number }) {
  const sent: number[] = [];
  const ends: { ok(): void; fail(e: Error): void }[] = [];
  const save = () => new Promise<void>((ok, fail) => { sent.push(state.v); ends.push({ ok, fail }); });
  return { sent, ends, save };
}

test('advancedOpenAtStart: 직접 고른 실행 파일·설정 폴더가 있을 때만 펼친다', () => {
  assert.equal(advancedOpenAtStart({}), false); // 기본(자동 찾기·기본 폴더)은 접힘
  assert.equal(advancedOpenAtStart({ cliPath: 'C:\\tools\\claude.exe' }), true);
  assert.equal(advancedOpenAtStart({ configDir: 'C:\\Users\\me\\.claude-max' }), true);
  assert.equal(advancedOpenAtStart({ cliPath: '/usr/local/bin/codex', configDir: '/home/me/.codex-work' }), true);
  assert.equal(advancedOpenAtStart({ cliPath: '  ', configDir: '' }), false); // 빈 글자는 고른 것으로 보지 않는다
});

test('serialSaver: 도는 중에 여러 번 청하면 끝난 뒤 한 번만, 그때의 최신 상태로', async () => {
  const state = { v: 1 };
  const f = fakeSave(state);
  const saver = serialSaver(f.save);
  const a = saver.run();
  await settle();
  state.v = 2; const b = saver.run();
  state.v = 3; const c = saver.run();
  assert.equal(b, c); // 밀린 청은 같은 저장을 기다린다
  assert.deepEqual(f.sent, [1]); // 앞 저장이 끝나기 전에는 겹쳐 돌지 않는다
  f.ends[0]!.ok(); await a; await settle();
  assert.deepEqual(f.sent, [1, 3]); // 밀린 둘은 한 번에, 마지막 상태로
  f.ends[1]!.ok(); await b;
  const d = saver.run(); await settle(); // 다 끝난 뒤의 청은 바로 돈다
  assert.deepEqual(f.sent, [1, 3, 3]);
  f.ends[2]!.ok(); await d;
});

test('serialSaver: 앞 저장이 실패해도 밀린 저장은 돌고, 실패는 그 저장을 청한 쪽만 받는다', async () => {
  const state = { v: 1 };
  const f = fakeSave(state);
  const saver = serialSaver(f.save);
  const a = saver.run();
  await settle();
  state.v = 2; const b = saver.run();
  f.ends[0]!.fail(new Error('디스크 오류'));
  await assert.rejects(a, /디스크 오류/);
  await settle();
  assert.deepEqual(f.sent, [1, 2]);
  f.ends[1]!.ok();
  await b;
});

test('serialSaver.idle: 돌거나 밀린 저장이 다 끝날 때까지 기다리고, 실패로 끊기지 않는다', async () => {
  const state = { v: 1 };
  const f = fakeSave(state);
  const saver = serialSaver(f.save);
  await saver.idle(); // 저장이 없으면 바로
  const a = saver.run().catch(() => undefined);
  await settle();
  const b = saver.run();
  let idle = false;
  const waiting = saver.idle().then(() => { idle = true; });
  f.ends[0]!.fail(new Error('실패')); await a; await settle();
  assert.equal(idle, false); // 밀린 저장이 아직 돈다
  f.ends[1]!.ok(); await b; await waiting;
  assert.equal(idle, true);
});

test('isSettingsTab: window 사건으로 온 탭 이름은 세 가지만 받는다', () => {
  assert.deepEqual([...SETTINGS_TABS], ['basic', 'ai', 'about']); // 화면에 놓이는 탭 순서
  for (const tab of SETTINGS_TABS) assert.equal(isSettingsTab(tab), true);
  for (const v of ['update', 'AI', '', null, undefined, 1, {}]) assert.equal(isSettingsTab(v), false);
});
