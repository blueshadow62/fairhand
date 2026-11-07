import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { CliProvider } from '../src/engine/cli.js';
import { EngineError } from '../src/engine/provider.js';
import { STRUCTURED_OUTPUT_TOOL } from '../src/engine/cli-protocol.js';
import { loadRules } from '../src/engine/rules.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const rules = await loadRules();
const input = { imageJpegBase64: 'AAAA', key, rules, page: 1, effort: 'high' as const };
const j = (o: unknown) => `${JSON.stringify(o)}\n`;

/** 대본대로 stdout에 줄을 쓰는 가짜 자식 프로세스. stdin에 들어온 줄을 기록한다. */
function fakeSpawn(script: (stdinLines: string[], out: PassThrough, child: any) => void, exit = { code: 0, stderr: '' }) {
  const calls: { command: string; args: string[] }[] = [];
  const spawn = (command: string, args: string[]) => {
    calls.push({ command, args });
    const child: any = new EventEmitter();
    child.pid = 4242;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const lines: string[] = [];
    child.stdin.on('data', (c: Buffer) => { lines.push(...c.toString().split('\n').filter(Boolean)); script(lines, child.stdout, child); });
    child.stdin.on('finish', () => setTimeout(() => { child.stderr.write(exit.stderr); child.stderr.end(); child.stdout.end(); child.emit('close', exit.code, null); }, 5));
    child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
    return child;
  };
  return { spawn: spawn as any, calls };
}
const program = { command: 'C:\\fake\\claude.exe', prefixArgs: [] };

test('CliProvider: initialize → user → init 확인 → 결과', async () => {
  const out = { page: 1, grade: 3, class: 1, number: 1, name: null, id_confidence: '확실', quant: [{ id: '1-1', answer: '은영', verdict: 'O' }, { id: '3-1', answer: '', verdict: '빈칸' }], qual: [{ id: 'E1', responded: false, answer: '' }], notes: [] };
  const f = fakeSpawn((lines, o) => {
    if (lines.length === 1) o.write(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
    if (lines.length === 2) {
      o.write(j({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }));
      o.write(j({ type: 'result', subtype: 'success', is_error: false, structured_output: out, usage: { input_tokens: 100, output_tokens: 50 } }));
    }
  });
  const p = new CliProvider({ program, spawn: f.spawn, killTree: () => {} });
  const r = await p.transcribe(input, new AbortController().signal);
  assert.deepEqual(r.output, out); assert.equal(r.inputTokens, 100); assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(f.calls[0]!.command, program.command);
  assert.ok(f.calls[0]!.args.includes('--json-schema'));
});

test('CliProvider: 프로그램이 없으면 not-installed', async () => {
  const p = new CliProvider({ program: null });
  await assert.rejects(p.transcribe(input, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'not-installed');
});

test('cli_old_version_needs_update', async () => {
  const f = fakeSpawn((_l, _o, child) => { setTimeout(() => { child.stderr.write("error: unknown option '--json-schema'"); child.stdout.end(); child.emit('close', 1, null); }, 5); });
  const p = new CliProvider({ program, spawn: f.spawn, killTree: () => {} });
  await assert.rejects(p.transcribe(input, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'needs-update');
});

test('cli_signed_out', async () => {
  const f = fakeSpawn((lines, o) => {
    if (lines.length === 1) o.write(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
    if (lines.length === 2) {
      o.write(j({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }));
      o.write(j({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Not logged in' }] } }));
      o.write(j({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in' }));
    }
  });
  const p = new CliProvider({ program, spawn: f.spawn, killTree: () => {} });
  await assert.rejects(p.transcribe(input, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'signed-out');
});

test('cli_refuses_unexpected_tools: 즉시 트리 종료', async () => {
  let killed = 0;
  const f = fakeSpawn((lines, o) => {
    if (lines.length === 1) o.write(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
    if (lines.length === 2) o.write(j({ type: 'system', subtype: 'init', tools: ['Bash', STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }));
  });
  const p = new CliProvider({ program, spawn: f.spawn, killTree: () => { killed++; } });
  await assert.rejects(p.transcribe(input, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'unsafe-tools');
  assert.equal(killed, 1);
});

test('CliProvider: 시간 초과와 중단', async () => {
  const f = fakeSpawn(() => {});
  const p = new CliProvider({ program, spawn: f.spawn, killTree: () => {}, timeoutMs: 30 });
  await assert.rejects(p.transcribe(input, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'timeout');
  const ac = new AbortController();
  const p2 = new CliProvider({ program, spawn: fakeSpawn(() => {}).spawn, killTree: () => {}, timeoutMs: 5000 });
  const pending = p2.transcribe(input, ac.signal);
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(pending, (e: unknown) => e instanceof EngineError && e.kind === 'cancelled');
});
