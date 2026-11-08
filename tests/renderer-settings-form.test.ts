import test from 'node:test';
import assert from 'node:assert/strict';
import { advancedOpenAtStart } from '../src/renderer/lib/settings-form.js';

test('advancedOpenAtStart: 직접 고른 실행 파일·설정 폴더가 있을 때만 펼친다', () => {
  assert.equal(advancedOpenAtStart({}), false); // 기본(자동 찾기·기본 폴더)은 접힘
  assert.equal(advancedOpenAtStart({ cliPath: 'C:\\tools\\claude.exe' }), true);
  assert.equal(advancedOpenAtStart({ configDir: 'C:\\Users\\me\\.claude-max' }), true);
  assert.equal(advancedOpenAtStart({ cliPath: '/usr/local/bin/codex', configDir: '/home/me/.codex-work' }), true);
  assert.equal(advancedOpenAtStart({ cliPath: '  ', configDir: '' }), false); // 빈 글자는 고른 것으로 보지 않는다
});
