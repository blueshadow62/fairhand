import { spawn as nodeSpawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CODEX_STRIPPED_ENV_VARS } from '../engine/codex.js';
import { STRIPPED_ENV_VARS } from '../engine/env.js';
import type { ClaudeProgram } from '../engine/status.js';
import { INSTALL_COMMANDS, type InstallKind } from '../shared/ipc.js';

export const LOGIN_EXE_ENV = 'GEULNUN_LOGIN_EXE';
export const LOGIN_ARGS_ENV = 'GEULNUN_LOGIN_ARGS';

/**
 * 로그인 창(이음오피스 subscription/launch.ts 방식). Node는 Windows에서 자식에게 콘솔 창을 줄 수 없어
 * cmd의 `start`로 PowerShell 창을 띄우고, 그 안에서 CLI의 로그인 명령(Claude Code는 `auth login`, Codex는 `login`)을 돌린다.
 * 실행 파일·인수는 환경 변수로 넘겨 명령줄에 경로(인용 문제)가 들어가지 않게 한다. 인수는 줄바꿈([char]10)으로 나눈다.
 */
const LOGIN_SCRIPT = [
  `$exe = $env:${LOGIN_EXE_ENV}`,
  `$pre = if ($env:${LOGIN_ARGS_ENV}) { $env:${LOGIN_ARGS_ENV} -split [char]10 } else { @() }`,
  `Remove-Item Env:${LOGIN_EXE_ENV}, Env:${LOGIN_ARGS_ENV}`,
  `& $exe @pre`,
].join('; ');
export const CLAUDE_LOGIN_ARGS: readonly string[] = ['auth', 'login'];

const W = path.win32; // Windows 전용 경로라 어느 운영체제에서 검사해도 같은 결과가 나오게
export const windowsSystemDir = (env: NodeJS.ProcessEnv): string => W.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32');

