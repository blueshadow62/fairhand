import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { ALLOWED_ITEMS, CODEX_DEFAULT_MODEL, CODEX_STRIPPED_ENV_VARS, CodexProvider, CodexTurn, MIN_CODEX_VERSION, classifyCodex, codexArgs, codexEffort, codexEnv, codexStatus, locateCodex, parseCodexLogin } from '../src/engine/codex.js';
import { EngineError, userFacingMessage, type StructuredRequest } from '../src/engine/provider.js';

const REQ: StructuredRequest = { system: 'SYS', user: 'USER', imageJpegBase64: Buffer.from('jpg-bytes').toString('base64'), schema: { type: 'object' }, effort: 'medium' };
const PROGRAM = { command: 'codex.exe', prefixArgs: [] };

interface Seen { command: string; args: string[]; cwd: string; cwdFiles: string[]; image: string | null; prompt: string; env: NodeJS.ProcessEnv }
/** stdin을 다 받으면 script를 부르는 가짜 Codex 프로세스 */
function fakeCodex(script: (args: string[], child: any) => void) {
  const seen: Seen[] = [];
  const spawn = ((command: string, args: string[], opts: any) => {
    const child: any = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 4242 });
    const imgArg = args.indexOf('--image');
    const s: Seen = { command, args, cwd: opts.cwd, cwdFiles: readdirSync(opts.cwd), image: imgArg >= 0 ? readFileSync(args[imgArg + 1]!, 'utf-8') : null, prompt: '', env: opts.env };
    seen.push(s);
    child.stdin.on('data', (c: Buffer) => { s.prompt += c.toString(); });
    child.stdin.on('end', () => script(args, child));
    return child;
  }) as any;
  return { spawn, seen };
}

