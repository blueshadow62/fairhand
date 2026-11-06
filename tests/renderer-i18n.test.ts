import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT, setLanguage, t, type Key } from '../src/renderer/lib/i18n.js';

const keys = (lang: 'ko' | 'en') => Object.keys(DICT[lang]).sort();
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('화면 글 사전: 한국어와 영어의 키가 같고, 치환 자리도 같다', () => {
  assert.deepEqual(keys('ko'), keys('en'));
  for (const k of keys('ko') as Key[]) {
    assert.deepEqual(slots(DICT.en[k]), slots(DICT.ko[k]), `${k}: 치환 자리가 다름`);
    assert.ok(DICT.en[k].length > 0, `${k}: 영어가 비었음`);
    if (k !== 'settings.language') assert.ok(!/[가-힣]/.test(DICT.en[k]), `${k}: 영어에 한글이 있음`); // 언어 라벨은 두 말을 함께 적는다
  }
});

test('t(): 기본은 한국어, 값 치환, 언어 전환', () => {
  assert.equal(t('app.tab.key'), '문항 설정');
  assert.equal(t('run.pagesSaved', { from: 'p08', to: 'p23' }), 'p08~p23 저장했습니다');
  setLanguage('en');
  try {
    assert.equal(t('app.tab.key'), 'Questions');
    assert.equal(t('review.checked', { done: 3, total: 10 }), 'Checked 3/10');
    assert.equal(t('key.rejudgeConfirm', { n: 16 }), 'The key changed. Re-judge the existing 16 pages by exact text?');
  } finally { setLanguage('ko'); }
});
