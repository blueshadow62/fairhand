import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_ARGS_ENV, LOGIN_EXE_ENV, loginChildEnv, loginCommandLine, openLogin, windowsSystemDir } from '../src/main/launch.js';

test('loginCommandLine: 시스템 폴더의 PowerShell 전체 경로, 창이 남고, 명령은 상수(경로가 안 들어감)', () => {
  const line = loginCommandLine({ SystemRoot: 'C:\\Windows' });
  assert.ok(line.startsWith('start "" "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoExit -Command "'));
  assert.ok(line.includes(`$env:${LOGIN_EXE_ENV}`) && line.includes(`$env:${LOGIN_ARGS_ENV}`));
  assert.ok(!line.includes('auth login')); // 로그인 명령도 환경 변수로 넘겨 Claude Code·Codex가 같은 창을 쓴다
  assert.ok(!line.includes('C:\\Users'));
  assert.equal(windowsSystemDir({}), 'C:\\Windows\\System32');
});

test('loginChildEnv: 실행 파일과 prefixArgs를 환경 변수로, CLAUDE_CONFIG_DIR는 그대로 통과', () => {
  const e = loginChildEnv({ command: 'C:\\n\\node.exe', prefixArgs: ['C:\\cli.js'] }, { CLAUDE_CONFIG_DIR: 'C:\\u\\.claude-max', PATH: 'p' });
  assert.equal(e[LOGIN_EXE_ENV], 'C:\\n\\node.exe');
  assert.equal(e[LOGIN_ARGS_ENV], 'C:\\cli.js\nauth\nlogin');
  assert.equal(e.CLAUDE_CONFIG_DIR, 'C:\\u\\.claude-max');
  assert.equal(loginChildEnv({ command: 'c.exe', prefixArgs: [] }, {})[LOGIN_ARGS_ENV], 'auth\nlogin');
  assert.equal(loginChildEnv({ command: 'codex.exe', prefixArgs: [] }, {}, ['login'])[LOGIN_ARGS_ENV], 'login');
});

test('openLogin: Windows에서는 cmd.exe로 start를 띄우고, 다른 OS는 안내 문구', async () => {
  const calls: { cmd: string; args: string[]; opts: any }[] = [];
  const spawn = ((cmd: string, args: string[], opts: any) => { calls.push({ cmd, args, opts }); return { once: () => undefined, on: () => undefined, unref: () => undefined, pid: 1 } as any; }) as any;
  const r = await openLogin({ command: 'C:\\c.exe', prefixArgs: [] }, { SystemRoot: 'C:\\Windows' }, spawn, 'win32');
  assert.equal(r.ok, true);
  assert.equal(calls[0]!.opts.shell, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(calls[0]!.opts.env[LOGIN_EXE_ENV], 'C:\\c.exe');
  assert.equal(calls[0]!.opts.windowsHide, true);
  const r2 = await openLogin({ command: 'claude', prefixArgs: [] }, {}, spawn, 'darwin');
  assert.equal(r2.ok, false); assert.match(r2.message ?? '', /claude auth login/);
  const r3 = await openLogin({ command: 'codex', prefixArgs: [] }, {}, spawn, 'darwin', ['login']);
  assert.match(r3.message ?? '', /codex login/);
});
