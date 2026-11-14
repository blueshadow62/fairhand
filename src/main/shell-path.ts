import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * 맥에서 Finder·Dock으로 연 앱은 터미널의 PATH를 물려받지 못해(/usr/bin:/bin:/usr/sbin:/sbin) Homebrew·npm·nvm으로 깐
 * Claude Code·Codex와, npm 설치본이 부르는 node를 찾지 못한다. 그래서 시작할 때 로그인 셸에 PATH를 한 번 물어 합치고
 * 흔한 설치 위치도 덧붙인다. 리눅스도 바탕화면 실행기에 따라 같은 일이 있어 함께 한다. Windows는 손대지 않는다.
 */
const MARK = '__GEULNUN_PATH__';
// ${PATH}로 써야 뒤의 표시 글자가 변수 이름에 붙지 않는다. 셸 설정이 앞뒤에 다른 글을 찍어도 표시 사이만 쓴다
const SCRIPT = 'printf "%s" "' + MARK + '${PATH}' + MARK + '"';

export function parseShellPath(stdout: string): string | null {
  const s = stdout.indexOf(MARK), e = stdout.lastIndexOf(MARK);
  if (s < 0 || e <= s) return null;
  return stdout.slice(s + MARK.length, e).trim() || null;
}

/** 앞쪽이 먼저 찾힌다. 같은 폴더는 한 번만 */
export function mergePath(parts: readonly string[], delimiter = ':'): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of parts.flatMap(p => p.split(delimiter))) if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  return out.join(delimiter);
}

export const commonDirs = (home: string): string[] => ['/opt/homebrew/bin', '/usr/local/bin',
  ...['.local/bin', '.npm-global/bin', '.volta/bin', '.bun/bin'].map(d => path.posix.join(home, d))];

type Exec = (file: string, args: readonly string[], opts: { timeout: number; env: NodeJS.ProcessEnv }, cb: (err: Error | null, stdout: string) => void) => void;
/**
 * 입력은 막는다(/dev/null): 셸 설정(zsh 자동 완성 초기화 등)이 'y/n?'을 물으면 입력을 기다리며 멈춘다.
 * 시간이 지나면 SIGKILL로 끈다: 대화형 셸은 보통의 종료 신호(SIGTERM)를 무시한다.
 */
const run: Exec = (file, args, opts, cb) => {
  let out = '';
  const child = spawn(file, [...args], { env: opts.env, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => { if (out.length < 1 << 20) out += d; });
  const t = setTimeout(() => child.kill('SIGKILL'), opts.timeout);
  child.on('error', e => { clearTimeout(t); cb(e, out); });
  child.on('close', () => { clearTimeout(t); cb(null, out); });
};

/**
 * 로그인·대화형(-ilc)이라야 .zprofile·.zshrc에서 PATH를 늘리는 Homebrew·nvm 설정까지 읽힌다. 실패·시간 초과면 null.
 * 셸이 끝나지 않아도 timeoutMs 뒤에는 기다리지 않는다: 이것을 기다리는 동안 창이 뜨지 않는다(0.2.9 개발 중 맥에서 겪음)
 */
export function askShellPath(shell: string, timeoutMs: number, exec: Exec = run): Promise<string | null> {
  if (path.posix.basename(shell) === 'fish') return Promise.resolve(null); // fish는 PATH가 목록이라 문법이 달라 흔한 위치만 쓴다
  return new Promise(res => {
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; clearTimeout(guard); res(v); } };
    const guard = setTimeout(() => finish(null), timeoutMs + 500);
    exec(shell, ['-ilc', SCRIPT], { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } }, (_err, out) => finish(parseShellPath(out)));
  });
}

/** env.PATH를 고친다(기본은 process.env라 이후 띄우는 모든 자식 프로세스에 적용된다) */
export async function fixPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exec?: Exec): Promise<void> {
  if (platform === 'win32' || env.GEULNUN_NO_SHELL_PATH) return; // 셸 설정 때문에 문제가 생기면 이 변수로 끌 수 있다
  const home = env.HOME || os.homedir();
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const fromShell = await askShellPath(shell, 3000, exec);
  env.PATH = mergePath([fromShell ?? '', env.PATH ?? '', ...commonDirs(home)]);
}
