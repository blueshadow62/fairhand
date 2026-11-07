import test from 'node:test';
import assert from 'node:assert/strict';
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
