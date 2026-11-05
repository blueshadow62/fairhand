import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { locateClaude, compareVersion, parseAuthStatus, parseVersion, claudeStatus, MIN_CLI_VERSION } from '../src/engine/status.js';

test('locateClaude: 설정 경로 → 사용자 .local\\bin → PATH 순서', () => {
  const home = 'C:\\Users\\t';
  const exists = (p: string) => p === path.join(home, '.local', 'bin', 'claude.exe');
  assert.deepEqual(locateClaude({ USERPROFILE: home, PATH: '' }, exists), { command: path.join(home, '.local', 'bin', 'claude.exe'), prefixArgs: [] });
  assert.deepEqual(locateClaude({ GEULNUN_CLAUDE_PATH: 'X:\\c.exe', USERPROFILE: home }, () => true), { command: 'X:\\c.exe', prefixArgs: [] });
  assert.equal(locateClaude({ USERPROFILE: home, PATH: 'C:\\nowhere' }, () => false), null);
  const npm = 'C:\\Users\\t\\AppData\\Roaming\\npm';
  const cmdExists = (p: string) => p === path.join(npm, 'claude.cmd') || p === path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js') || p === 'C:\\nodejs\\node.exe';
  assert.deepEqual(locateClaude({ USERPROFILE: home, PATH: `${npm};C:\\nodejs` }, cmdExists),
    { command: 'C:\\nodejs\\node.exe', prefixArgs: [path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')] });
});

test('compareVersion', () => {
  assert.ok(compareVersion('2.1.316', MIN_CLI_VERSION) > 0);
  assert.ok(compareVersion('2.1.200', MIN_CLI_VERSION) < 0);
  assert.equal(compareVersion('2.1.248', '2.1.248'), 0);
  assert.ok(compareVersion('2.10.0', '2.9.9') > 0);
});

test('parseAuthStatus·parseVersion', () => {
  assert.deepEqual(parseAuthStatus('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'), { loggedIn: false, authMethod: 'none', subscriptionType: undefined });
  assert.deepEqual(parseAuthStatus('junk {"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"} trailing'), { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });
  assert.equal(parseAuthStatus('not json'), null);
  assert.equal(parseVersion('2.1.316 (Claude Code)\n'), '2.1.316');
  assert.equal(parseVersion('???'), null);
});

test('claudeStatus: 미설치·옛 버전·미로그인을 구분한다', async () => {
  const run = (answers: Record<string, string>) => async (_p: unknown, args: string[]) => ({ code: 0, stdout: answers[args.join(' ')] ?? '', stderr: '' });
  const fakeLocate = (found: boolean) => () => (found ? { command: 'c', prefixArgs: [] } : null);
  assert.deepEqual(await claudeStatus(run({}), fakeLocate(false)), { installed: false });
  const old = await claudeStatus(run({ '--version': '2.1.100 (Claude Code)', 'auth status --json': '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}' }), fakeLocate(true));
  assert.equal(old.tooOld, true);
  const cur = await claudeStatus(run({ '--version': '2.1.316 (Claude Code)', 'auth status --json': '{"loggedIn":false,"authMethod":"none"}' }), fakeLocate(true));
  assert.deepEqual(cur, { installed: true, version: '2.1.316', tooOld: false, loggedIn: false, authMethod: 'none', subscriptionType: undefined });
});
