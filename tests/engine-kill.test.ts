import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { SPAWN_DETACHED, killProcessTree } from '../src/engine/cli.js';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// AI 도구(자식)가 node 같은 손자 프로세스를 띄워도 '중단' 한 번에 모두 꺼져야 한다. 실제 프로세스로 확인한다
test('killProcessTree: 맥·리눅스에서 자식과 손자 프로세스를 함께 끈다', { skip: process.platform === 'win32' ? 'Windows는 taskkill /T로 끈다' : false }, async () => {
  assert.equal(SPAWN_DETACHED, true);
  const child = spawn('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { detached: SPAWN_DETACHED, stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = Number(await new Promise<string>(res => child.stdout!.once('data', d => res(String(d).trim()))));
  assert.ok(alive(grandchild), '손자 프로세스가 떠 있어야 시험이 된다');
  const exited = new Promise(res => child.once('exit', res));
  killProcessTree(child.pid!);
  await exited;
  for (let i = 0; i < 100 && alive(grandchild); i++) await new Promise(r => setTimeout(r, 20)); // 고아가 된 손자를 시스템이 거둘 때까지
  assert.equal(alive(grandchild), false);
});

test('SPAWN_DETACHED: Windows에서는 묶음 없이 띄운다(taskkill /T가 트리를 찾는다)', { skip: process.platform !== 'win32' }, () => {
  assert.equal(SPAWN_DETACHED, false);
});
