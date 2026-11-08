import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { CliTurn, initializeLine, launchArgs, userLine, MODEL } from './cli-protocol.js';
import { EngineError, requestImages, transcribeRequest, type RawResult, type StructuredRequest, type TranscribeInput, type TranscribeProvider } from './provider.js';
import { childEnv } from './env.js';
import { locateClaude, type ClaudeProgram } from './status.js';

export interface CliDeps { program?: ClaudeProgram | null; spawn?: typeof nodeSpawn; timeoutMs?: number; killTree?: (pid: number) => void; model?: string; env?: NodeJS.ProcessEnv }

/**
 * 한 번 부를 때의 시간 한도. 2026-11-08부터 손글씨 장 하나가 노력 '중간'에서 3~5분 걸려(11-06에는 30초 안팎) 5분 한도에서 실패했다.
 * 다시 묻기는 시간 초과에 한 번뿐(withRetry)이라 한 장이 아무리 길어도 30분을 넘지 않는다
 */
export const CLI_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 맥·리눅스에서 kill(-pid)로 손자 프로세스까지 한 번에 끄려면 자식이 새 프로세스 묶음(그룹)의 대표여야 한다.
 * 묶음 없이 띄우면 그 번호의 묶음이 없어 끄기가 조용히 실패하고 AI 도구가 계속 돈다. Windows는 taskkill /T가 트리를 끈다.
 */
export const SPAWN_DETACHED = process.platform !== 'win32';

export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  else try { process.kill(-pid, 'SIGKILL'); } catch { /* 이미 끝남 */ }
}

const EXIT_GRACE_MS = 5000;

export class CliProvider implements TranscribeProvider {
  readonly id = 'cli' as const;
  private readonly program: ClaudeProgram | null;
  private readonly spawn: typeof nodeSpawn;
  private readonly timeoutMs: number;
  private readonly killTree: (pid: number) => void;
  private readonly env: NodeJS.ProcessEnv;
  readonly model: string;
  constructor(deps: CliDeps = {}) {
    this.model = deps.model ?? MODEL;
    this.program = deps.program === undefined ? locateClaude() : deps.program;
    this.spawn = deps.spawn ?? nodeSpawn;
    this.timeoutMs = deps.timeoutMs ?? CLI_TIMEOUT_MS;
    this.killTree = deps.killTree ?? killProcessTree;
    this.env = deps.env ?? childEnv(process.env);
  }

  transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> { return this.complete(transcribeRequest(input), signal); }

  async complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> {
    if (!this.program) throw new EngineError('not-installed', 'Claude Code를 찾을 수 없음');
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    const program = this.program;
    const args = [...program.prefixArgs, ...launchArgs(req.schema, req.effort, this.model)];
    const cwd = await mkdtemp(path.join(tmpdir(), 'geulnun-cli-')); // 다른 폴더의 CLAUDE.md·설정이 끼어들지 않게 빈 폴더에서
    if (signal.aborted) { await rm(cwd, { recursive: true, force: true }).catch(() => undefined); throw new EngineError('cancelled', '중단됨'); } // 이미 abort된 signal에는 아래 리스너가 울리지 않는다
    const turn = new CliTurn(userLine(requestImages(req), req.user));
    try {
      return await new Promise<RawResult>((resolve, reject) => {
        let child: ReturnType<typeof nodeSpawn>;
        try {
          child = this.spawn(program.command, args, { cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: SPAWN_DETACHED });
        } catch (e) { reject(new EngineError('other', `Claude Code를 실행할 수 없음: ${(e as Error).message}`)); return; }
        let settled = false, exited = false, stderr = '';
        const finish = (err?: EngineError, result?: RawResult) => {
          if (settled) return; settled = true;
          clearTimeout(timer); signal.removeEventListener('abort', onAbort);
          if (err) { if (!exited && child.pid) this.killTree(child.pid); }
          else {
            // 결과를 받았으면 stdin을 닫아 스스로 끝나게 하고, 늦으면 트리 종료
            child.stdin?.end();
            const t = setTimeout(() => { if (!exited && child.pid) this.killTree(child.pid); }, EXIT_GRACE_MS); t.unref?.();
          }
          if (err) reject(err); else resolve(result!);
        };
        const onAbort = () => finish(new EngineError('cancelled', '중단됨'));
        signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => finish(new EngineError('timeout', `${this.timeoutMs / 1000}초 안에 답하지 않음`)), this.timeoutMs);
        const act = (o: ReturnType<CliTurn['onLine']>) => {
          if (o.type === 'write') { if (child.stdin?.writable) child.stdin.write(o.line); }
          else if (o.type === 'done') finish(undefined, { output: o.output, inputTokens: o.usage?.input, outputTokens: o.usage?.output, model: this.model });
          else if (o.type === 'fail') finish(o.error);
        };
        child.on('error', (e: NodeJS.ErrnoException) => finish(new EngineError(e.code === 'ENOENT' ? 'not-installed' : 'other', `Claude Code 실행 실패: ${e.message}`)));
        child.stdin?.on('error', () => undefined);
        child.stderr?.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000); });
        const dec = new StringDecoder('utf8'); let pending = '';
        child.stdout?.on('data', (c: Buffer) => {
          pending += dec.write(c);
          const parts = pending.split('\n'); pending = parts.pop() ?? '';
          for (const line of parts) if (line.trim() && !settled) act(turn.onLine(line));
        });
        child.on('close', (code: number | null) => {
          exited = true;
          const tail = pending + dec.end(); if (tail.trim() && !settled) act(turn.onLine(tail));
          if (!settled) act(turn.onExit(code, stderr));
        });
        child.stdin?.write(initializeLine(req.system));
      });
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
