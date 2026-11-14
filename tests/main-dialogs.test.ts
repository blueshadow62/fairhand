import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveChoice, leaveDialogOptions, pickFileOptions } from '../src/main/dialogs.js';

test('pickFileOptions: AI 도구 파일은 Windows만 .exe·.cmd로 거르고, 숨김 폴더(~/.local/bin)도 보인다', () => {
  assert.deepEqual(pickFileOptions('exe', 'win32').filters, [{ name: '실행 파일', extensions: ['exe', 'cmd'] }]);
  assert.deepEqual(pickFileOptions('exe', 'darwin').filters, []); // 맥·리눅스 실행 파일은 확장자가 없다
  assert.ok(pickFileOptions('exe', 'darwin').properties.includes('showHiddenFiles'));
  assert.deepEqual(pickFileOptions('roster', 'darwin').filters, [{ name: '명단', extensions: ['xlsx', 'csv'] }]);
});

test('나가기 대화상자: 버튼 셋, 기본은 저장, X(취소)는 나가지 않기', () => {
  const ko = leaveDialogOptions('ko');
  assert.deepEqual(ko.buttons, ['저장 후 나가기', '저장하지 않고 나가기', '나가지 않기']);
  assert.equal(ko.defaultId, 0); assert.equal(ko.cancelId, 2);
  assert.equal(leaveDialogOptions('en').buttons.length, 3);
  assert.equal(leaveChoice(0), 'save'); assert.equal(leaveChoice(1), 'discard'); assert.equal(leaveChoice(2), 'stay'); assert.equal(leaveChoice(-1), 'stay');
});
