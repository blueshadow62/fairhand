import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { CliTurn, initializeLine, launchArgs, userLine, MODEL } from './cli-protocol.js';
import { EngineError, requestImages, transcribeRequest, type RawResult, type StructuredRequest, type TranscribeInput, type TranscribeProvider } from './provider.js';
import { childEnv } from './env.js';
import { locateClaude, type ClaudeProgram } from './status.js';

export interface CliDeps { program?: ClaudeProgram | null; spawn?: typeof nodeSpawn; timeoutMs?: number; killTree?: (pid: number) => void; env?: NodeJS.ProcessEnv }

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
  constructor(deps: CliDeps = {}) {
    this.program = deps.program === undefined ? locateClaude() : deps.program;
    this.spawn = deps.spawn ?? nodeSpawn;
    this.timeoutMs = deps.timeoutMs ?? 300_000;
    this.killTree = deps.killTree ?? killProcessTree;
    this.env = deps.env ?? childEnv(process.env);
  }

  transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> { return this.complete(transcribeRequest(input), signal); }

  async complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> {
    if (!this.program) throw new EngineError('not-installed', 'Claude Code를 찾을 수 없음');
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    const program = this.program;
    const args = [...program.prefixArgs, ...launchArgs(req.schema, req.effort)];
    const cwd = await mkdtemp(path.join(tmpdir(), 'geulnun-cli-')); // 다른 폴더의 CLAUDE.md·설정이 끼어들지 않게 빈 폴더에서
    const turn = new CliTurn(userLine(requestImages(req), req.user));
    try {
      return await new Promise<RawResult>((resolve, reject) => {
        let child: ReturnType<typeof nodeSpawn>;
        try {
          child = this.spawn(program.command, args, { cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
          else if (o.type === 'done') finish(undefined, { output: o.output, inputTokens: o.usage?.input, outputTokens: o.usage?.output, model: MODEL });
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
