import test from 'node:test';
import assert from 'node:assert/strict';
import { menuTemplate } from '../src/main/menu.js';

test('menuTemplate: Windows·리눅스는 메뉴 없음, 맥은 단축키(⌘C·⌘V·⌘Q)가 달린 앱·편집·창 메뉴', () => {
  assert.equal(menuTemplate('win32'), null);
  assert.equal(menuTemplate('linux'), null);
  assert.deepEqual(menuTemplate('darwin')?.map(m => m.role), ['appMenu', 'editMenu', 'windowMenu']);
});
