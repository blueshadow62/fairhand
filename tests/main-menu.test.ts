import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_TEXT, menuTemplate } from '../src/main/menu.js';

const noop = { openGuide() {}, openPrivacy() {}, showAbout() {} };
const items = (lang: 'ko' | 'en') => menuTemplate(lang, noop).flatMap(m => [m, ...((m.submenu as any[]) ?? [])]);
const labels = (lang: 'ko' | 'en') => items(lang).map(i => i.label).filter((l): l is string => typeof l === 'string');

test('메뉴: 한국어가 기본이고 영어로 바꾸면 모든 항목이 영어, 구조는 같다', () => {
  assert.ok(labels('ko').every(l => /[가-힣]/.test(l)));
  assert.ok(labels('en').every(l => !/[가-힣]/.test(l)));
  assert.equal(labels('ko').length, labels('en').length);
  assert.deepEqual(Object.keys(MENU_TEXT.ko).sort(), Object.keys(MENU_TEXT.en).sort());
  const roles = (lang: 'ko' | 'en') => items(lang).map(i => i.role ?? i.type ?? (i.click ? 'click' : 'menu'));
  assert.deepEqual(roles('ko'), roles('en'));
  assert.ok(roles('ko').includes('paste') && roles('ko').includes('quit'));
});