test('codexArgs: 읽기 전용·사용자 설정과 기록 없이, 스키마와 마지막 답 파일, 그림은 맨 뒤', () => {
  const a = codexArgs({ schemaFile: 'S.json', outFile: 'O.json', effort: 'max', images: ['p1.jpg', 'p2.jpg'] });
  assert.equal(a[0], 'exec');
  for (const f of ['--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(a[a.indexOf('--output-schema') + 1], 'S.json');
  assert.equal(a[a.indexOf('--output-last-message') + 1], 'O.json');
  assert.ok(a.includes('model_reasoning_effort="xhigh"')); // Codex에는 max가 없다
  assert.ok(!a.includes('--model'));
  assert.deepEqual(a.slice(-4), ['--image', 'p1.jpg', '--image', 'p2.jpg']);
  assert.ok(codexArgs({ schemaFile: 's', outFile: 'o', effort: 'low', model: 'gpt-x', images: [] }).join(' ').includes('--model gpt-x'));
  assert.equal(codexEffort('medium'), 'medium');
});

test('codexEnv: API 과금으로 바뀌는 변수는 지우고 CODEX_HOME은 프로필 폴더로, 원본은 그대로', () => {
  const base = { OPENAI_API_KEY: 'sk', CODEX_API_KEY: 'k', PATH: 'p', CODEX_HOME: 'C:\\old' };
  const e = codexEnv(base, { configDir: 'C:\\u\\.codex-b' });
  for (const k of CODEX_STRIPPED_ENV_VARS) assert.equal(e[k], undefined);
  assert.equal(e.CODEX_HOME, 'C:\\u\\.codex-b'); assert.equal(e.PATH, 'p');
  assert.equal(base.OPENAI_API_KEY, 'sk');
  assert.equal(codexEnv(base).CODEX_HOME, 'C:\\old');
});

test('locateCodex: 설정 경로가 먼저, npm의 codex.cmd는 node로 bin/codex.js를 직접 실행', () => {
  const files = new Set(['C:\\npm\\codex.cmd', 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'C:\\node\\node.exe', 'D:\\tools\\codex.exe']);
  const exists = (p: string) => files.has(p);
  const env = { PATH: 'C:\\npm;C:\\node' };
  assert.deepEqual(locateCodex(env, exists, undefined, 'win32'), { command: 'C:\\node\\node.exe', prefixArgs: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'] });
  assert.deepEqual(locateCodex(env, exists, 'D:\\tools\\codex.exe', 'win32'), { command: 'D:\\tools\\codex.exe', prefixArgs: [] });
  assert.equal(locateCodex(env, exists, 'D:\\없음\\codex.exe', 'win32'), null); // 적어 둔 경로가 틀리면 다른 것을 쓰지 않는다
  assert.equal(locateCodex({ PATH: '' }, exists, undefined, 'win32'), null);
});

test('locateCodex(맥·리눅스): PATH를 :로 나눠 확장자 없는 codex를 찾고, npm 설치본도 그대로 실행한다', () => {
  const exists = (p: string) => p === '/opt/homebrew/bin/codex';
  assert.deepEqual(locateCodex({ PATH: '/usr/bin:/opt/homebrew/bin' }, exists, undefined, 'darwin'), { command: '/opt/homebrew/bin/codex', prefixArgs: [] });
  assert.equal(locateCodex({ PATH: '/usr/bin' }, exists, undefined, 'linux'), null);
  // .cmd 치환은 Windows에서만: 맥에서 적어 둔 경로는 그대로 쓴다
  assert.deepEqual(locateCodex({}, () => true, '/Users/t/bin/codex.cmd', 'darwin'), { command: '/Users/t/bin/codex.cmd', prefixArgs: [] });
});

test('CodexTurn: 답·토큰을 모으고, 명령 실행·파일 수정·MCP·웹 검색 항목이 보이면 바로 멈춘다', () => {
  const t = new CodexTurn();
  assert.deepEqual(t.onLine('{"type":"thread.started","thread_id":"x"}'), { type: 'none' });
  t.onLine('{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"..."}}');
  t.onLine('{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"{\\"ok\\":true}"}}');
  t.onLine('{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":7}}');
  assert.equal(t.message, '{"ok":true}'); assert.deepEqual(t.usage, { input: 120, output: 7 }); assert.equal(t.completed, true);
  for (const kind of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search']) {
    const o = new CodexTurn().onLine(JSON.stringify({ type: 'item.started', item: { type: kind } }));
    assert.ok(o.type === 'fail' && o.error.kind === 'unsafe-tools' && o.error.who === 'Codex', kind);
  }
  assert.ok(ALLOWED_ITEMS.has('agent_message') && !ALLOWED_ITEMS.has('command_execution'));
});

test('classifyCodex: 한도·로그인·옵션·네트워크 오류를 가르고, 안내 문구는 Codex 이름으로', () => {
  assert.equal(classifyCodex("You've hit your usage limit. Try again later.").kind, 'rate-limit');
  assert.equal(classifyCodex('Not logged in. Run codex login').kind, 'signed-out');
  assert.equal(classifyCodex("error: unexpected argument '--ignore-rules' found").kind, 'needs-update');
  assert.equal(classifyCodex('stream disconnected before completion').kind, 'network');
  const failed = new CodexTurn().onLine('{"type":"turn.failed","error":{"message":"401 Unauthorized"}}');
  assert.ok(failed.type === 'fail' && failed.error.kind === 'signed-out');
  assert.match(userFacingMessage(classifyCodex('Not logged in')), /^Codex에 로그인이 필요합니다/);
  assert.match(userFacingMessage(new EngineError('not-installed', 'x')), /^Claude Code가 설치/); // 기존 경로의 안내는 그대로
  const quiet = new CodexTurn();
  quiet.onLine('{"type":"error","message":"stream disconnected before completion"}');
  assert.equal(quiet.onExit(1, 'Reading prompt from stdin...\n').kind, 'network');
  assert.equal(new CodexTurn().onExit(3, 'Reading prompt from stdin...\n').kind, 'other');
});

test('parseCodexLogin·codexStatus: 버전과 ChatGPT 로그인을 읽고 최소 버전을 함께 알린다', async () => {
  assert.deepEqual(parseCodexLogin('Logged in using ChatGPT'), { loggedIn: true, method: 'ChatGPT' });
  assert.deepEqual(parseCodexLogin('Not logged in'), { loggedIn: false });
  assert.equal(parseCodexLogin('???'), null);
  const run = async (_p: unknown, args: string[]) => (args[0] === '--version' ? { code: 0, stdout: 'codex-cli 0.166.0\n', stderr: '' } : { code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' });
  assert.deepEqual(await codexStatus(run, () => PROGRAM, {}),
    { installed: true, version: '0.166.0', tooOld: false, loggedIn: true, authMethod: 'ChatGPT', subscriptionType: 'ChatGPT', minVersion: MIN_CODEX_VERSION });
  assert.deepEqual(await codexStatus(run, () => null, {}), { installed: false, minVersion: MIN_CODEX_VERSION });
});

test('CodexProvider: 빈 작업 폴더에서 그림은 파일로, 지시문은 stdin으로 보내고 답 파일을 읽은 뒤 임시 폴더를 지운다', async () => {
  const { spawn, seen } = fakeCodex((args, child) => {
    writeFileSync(args[args.indexOf('--output-last-message') + 1]!, '{"ok":true}');
    child.stdout.write('{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}\n');
    child.stdout.end('{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}\n');
    setImmediate(() => child.emit('close', 0));
  });
  const p = new CodexProvider({ program: PROGRAM, spawn, env: { PATH: 'p' }, killTree: () => undefined });
  const r = await p.complete(REQ, new AbortController().signal);
  assert.deepEqual(r, { output: { ok: true }, inputTokens: 5, outputTokens: 2, model: CODEX_DEFAULT_MODEL });
  const s = seen[0]!;
  assert.equal(s.command, 'codex.exe');
  assert.equal(path.basename(s.cwd), 'work'); assert.deepEqual(s.cwdFiles, []);
  assert.equal(s.image, 'jpg-bytes');
  assert.match(s.prompt, /^SYS[\s\S]*도구는 쓰지 말고[\s\S]*USER$/);
  assert.deepEqual(s.env, { PATH: 'p' });
  assert.equal(existsSync(path.dirname(s.cwd)), false);
});

test('CodexProvider: 도구를 쓰려 하면 프로세스를 끝내고 unsafe-tools, 설치가 없으면 not-installed', async () => {
  const killed: number[] = [];
  const { spawn } = fakeCodex((_args, child) => { child.stdout.write('{"type":"item.started","item":{"type":"command_execution","command":"type secret.txt"}}\n'); });
  const p = new CodexProvider({ program: PROGRAM, spawn, env: {}, killTree: pid => killed.push(pid) });
  await assert.rejects(p.complete(REQ, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'unsafe-tools' && e.who === 'Codex');
  assert.deepEqual(killed, [4242]);
  await assert.rejects(new CodexProvider({ program: null }).complete(REQ, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'not-installed');
});
