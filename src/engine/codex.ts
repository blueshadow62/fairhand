import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { killProcessTree } from './cli.js';
import { EngineError, requestImages, transcribeRequest, type Effort, type EngineErrorKind, type RawResult, type StructuredRequest, type TranscribeInput, type TranscribeProvider } from './provider.js';
import { compareVersion, onPath, parseVersion, runClaude, type ClaudeProgram, type ClaudeStatus, type Runner } from './status.js';

/** 안내 문구에 쓰는 이름 */
export const CODEX = 'Codex';
/** --output-schema·--ignore-user-config·--ignore-rules·--ephemeral·--json을 함께 써서 확인한 버전 */
export const MIN_CODEX_VERSION = '0.166.0';
/** 프로필에 모델을 적지 않았을 때 전사 기록에 남기는 값(Codex는 쓴 모델 이름을 알려 주지 않는다) */
export const CODEX_DEFAULT_MODEL = 'codex 기본 모델';

/** ChatGPT 구독 로그인 대신 API 과금으로 몰래 바뀌지 않게 자식에서 지우는 변수 */
export const CODEX_STRIPPED_ENV_VARS: readonly string[] = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT'];

/** Codex 자식 프로세스(상태 점검·로그인 창·전사)에 줄 환경. configDir는 CODEX_HOME(계정별 로그인 폴더). 원본은 바꾸지 않는다 */
export function codexEnv(base: NodeJS.ProcessEnv, opts: { configDir?: string } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of CODEX_STRIPPED_ENV_VARS) delete env[k];
  if (opts.configDir !== undefined) { if (opts.configDir) env.CODEX_HOME = opts.configDir; else delete env.CODEX_HOME; }
  return env;
}

/**
 * Windows: 설정 경로 → GEULNUN_CODEX_PATH → PATH의 codex.exe → PATH의 codex.cmd(npm 설치)
 * 맥·리눅스: 설정 경로 → GEULNUN_CODEX_PATH → PATH의 codex(npm·Homebrew 설치본도 그대로 실행된다)
 */
export function locateCodex(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, configuredPath?: string, platform: NodeJS.Platform = process.platform): ClaudeProgram | null {
  const win = platform === 'win32';
  if (configuredPath) { // 적어 둔 경로가 틀리면 조용히 다른 것을 쓰지 않는다
    if (!exists(configuredPath)) return null;
    return win && /\.cmd$/i.test(configuredPath) ? fromNpmShim(configuredPath, env, exists) : { command: configuredPath, prefixArgs: [] };
  }
  const configured = env.GEULNUN_CODEX_PATH;
  if (configured && exists(configured)) return { command: configured, prefixArgs: [] };
  if (!win) {
    const bin = onPath('codex', env, exists, platform);
    return bin ? { command: bin, prefixArgs: [] } : null;
  }
  const exe = onPath('codex.exe', env, exists, platform);
  if (exe) return { command: exe, prefixArgs: [] };
  const cmd = onPath('codex.cmd', env, exists, platform);
  return cmd ? fromNpmShim(cmd, env, exists) : null;
}

