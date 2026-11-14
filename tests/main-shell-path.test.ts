import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { askShellPath, commonDirs, fixPath, mergePath, parseShellPath } from '../src/main/shell-path.js';

test('parseShellPath: 셸 설정이 앞뒤에 찍은 글은 버리고 표시 사이만', () => {
  assert.equal(parseShellPath('Welcome!\n__GEULNUN_PATH__/opt/homebrew/bin:/usr/bin__GEULNUN_PATH__\n'), '/opt/homebrew/bin:/usr/bin');
  assert.equal(parseShellPath('no marks'), null);
  assert.equal(parseShellPath('__GEULNUN_PATH____GEULNUN_PATH__'), null);
});

test('mergePath: 앞쪽이 먼저, 같은 폴더는 한 번만, 빈 것은 버림', () => {
  assert.equal(mergePath(['/a:/b', '', '/b:/c', '/a']), '/a:/b:/c');
});

test('fixPath: 맥은 로그인 셸의 PATH를 앞에, 원래 PATH와 흔한 설치 위치를 뒤에 붙인다', async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const exec = (file: string, args: readonly string[], _o: unknown, cb: (e: Error | null, out: string) => void) => { calls.push({ file, args }); cb(null, '__GEULNUN_PATH__/Users/t/.nvm/bin:/usr/bin__GEULNUN_PATH__'); };
  const env: NodeJS.ProcessEnv = { HOME: '/Users/t', SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
  await fixPath(env, 'darwin', exec);
  assert.equal(calls[0]!.file, '/bin/zsh');
  assert.equal(calls[0]!.args[0], '-ilc');
  assert.ok(calls[0]!.args[1]!.includes('${PATH}'), '변수 이름이 뒤 표시와 붙지 않게 ${PATH}');
  assert.deepEqual(env.PATH!.split(':').slice(0, 3), ['/Users/t/.nvm/bin', '/usr/bin', '/bin']);
  for (const d of commonDirs('/Users/t')) assert.ok(env.PATH!.split(':').includes(d), d);
});

test('fixPath: 셸이 실패해도 흔한 설치 위치는 붙이고, Windows는 손대지 않는다', async () => {
  const fail = (_f: string, _a: readonly string[], _o: unknown, cb: (e: Error | null, out: string) => void) => cb(new Error('timeout'), '');
  const env: NodeJS.ProcessEnv = { HOME: '/home/t', PATH: '/usr/bin' };
  await fixPath(env, 'linux', fail);
  assert.ok(env.PATH!.startsWith('/usr/bin:'));
  assert.ok(env.PATH!.includes('/home/t/.local/bin'));
  const win: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' };
  await fixPath(win, 'win32', () => assert.fail('Windows에서는 셸을 부르지 않는다'));
  assert.equal(win.PATH, 'C:\\Windows');
});

test('askShellPath: fish는 문법이 달라 묻지 않는다', async () => {
  assert.equal(await askShellPath('/usr/local/bin/fish', 1000, () => assert.fail('fish는 부르지 않는다')), null);
});

test('askShellPath: 셸이 끝나지 않아도 정한 시간 뒤에는 기다리지 않는다', async () => {
  const t0 = Date.now();
  assert.equal(await askShellPath('/bin/zsh', 50, () => undefined), null); // 콜백을 영영 부르지 않는 셸
  assert.ok(Date.now() - t0 < 2000);
});

// 실제 셸 흉내: 대화형 셸처럼 SIGTERM을 무시하고, zsh 자동 완성 초기화처럼 입력을 기다린다
const POSIX = process.platform === 'win32' ? 'Windows에는 sh 셸이 없다' : false;
function fakeShell(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'geulnun-shell-'));
  const f = path.join(dir, 'fakesh');
  writeFileSync(f, `#!/bin/sh\ntrap '' TERM\n${body}\n`, { mode: 0o755 });
  return f;
}

test('askShellPath(실제 프로세스): 입력을 묻는 셸 설정이 있어도 멈추지 않는다', { skip: POSIX }, async () => {
  const sh = fakeShell('read answer\nprintf "__GEULNUN_PATH__/from/shell__GEULNUN_PATH__"');
  assert.equal(await askShellPath(sh, 3000), '/from/shell');
});

test('askShellPath(실제 프로세스): SIGTERM을 무시하고 멈춘 셸도 시간이 지나면 끈다', { skip: POSIX }, async () => {
  const sh = fakeShell('sleep 30');
  const t0 = Date.now();
  assert.equal(await askShellPath(sh, 300), null);
  assert.ok(Date.now() - t0 < 2000);
});
