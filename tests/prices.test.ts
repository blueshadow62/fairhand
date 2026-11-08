import test from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_MODELS, MODELS, OPENAI_MODELS } from '../src/shared/ipc.js';
import { costUsd, priceOf, PRICES, priceVars } from '../src/shared/prices.js';
import { setLanguage, t } from '../src/renderer/lib/i18n.js';

test('단가 표: Anthropic 가격표(2026-10-06)와 앱의 OpenAI 안내, 고를 수 있는 API 모델은 모두 있고 Gemini는 없다', () => {
  assert.deepEqual(PRICES['claude-opus-5-5'], { 입력: 4, 출력: 20 });
  assert.deepEqual(PRICES['claude-sonnet-5-5'], { 입력: 2, 출력: 10 });
  assert.deepEqual(PRICES['gpt-6-astra'], { 입력: 10, 출력: 50 });
  assert.deepEqual(PRICES['gpt-6.1-sol'], { 입력: 2, 출력: 10 });
  for (const m of [...MODELS, ...OPENAI_MODELS]) assert.ok(PRICES[m], m);
  for (const m of GEMINI_MODELS) assert.equal(PRICES[m], undefined, m);
});

test('priceOf: API 프로필은 그 모델(비우면 기본 모델)의 단가, 구독·Gemini·모르는 모델은 추정하지 않는다', () => {
  assert.deepEqual(priceOf({ 종류: 'api' }), { 입력: 4, 출력: 20 });
  assert.deepEqual(priceOf({ 종류: 'api', 모델: 'claude-sonnet-5-5' }), { 입력: 2, 출력: 10 });
  assert.deepEqual(priceOf({ 종류: 'openai' }), { 입력: 10, 출력: 50 });
  assert.deepEqual(priceOf({ 종류: 'openai', 모델: 'gpt-6.1-sol' }), { 입력: 2, 출력: 10 });
  for (const p of [{ 종류: 'cli' as const, 모델: 'claude-opus-5-5' }, { 종류: 'codex' as const }, { 종류: 'gemini' as const, 모델: 'gemini-4-argon' }, { 종류: 'api' as const, 모델: 'claude-opus-4-1' }])
    assert.equal(priceOf(p), null, JSON.stringify(p));
  assert.equal(priceOf(undefined), null);
  assert.equal(costUsd({ 입력: 4, 출력: 20 }, 1_000_000, 500_000), 14);
});

test('설정의 모델 안내 글은 단가 표의 숫자를 쓴다(한국어·영어)', () => {
  const ko = t('settings.modelHelp', priceVars()), oa = t('settings.openai.modelHelp', priceVars());
  assert.ok(ko.includes('Opus 5.5가 백만 토큰당 입력 $4·출력 $20, Sonnet 5.5가 $2·$10'), ko);
  assert.ok(oa.includes('Astra가 입력 $10·출력 $50, Sol이 $2·$10'), oa);
  setLanguage('en');
  try {
    assert.ok(t('settings.modelHelp', priceVars()).includes('$4/$20 per million tokens for Opus 5.5 and $2/$10 for Sonnet 5.5'));
    assert.ok(t('settings.openai.modelHelp', priceVars()).includes('Astra $10 input / $50 output, Sol $2 / $10'));
  } finally { setLanguage('ko'); }
  for (const s of [ko, oa]) assert.ok(!/\{\w+\}/.test(s), s); // 채우지 못한 자리가 없다
});
