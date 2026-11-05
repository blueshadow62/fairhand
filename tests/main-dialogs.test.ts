import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveChoice, leaveDialogOptions } from '../src/main/dialogs.js';

test('나가기 대화상자: 버튼 셋, 기본은 저장, X(취소)는 나가지 않기', () => {
  const ko = leaveDialogOptions('ko');
  assert.deepEqual(ko.buttons, ['저장 후 나가기', '저장하지 않고 나가기', '나가지 않기']);
  assert.equal(ko.defaultId, 0); assert.equal(ko.cancelId, 2);
  assert.equal(leaveDialogOptions('en').buttons.length, 3);
  assert.equal(leaveChoice(0), 'save'); assert.equal(leaveChoice(1), 'discard'); assert.equal(leaveChoice(2), 'stay'); assert.equal(leaveChoice(-1), 'stay');
});
