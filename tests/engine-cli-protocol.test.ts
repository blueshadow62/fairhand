import test from 'node:test';
import assert from 'node:assert/strict';
import { launchArgs, initializeLine, userLine, CliTurn, STRUCTURED_OUTPUT_TOOL } from '../src/engine/cli-protocol.js';
import { EngineError } from '../src/engine/provider.js';

const schema = { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'], additionalProperties: false };
const j = (o: unknown) => JSON.stringify(o);
const fresh = () => new CliTurn(userLine('AAAA', '전사하라'));
const init = (t: CliTurn) => {
  t.onLine(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
  return t.onLine(j({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] }));
};

test('launchArgs: 고정 플래그, 모델, effort, 스키마', () => {
  const a = launchArgs(schema, 'high');
  assert.deepEqual(a.slice(0, 2), ['-p', '--input-format']);
  for (const f of ['--output-format', '--tools', '--restricted', '--strict-mcp-config', '--setting-sources', '--disable-slash-commands', '--no-session-persistence', '--model', '--effort', '--json-schema']) assert.ok(a.includes(f), f);
  assert.ok(!a.includes('--bare'));
  assert.equal(a[a.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(a[a.indexOf('--effort') + 1], 'high');
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.deepEqual(JSON.parse(a[a.indexOf('--json-schema') + 1]!), schema);
});

test('initializeLine·userLine: 두 줄의 모양', () => {
  const i = JSON.parse(initializeLine('규칙'));
  assert.equal(i.type, 'control_request'); assert.equal(i.request_id, 'initialize');
  assert.deepEqual(i.request, { subtype: 'initialize', systemPrompt: ['규칙'] });
  const u = JSON.parse(userLine('AAAA', '전사하라'));
  assert.equal(u.type, 'user');
  assert.deepEqual(u.message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.deepEqual(u.message.content[1], { type: 'text', text: '전사하라' });
  assert.ok(initializeLine('x').endsWith('\n'));
});

test('CliTurn: 초기화 응답 뒤에 user 줄을 쓰고, init 도구 목록을 확인한 뒤 결과를 받는다', () => {
  const t = fresh();
  const w = t.onLine(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
  assert.equal(w.type, 'write'); assert.ok((w as any).line.includes('"type":"user"'));
  assert.equal(t.onLine(j({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL], mcp_servers: [] })).type, 'none');
  assert.equal(t.verified, true);
  const r = t.onLine(j({ type: 'result', subtype: 'success', is_error: false, structured_output: { page: 1 }, usage: { input_tokens: 10, output_tokens: 5 } }));
  assert.deepEqual(r, { type: 'done', output: { page: 1 }, usage: { input: 10, output: 5 } });
});

test('cli_refuses_unexpected_tools', () => {
  const t = fresh();
  t.onLine(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
  const r = t.onLine(j({ type: 'system', subtype: 'init', tools: [STRUCTURED_OUTPUT_TOOL, 'Bash'], mcp_servers: [] }));
  assert.equal(r.type, 'fail'); assert.equal((r as any).error.kind, 'unsafe-tools');
  const t2 = fresh(); init(t2);
  const r2 = t2.onLine(j({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }));
  assert.equal(r2.type, 'fail'); assert.equal((r2 as any).error.kind, 'unsafe-tools');
  const t3 = fresh(); init(t3);
  const r3 = t3.onLine(j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'x', input: {} }] } }));
  assert.equal(r3.type, 'fail'); assert.equal((r3 as any).error.kind, 'unsafe-tools');
});

test('CliTurn: 결과가 init 전에 오면 실패', () => {
  const t = fresh();
  t.onLine(j({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize' } }));
  const r = t.onLine(j({ type: 'result', subtype: 'success', structured_output: { page: 1 } }));
  assert.equal(r.type, 'fail'); assert.equal((r as any).error.kind, 'unsafe-tools');
});

test('cli_signed_out: assistant error 또는 401 결과', () => {
  const t = fresh(); init(t);
  t.onLine(j({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Not logged in' }] } }));
  const r = t.onLine(j({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in' }));
  assert.equal(r.type, 'fail'); assert.equal((r as any).error.kind, 'signed-out');
  const t2 = fresh(); init(t2);
  const r2 = t2.onLine(j({ type: 'result', subtype: 'error', is_error: true, api_error_status: 401, result: 'x' }));
  assert.equal((r2 as any).error.kind, 'signed-out');
});

test('CliTurn: 한도 초과는 rate-limit과 풀리는 시각', () => {
  const t = fresh(); init(t);
  t.onLine(j({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1_800_000_000 } }));
  const r = t.onLine(j({ type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: 'limit' }));
  assert.equal(r.type, 'fail');
  const e = (r as any).error as EngineError;
  assert.equal(e.kind, 'rate-limit'); assert.equal(e.resetsAt, 1_800_000_000_000);
});

test('cli_old_version_needs_update: 결과 없이 끝나고 stderr에 unknown option', () => {
  const t = fresh();
  const r = t.onExit(1, "error: unknown option '--json-schema'");
  assert.equal(r.type, 'fail'); assert.equal((r as any).error.kind, 'needs-update');
  assert.equal((fresh().onExit(1, 'Not logged in. Please run /login') as any).error.kind, 'signed-out');
  assert.equal((fresh().onExit(2, '') as any).error.kind, 'other');
});

test('CliTurn: 모르는 control_request에는 error 응답을 쓴다', () => {
  const t = fresh(); init(t);
  const r = t.onLine(j({ type: 'control_request', request_id: 'r9', request: { subtype: 'hook_callback' } }));
  assert.equal(r.type, 'write');
  const o = JSON.parse((r as any).line);
  assert.equal(o.type, 'control_response'); assert.equal(o.response.request_id, 'r9'); assert.equal(o.response.subtype, 'error');
});

test('userLine: 그림이 없으면 text 블록만', () => {
  const u = JSON.parse(userLine(undefined, '초안을 만들라'));
  assert.deepEqual(u.message.content, [{ type: 'text', text: '초안을 만들라' }]);
});