export function loginCommandLine(env: NodeJS.ProcessEnv): string {
  const ps = W.join(windowsSystemDir(env), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return `start "" "${ps}" -NoLogo -NoExit -Command "${LOGIN_SCRIPT}"`;
}

export function loginChildEnv(program: ClaudeProgram, base: NodeJS.ProcessEnv, args: readonly string[] = CLAUDE_LOGIN_ARGS): NodeJS.ProcessEnv {
  return { ...base, [LOGIN_EXE_ENV]: program.command, [LOGIN_ARGS_ENV]: [...program.prefixArgs, ...args].join('\n') };
}

/** 셸이 글자 그대로 읽게 작은따옴표로 감싼다(안의 작은따옴표는 '\'' 로) */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * 맥 로그인 창에서 돌릴 스크립트. 터미널의 셸은 글눈의 환경을 물려받지 않으므로 프로필의 로그인 폴더
 * (CLAUDE_CONFIG_DIR·CODEX_HOME)를 직접 넣고, 셸 설정에 API 키가 있어도 구독 로그인이 되게 그 변수들을 지운다.
 * 한 번 쓰면 스스로 지운다.
 */
export function macLoginScript(program: ClaudeProgram, env: NodeJS.ProcessEnv, args: readonly string[]): string {
  const lines = ['#!/bin/sh', 'rm -f "$0"', `unset ${[...STRIPPED_ENV_VARS, ...CODEX_STRIPPED_ENV_VARS].join(' ')}`];
  for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME']) if (env[k]) lines.push(`export ${k}=${shQuote(env[k]!)}`);
  lines.push([program.command, ...program.prefixArgs, ...args].map(shQuote).join(' '));
  return lines.join('\n') + '\n';
}

const writeExecutable = (file: string, text: string): Promise<void> => writeFile(file, text, { mode: 0o700 });

export const INSTALL_CMD_ENV = 'GEULNUN_INSTALL_CMD';
export const INSTALL_DONE_ENV = 'GEULNUN_INSTALL_DONE';
export const INSTALL_DONE_MESSAGE = "설치가 끝났으면 이 창을 닫고 글눈에서 '다시 확인'을 누르세요. 오류가 났으면 글눈의 '설치 안내'를 보세요.";
// 프로필의 로그인 폴더가 들어가면 설치본이 그 폴더로 간다(Codex 설치 스크립트는 CODEX_HOME 아래에 프로그램을 둔다). 설치는 기본 위치로
const INSTALL_STRIPPED_ENV = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', INSTALL_CMD_ENV, INSTALL_DONE_ENV];
// 명령과 안내 글은 환경 변수로 넘긴다. 명령줄에 넣으면 cmd의 start가 따옴표·한글을 다시 해석한다
const INSTALL_SCRIPT = [
  `$c = $env:${INSTALL_CMD_ENV}`, `$m = $env:${INSTALL_DONE_ENV}`,
  `Remove-Item Env:${INSTALL_CMD_ENV}, Env:${INSTALL_DONE_ENV}`,
  `Write-Host $c`, `Invoke-Expression $c`, `Write-Host ''`, `Write-Host $m`,
].join('; ');

export function installCommandLine(env: NodeJS.ProcessEnv): string {
  const ps = W.join(windowsSystemDir(env), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Codex 공식 안내가 ExecutionPolicy ByPass로 돌린다. 이 창 하나에만 적용된다
  return `start "" "${ps}" -NoLogo -NoExit -ExecutionPolicy Bypass -Command "${INSTALL_SCRIPT}"`;
}

export function installChildEnv(kind: InstallKind, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const k of INSTALL_STRIPPED_ENV) delete env[k];
  return { ...env, [INSTALL_CMD_ENV]: INSTALL_COMMANDS[kind].win, [INSTALL_DONE_ENV]: INSTALL_DONE_MESSAGE };
}

export function macInstallScript(kind: InstallKind): string {
  return ['#!/bin/sh', 'rm -f "$0"', `unset ${INSTALL_STRIPPED_ENV.join(' ')}`, `echo ${shQuote(INSTALL_COMMANDS[kind].unix)}`,
    INSTALL_COMMANDS[kind].unix, 'echo', `echo ${shQuote(INSTALL_DONE_MESSAGE)}`].join('\n') + '\n';
}

/** 'CLI 설치하기': 터미널 창(Windows는 PowerShell, 맥은 터미널)을 열어 공식 설치 명령을 돌린다. 창은 끝나도 남아 결과를 보게 한다 */
export async function openInstall(kind: InstallKind, env: NodeJS.ProcessEnv, spawn: typeof nodeSpawn = nodeSpawn, platform: NodeJS.Platform = process.platform,
  writeScript: (file: string, text: string) => Promise<void> = writeExecutable): Promise<{ ok: boolean; message?: string }> {
  try {
    if (platform === 'darwin') {
      const file = path.join(os.tmpdir(), `geulnun-install-${Date.now()}.command`);
      await writeScript(file, macInstallScript(kind));
      spawn('open', ['-a', 'Terminal', file], { stdio: 'ignore' }).unref?.();
      return { ok: true };
    }
    if (platform !== 'win32') return { ok: false, message: `터미널을 열어 \`${INSTALL_COMMANDS[kind].unix}\`을 직접 실행해 주세요.` };
    const child = spawn(installCommandLine(env), [], {
      cwd: windowsSystemDir(env), env: installChildEnv(kind, env),
      shell: W.join(windowsSystemDir(env), 'cmd.exe'), stdio: 'ignore', windowsHide: true,
    });
    child.unref?.();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `설치 창을 열지 못했습니다: ${(e as Error).message}` };
  }
}

export async function openLogin(program: ClaudeProgram, env: NodeJS.ProcessEnv, spawn: typeof nodeSpawn = nodeSpawn, platform: NodeJS.Platform = process.platform,
  args: readonly string[] = CLAUDE_LOGIN_ARGS, writeScript: (file: string, text: string) => Promise<void> = writeExecutable): Promise<{ ok: boolean; message?: string }> {
  if (platform === 'darwin') {
    // .command 파일을 터미널로 열면 그 안의 명령이 새 창에서 돈다. AppleScript로 터미널을 부리는 것과 달리 '다른 앱 제어' 권한을 묻지 않는다
    try {
      const file = path.join(os.tmpdir(), `geulnun-login-${Date.now()}.command`);
      await writeScript(file, macLoginScript(program, env, args));
      spawn('open', ['-a', 'Terminal', file], { stdio: 'ignore' }).unref?.();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: `로그인 창을 열지 못했습니다: ${(e as Error).message}` };
    }
  }
  if (platform !== 'win32') return { ok: false, message: `터미널을 열어 \`${path.basename(program.command).replace(/\.(exe|cmd)$/i, '')} ${args.join(' ')}\`을 직접 실행해 주세요.` };
  try {
    const child = spawn(loginCommandLine(env), [], {
      cwd: windowsSystemDir(env), env: loginChildEnv(program, env, args),
      shell: W.join(windowsSystemDir(env), 'cmd.exe'), stdio: 'ignore', windowsHide: true, // cmd는 창을 띄운 즉시 끝난다
    });
    child.unref?.();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `로그인 창을 열지 못했습니다: ${(e as Error).message}` };
  }
}
