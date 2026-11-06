import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from './env.js';

export interface ClaudeProgram { command: string; prefixArgs: string[] }
export const MIN_CLI_VERSION = '2.1.248';

function onPath(name: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    const p = path.join(dir, name);
    if (exists(p)) return p;
  }
  return null;
}

/** 설정 경로 → 사용자 .local\bin\claude.exe(공식 설치 프로그램 위치) → PATH의 claude.exe → PATH의 claude.cmd(npm, node로 cli.js를 직접 실행) */
export function locateClaude(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, configuredPath?: string): ClaudeProgram | null {
  if (configuredPath) { // 적어 둔 경로가 틀리면 조용히 다른 것을 쓰지 않는다
    if (!exists(configuredPath)) return null;
    return /\.cmd$/i.test(configuredPath) ? fromCmd(configuredPath, env, exists) : { command: configuredPath, prefixArgs: [] };
  }
  const configured = env.GEULNUN_CLAUDE_PATH;
  if (configured && exists(configured)) return { command: configured, prefixArgs: [] };
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const local = path.join(home, '.local', 'bin', 'claude.exe');
  if (home && exists(local)) return { command: local, prefixArgs: [] };
  const exe = onPath('claude.exe', env, exists);
  if (exe) return { command: exe, prefixArgs: [] };
  const cmd = onPath('claude.cmd', env, exists);
  return cmd ? fromCmd(cmd, env, exists) : null;
}

/** .cmd는 셸이 있어야 돌아가므로(인수에 JSON 스키마가 들어가 셸 인용이 위험하고, 셸 없이 spawn하면 EINVAL) node로 cli.js를 직접 실행한다 */
function fromCmd(cmd: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): ClaudeProgram | null {
  const cli = path.join(path.dirname(cmd), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  const node = onPath('node.exe', env, exists);
  return exists(cli) && node ? { command: node, prefixArgs: [cli] } : null;
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function parseVersion(stdout: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
}

export function parseAuthStatus(stdout: string): { loggedIn: boolean; authMethod?: string; subscriptionType?: string } | null {
  const s = stdout.indexOf('{'), e = stdout.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const o = JSON.parse(stdout.slice(s, e + 1));
    if (typeof o?.loggedIn !== 'boolean') return null;
    return { loggedIn: o.loggedIn, authMethod: typeof o.authMethod === 'string' ? o.authMethod : undefined,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined };
  } catch { return null; }
}

export type Runner = (program: ClaudeProgram, args: string[], env?: NodeJS.ProcessEnv) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const runClaude: Runner = (program, args, env) => new Promise(res => {
  execFile(program.command, [...program.prefixArgs, ...args], { timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20, env: env ?? childEnv(process.env) },
    (err, stdout, stderr) => res({ code: err && 'code' in err && typeof err.code === 'number' ? err.code : err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
});

export interface ClaudeStatus { installed: boolean; version?: string; tooOld?: boolean; loggedIn?: boolean; authMethod?: string; subscriptionType?: string }

export async function claudeStatus(run: Runner = runClaude, locate: () => ClaudeProgram | null = () => locateClaude(), env: NodeJS.ProcessEnv = childEnv(process.env)): Promise<ClaudeStatus> {
  const program = locate();
  if (!program) return { installed: false };
  const v = parseVersion((await run(program, ['--version'], env)).stdout) ?? undefined;
  const auth = parseAuthStatus((await run(program, ['auth', 'status', '--json'], env)).stdout);
  return { installed: true, version: v, tooOld: v ? compareVersion(v, MIN_CLI_VERSION) < 0 : undefined,
    loggedIn: auth?.loggedIn, authMethod: auth?.authMethod, subscriptionType: auth?.subscriptionType };
}