/** npm의 codex.cmd는 셸이 있어야 돌아가므로(인수에 경로가 들어가 셸 인용이 위험) node로 bin/codex.js를 직접 실행한다. Windows 전용 */
function fromNpmShim(cmd: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): ClaudeProgram | null {
  const P = path.win32;
  const js = P.join(P.dirname(cmd), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const node = onPath('node.exe', env, exists, 'win32');
  return exists(js) && node ? { command: node, prefixArgs: [js] } : null;
}

/** 글눈의 노력 단계를 Codex의 model_reasoning_effort로. Codex에는 max가 없어 xhigh로 */
export const codexEffort = (e: Effort): string => (e === 'max' ? 'xhigh' : e);

export interface CodexArgsInput { schemaFile: string; outFile: string; effort: Effort; model?: string; images: string[] }

/**
 * 빈 작업 폴더에서, 사용자 설정(MCP·지시문)·실행 규칙·대화 기록 없이, 읽기 전용 샌드박스로 띄운다.
 * 답은 --output-schema로 양식을 강제하고 마지막 답만 파일로 받는다. 지시문은 stdin으로 넣는다.
 */
export function codexArgs(o: CodexArgsInput): string[] {
  return ['exec', '--json', '--color', 'never', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'read-only', '--output-schema', o.schemaFile, '--output-last-message', o.outFile,
    '-c', `model_reasoning_effort="${codexEffort(o.effort)}"`,
    ...(o.model ? ['--model', o.model] : []),
    ...o.images.flatMap(f => ['--image', f])]; // --image는 값을 여러 개 받으므로 맨 뒤에 둔다
}

/** Codex는 시스템 지시를 따로 받지 않아 앞에 붙인다. 도구를 쓰지 말라고 못 박고, 써도 CodexTurn이 멈춘다 */
export const codexPrompt = (req: StructuredRequest): string => [req.system,
  '이 일은 첨부한 그림(있다면)과 아래 글만 보고 답하는 일입니다. 명령 실행, 파일 읽기·쓰기, 웹 검색 같은 도구는 쓰지 말고 지정한 JSON 형식으로만 답하세요.',
  req.user].join('\n\n');

export function classifyCodex(text: string): EngineError {
  const m = text.trim() || 'Codex가 오류를 보고함';
  const err = (k: EngineErrorKind) => new EngineError(k, m, undefined, CODEX);
  if (/usage limit|rate limit|too many requests|\b429\b|quota/i.test(m)) return err('rate-limit');
  if (/not logged in|please log ?in|codex login|unauthori[sz]ed|\b401\b|\b403\b|token (has )?expired|refresh token/i.test(m)) return err('signed-out');
  if (/unexpected argument|unrecognized|unknown (option|argument|flag)|wasn't expected/i.test(m)) return err('needs-update');
  if (/overloaded|\b50[023]\b|server error|service unavailable/i.test(m)) return err('overloaded');
  if (/timed out|timeout/i.test(m)) return err('timeout');
  if (/stream disconnected|error sending request|connection|network|ENOTFOUND|ECONNRESET/i.test(m)) return err('network');
  return err('other');
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 그림·글만 보고 답하는 일이라 이 항목만 허용한다. 명령 실행·파일 수정·MCP·웹 검색 등이 보이면 바로 멈춘다 */
export const ALLOWED_ITEMS: ReadonlySet<string> = new Set(['agent_message', 'reasoning', 'todo_list', 'error']);

export type CodexOutcome = { type: 'none' } | { type: 'fail'; error: EngineError };

/** `codex exec --json`의 한 턴(thread.started → item.* → turn.completed|turn.failed)을 읽는 상태 기계 */
export class CodexTurn {
  message?: string;
  usage?: { input?: number; output?: number };
  completed = false;
  private lastError = '';

  onLine(line: string): CodexOutcome {
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { return { type: 'none' }; }
    if (!isObj(ev)) return { type: 'none' };
    switch (ev.type) {
      case 'item.started': case 'item.updated': case 'item.completed': {
        const item = isObj(ev.item) ? ev.item : {};
        const kind = String(item.type ?? '');
        if (!ALLOWED_ITEMS.has(kind)) return { type: 'fail', error: new EngineError('unsafe-tools', `도구 사용 시도(${kind.slice(0, 60) || '이름 없음'})`, undefined, CODEX) };
        if (kind === 'error' && typeof item.message === 'string') this.lastError = item.message; // 항목 오류는 경고라 계속 간다
        if (kind === 'agent_message' && ev.type === 'item.completed' && typeof item.text === 'string') this.message = item.text;
        return { type: 'none' };
      }
      case 'turn.completed': {
        const u = isObj(ev.usage) ? ev.usage : {};
        this.usage = { input: typeof u.input_tokens === 'number' ? u.input_tokens : undefined, output: typeof u.output_tokens === 'number' ? u.output_tokens : undefined };
        this.completed = true;
        return { type: 'none' };
      }
      case 'turn.failed':
        return { type: 'fail', error: classifyCodex(isObj(ev.error) && typeof ev.error.message === 'string' ? ev.error.message : this.lastError) };
      case 'error': // 다시 연결 중 같은 알림도 오므로 끝을 정하지 않고 적어만 둔다
        if (typeof ev.message === 'string') this.lastError = ev.message;
        return { type: 'none' };
      default: return { type: 'none' };
    }
  }

  /** turn.completed 없이 끝났을 때 마지막 오류와 stderr로 까닭을 가린다 */
  onExit(code: number | null, stderr: string): EngineError {
    const d = [this.lastError, stderr.replace(/Reading prompt from stdin\.\.\.\s*/g, '').trim()].filter(Boolean).join(' / ');
    return d ? classifyCodex(d.slice(0, 800)) : new EngineError('other', `Codex가 답하기 전에 끝남 (${code ?? 'unknown'})`, undefined, CODEX);
  }
}

export interface CodexDeps { program?: ClaudeProgram | null; spawn?: typeof nodeSpawn; timeoutMs?: number; killTree?: (pid: number) => void; model?: string; env?: NodeJS.ProcessEnv }

export class CodexProvider implements TranscribeProvider {
  readonly id = 'codex' as const;
  private readonly program: ClaudeProgram | null;
  private readonly spawn: typeof nodeSpawn;
  private readonly timeoutMs: number;
  private readonly killTree: (pid: number) => void;
  private readonly env: NodeJS.ProcessEnv;
  private readonly modelArg?: string;
  /** 전사 기록에 남는 모델 이름 */
  readonly model: string;
  constructor(deps: CodexDeps = {}) {
    this.modelArg = deps.model;
    this.model = deps.model ?? CODEX_DEFAULT_MODEL;
    this.program = deps.program === undefined ? locateCodex() : deps.program;
    this.spawn = deps.spawn ?? nodeSpawn;
    this.timeoutMs = deps.timeoutMs ?? 300_000;
    this.killTree = deps.killTree ?? killProcessTree;
    this.env = deps.env ?? codexEnv(process.env);
  }

  transcribe(input: TranscribeInput, signal: AbortSignal): Promise<RawResult> { return this.complete(transcribeRequest(input), signal); }

  async complete(req: StructuredRequest, signal: AbortSignal): Promise<RawResult> {
    if (!this.program) throw new EngineError('not-installed', 'Codex를 찾을 수 없음', undefined, CODEX);
    if (signal.aborted) throw new EngineError('cancelled', '중단됨');
    const program = this.program;
    const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-codex-'));
    try {
      if (signal.aborted) throw new EngineError('cancelled', '중단됨');
      const work = path.join(dir, 'work'); // 지시문 파일(AGENTS.md)도 그림도 없는 빈 작업 폴더
      await mkdir(work);
      const images: string[] = [];
      for (const [i, b64] of requestImages(req).entries()) {
        const f = path.join(dir, `p${i + 1}.jpg`);
        await writeFile(f, Buffer.from(b64, 'base64'));
        images.push(f);
      }
      const schemaFile = path.join(dir, 'schema.json');
      await writeFile(schemaFile, JSON.stringify(req.schema));
      const outFile = path.join(dir, 'answer.json');
      const args = [...program.prefixArgs, ...codexArgs({ schemaFile, outFile, effort: req.effort, model: this.modelArg, images })];
      const turn = new CodexTurn();
      await new Promise<void>((resolve, reject) => {
        let child: ReturnType<typeof nodeSpawn>;
        try { child = this.spawn(program.command, args, { cwd: work, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
        catch (e) { reject(new EngineError('other', `Codex를 실행할 수 없음: ${(e as Error).message}`, undefined, CODEX)); return; }
        let settled = false, exited = false, stderr = '';
        const finish = (err?: EngineError) => {
          if (settled) return; settled = true;
          clearTimeout(timer); signal.removeEventListener('abort', onAbort);
          if (err) { if (!exited && child.pid) this.killTree(child.pid); reject(err); } else resolve();
        };
        const onAbort = () => finish(new EngineError('cancelled', '중단됨'));
        signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => finish(new EngineError('timeout', `${this.timeoutMs / 1000}초 안에 답하지 않음`, undefined, CODEX)), this.timeoutMs);
        const onLine = (line: string) => { const o = turn.onLine(line); if (o.type === 'fail') finish(o.error); };
        child.on('error', (e: NodeJS.ErrnoException) => finish(new EngineError(e.code === 'ENOENT' ? 'not-installed' : 'other', `Codex 실행 실패: ${e.message}`, undefined, CODEX)));
        child.stdin?.on('error', () => undefined);
        child.stderr?.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000); });
        const dec = new StringDecoder('utf8'); let pending = '';
        child.stdout?.on('data', (c: Buffer) => {
          pending += dec.write(c);
          const parts = pending.split('\n'); pending = parts.pop() ?? '';
          for (const line of parts) if (line.trim() && !settled) onLine(line);
        });
        child.on('close', (code: number | null) => {
          exited = true;
          const tail = pending + dec.end(); if (tail.trim() && !settled) onLine(tail);
          if (!settled) finish(turn.completed ? undefined : turn.onExit(code, stderr));
        });
        child.stdin?.end(codexPrompt(req));
      });
      // 마지막 답은 파일이 기준이고, 없으면 이벤트의 마지막 메시지
      const text = await readFile(outFile, 'utf-8').catch(() => turn.message);
      if (typeof text !== 'string' || !text.trim()) throw new EngineError('invalid-output', 'Codex가 답 없이 끝남', undefined, CODEX);
      let output: unknown;
      try { output = JSON.parse(text); } catch { throw new EngineError('invalid-output', 'Codex 답이 JSON이 아님', undefined, CODEX); }
      return { output, inputTokens: turn.usage?.input, outputTokens: turn.usage?.output, model: this.model };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** `codex login status`의 글(stdout·stderr 어느 쪽이든)을 읽는다 */
export function parseCodexLogin(text: string): { loggedIn: boolean; method?: string } | null {
  if (/not logged in/i.test(text)) return { loggedIn: false };
  if (/logged in using chatgpt/i.test(text)) return { loggedIn: true, method: 'ChatGPT' };
  if (/logged in using an? api key/i.test(text)) return { loggedIn: true, method: 'API key' };
  if (/logged in/i.test(text)) return { loggedIn: true };
  return null;
}

export async function codexStatus(run: Runner = runClaude, locate: () => ClaudeProgram | null = () => locateCodex(), env: NodeJS.ProcessEnv = codexEnv(process.env)): Promise<ClaudeStatus> {
  const program = locate();
  if (!program) return { installed: false, minVersion: MIN_CODEX_VERSION };
  const [ver, st] = await Promise.all([run(program, ['--version'], env), run(program, ['login', 'status'], env)]);
  const v = parseVersion(ver.stdout) ?? undefined;
  const login = parseCodexLogin(`${st.stdout}\n${st.stderr}`);
  return { installed: true, version: v, tooOld: v ? compareVersion(v, MIN_CODEX_VERSION) < 0 : undefined,
    loggedIn: login?.loggedIn, authMethod: login?.method, subscriptionType: login?.method, minVersion: MIN_CODEX_VERSION };
}
