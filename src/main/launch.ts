import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import type { ClaudeProgram } from '../engine/status.js';

export const LOGIN_EXE_ENV = 'GEULNUN_LOGIN_EXE';
export const LOGIN_ARGS_ENV = 'GEULNUN_LOGIN_ARGS';

/**
 * 로그인 창(이음오피스 subscription/launch.ts 방식). Node는 Windows에서 자식에게 콘솔 창을 줄 수 없어
 * cmd의 `start`로 PowerShell 창을 띄우고, 그 안에서 CLI의 `auth login`을 돌린다. 실행 파일·인수는 환경 변수로 넘겨
 * 명령줄에 경로(인용 문제)가 들어가지 않게 한다. 인수는 줄바꿈([char]10)으로 나눈다.
 */
const LOGIN_SCRIPT = [
  `$exe = $env:${LOGIN_EXE_ENV}`,
  `$pre = if ($env:${LOGIN_ARGS_ENV}) { $env:${LOGIN_ARGS_ENV} -split [char]10 } else { @() }`,
  `Remove-Item Env:${LOGIN_EXE_ENV}, Env:${LOGIN_ARGS_ENV}`,
  `& $exe @pre auth login`,
].join('; ');

export const windowsSystemDir = (env: NodeJS.ProcessEnv): string => path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32');

export function loginCommandLine(env: NodeJS.ProcessEnv): string {
  const ps = path.join(windowsSystemDir(env), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return `start "" "${ps}" -NoLogo -NoExit -Command "${LOGIN_SCRIPT}"`;
}

export function loginChildEnv(program: ClaudeProgram, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, [LOGIN_EXE_ENV]: program.command, [LOGIN_ARGS_ENV]: program.prefixArgs.join('\n') };
}

export async function openLogin(program: ClaudeProgram, env: NodeJS.ProcessEnv, spawn: typeof nodeSpawn = nodeSpawn, platform: NodeJS.Platform = process.platform): Promise<{ ok: boolean; message?: string }> {
  if (platform !== 'win32') return { ok: false, message: '터미널을 열어 `claude auth login`을 직접 실행해 주세요.' };
  try {
    const child = spawn(loginCommandLine(env), [], {
      cwd: windowsSystemDir(env), env: loginChildEnv(program, env),
      shell: path.join(windowsSystemDir(env), 'cmd.exe'), stdio: 'ignore', windowsHide: true, // cmd는 창을 띄운 즉시 끝난다
    });
    child.unref?.();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `로그인 창을 열지 못했습니다: ${(e as Error).message}` };
  }
}
