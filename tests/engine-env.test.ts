import test from 'node:test';
import assert from 'node:assert/strict';
import { childEnv, EFFORT_OVERRIDE_ENV_VARS, STRIPPED_ENV_VARS } from '../src/engine/env.js';

test('childEnv: 과금 경로를 바꾸는 변수를 지우고 원본은 건드리지 않는다', () => {
  const base = { PATH: 'x', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_USE_BEDROCK: '1', HOME: 'h' };
  const e = childEnv(base);
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(e.PATH, 'x');
  assert.equal(e.DISABLE_AUTOUPDATER, '1');
  assert.equal(e.DISABLE_TELEMETRY, '1');
  assert.equal(base.ANTHROPIC_API_KEY, 'k');
  assert.ok(STRIPPED_ENV_VARS.includes('ANTHROPIC_AUTH_TOKEN'));
});

test('childEnv: 부모 Claude Code 세션의 노력 단계 변수를 지워 글눈의 --effort가 적용되게 한다', () => {
  const base = { PATH: 'x', CLAUDE_CODE_EFFORT_LEVEL: 'max' };
  const e = childEnv(base);
  assert.equal(e.CLAUDE_CODE_EFFORT_LEVEL, undefined);
  assert.equal(base.CLAUDE_CODE_EFFORT_LEVEL, 'max');
  assert.ok(EFFORT_OVERRIDE_ENV_VARS.includes('CLAUDE_CODE_EFFORT_LEVEL'));
});

test('childEnv: configDir가 있으면 CLAUDE_CONFIG_DIR로, 없으면 원본 값도 지운다', () => {
  assert.equal(childEnv({ CLAUDE_CONFIG_DIR: 'old' }, { configDir: 'C:\\u\\.claude-max' }).CLAUDE_CONFIG_DIR, 'C:\\u\\.claude-max');
  assert.equal(childEnv({ CLAUDE_CONFIG_DIR: 'old' }).CLAUDE_CONFIG_DIR, 'old'); // 사용자가 셸에서 정한 것은 존중
  assert.equal(childEnv({}, { configDir: '' }).CLAUDE_CONFIG_DIR, undefined);
});
