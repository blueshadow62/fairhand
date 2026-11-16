import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTALL_CMD_ENV, INSTALL_DONE_ENV, LOGIN_ARGS_ENV, LOGIN_EXE_ENV, installChildEnv, installCommandLine, loginChildEnv, loginCommandLine, macInstallScript, macLoginScript, openInstall, openLogin, shQuote, windowsSystemDir } from '../src/main/launch.js';
import { INSTALL_COMMANDS } from '../src/shared/ipc.js';

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
  const r2 = await openLogin({ command: 'claude', prefixArgs: [] }, {}, spawn, 'linux');
  assert.equal(r2.ok, false); assert.match(r2.message ?? '', /claude auth login/);
  const r3 = await openLogin({ command: 'codex', prefixArgs: [] }, {}, spawn, 'linux', ['login']);
  assert.match(r3.message ?? '', /codex login/);
});

test('openLogin(맥): 로그인 스크립트(.command)를 만들어 터미널로 연다', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = ((cmd: string, args: string[]) => { calls.push({ cmd, args }); return { unref: () => undefined } as any; }) as any;
  const written: { file: string; text: string }[] = [];
  const r = await openLogin({ command: '/Users/t/.local/bin/claude', prefixArgs: [] }, { CLAUDE_CONFIG_DIR: '/Users/t/.claude-max' }, spawn, 'darwin', undefined,
    async (file, text) => { written.push({ file, text }); });
  assert.equal(r.ok, true);
  assert.match(written[0]!.file, /geulnun-login-\d+\.command$/);
  assert.deepEqual(calls[0], { cmd: 'open', args: ['-a', 'Terminal', written[0]!.file] });
  assert.match(written[0]!.text, /'\/Users\/t\/\.local\/bin\/claude' 'auth' 'login'\n$/);
  const failed = await openLogin({ command: 'c', prefixArgs: [] }, {}, spawn, 'darwin', undefined, async () => { throw new Error('디스크 가득'); });
  assert.equal(failed.ok, false); assert.match(failed.message ?? '', /디스크 가득/);
});

test('macLoginScript: 스스로 지우고, API 키 변수는 지우고, 로그인 폴더는 넣고, 경로는 셸 인용', () => {
  const s = macLoginScript({ command: "/Users/o'neil/My Apps/codex", prefixArgs: [] }, { CODEX_HOME: '/Users/t/.codex b', CLAUDE_CONFIG_DIR: undefined }, ['login']);
  const lines = s.trimEnd().split('\n');
  assert.equal(lines[0], '#!/bin/sh');
  assert.equal(lines[1], 'rm -f "$0"');
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) assert.ok(lines[2]!.split(' ').includes(k), k);
  assert.ok(lines.includes("export CODEX_HOME='/Users/t/.codex b'"));
  assert.ok(!s.includes('CLAUDE_CONFIG_DIR='));
  assert.equal(lines.at(-1), `'/Users/o'\\''neil/My Apps/codex' 'login'`);
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
});

test('installCommandLine: PowerShell 창을 남기고, 명령·URL은 명령줄에 넣지 않는다', () => {
  const line = installCommandLine({ SystemRoot: 'C:\\Windows' });
  assert.ok(line.startsWith('start "" "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoExit -ExecutionPolicy Bypass -Command "'));
  assert.ok(line.includes(`$env:${INSTALL_CMD_ENV}`) && line.includes(`$env:${INSTALL_DONE_ENV}`));
  assert.ok(!line.includes('https://'));
  assert.equal((line.match(/"/g) ?? []).length, 6); // start의 제목·실행 파일·명령 세 쌍. 명령 안에 큰따옴표가 있으면 cmd가 잘못 나눈다
});

test('installChildEnv: 공식 명령을 넘기고, 프로필의 로그인 폴더는 지운다(설치는 기본 위치로)', () => {
  const e = installChildEnv('codex', { CODEX_HOME: 'C:\\u\\.codex-b', CLAUDE_CONFIG_DIR: 'C:\\u\\.claude-max', PATH: 'p' });
  assert.equal(e[INSTALL_CMD_ENV], 'irm https://chatgpt.com/codex/install.ps1 | iex');
  assert.match(e[INSTALL_DONE_ENV] ?? '', /다시 확인/);
  assert.equal(e.CODEX_HOME, undefined); assert.equal(e.CLAUDE_CONFIG_DIR, undefined); assert.equal(e.PATH, 'p');
  assert.equal(installChildEnv('claude', {})[INSTALL_CMD_ENV], 'irm https://claude.ai/install.ps1 | iex');
});

test('openInstall: Windows는 cmd.exe로 start, 맥은 .command를 터미널로, 리눅스는 직접 실행할 명령을 알린다', async () => {
  const calls: { cmd: string; args: string[]; opts: any }[] = [];
  const spawn = ((cmd: string, args: string[], opts: any) => { calls.push({ cmd, args, opts }); return { unref: () => undefined } as any; }) as any;
  const r = await openInstall('claude', { SystemRoot: 'C:\\Windows', CLAUDE_CONFIG_DIR: 'C:\\x' }, spawn, 'win32');
  assert.equal(r.ok, true);
  assert.equal(calls[0]!.opts.shell, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(calls[0]!.opts.env[INSTALL_CMD_ENV], INSTALL_COMMANDS.claude.win);
  assert.equal(calls[0]!.opts.env.CLAUDE_CONFIG_DIR, undefined);
  const written: { file: string; text: string }[] = [];
  const m = await openInstall('codex', {}, spawn, 'darwin', async (file, text) => { written.push({ file, text }); });
  assert.equal(m.ok, true);
  assert.match(written[0]!.file, /geulnun-install-\d+\.command$/);
  assert.deepEqual(calls[1]!.args, ['-a', 'Terminal', written[0]!.file]);
  const l = await openInstall('codex', {}, spawn, 'linux');
  assert.equal(l.ok, false); assert.ok(l.message?.includes(INSTALL_COMMANDS.codex.unix));
});

test('macInstallScript: 스스로 지우고, 로그인 폴더 변수를 지운 뒤 공식 명령을 그대로 돌린다', () => {
  const lines = macInstallScript('claude').trimEnd().split('\n');
  assert.equal(lines[0], '#!/bin/sh'); assert.equal(lines[1], 'rm -f "$0"');
  assert.ok(lines[2]!.split(' ').includes('CODEX_HOME') && lines[2]!.split(' ').includes('CLAUDE_CONFIG_DIR'));
  assert.ok(lines.includes('curl -fsSL https://claude.ai/install.sh | bash'));
});
