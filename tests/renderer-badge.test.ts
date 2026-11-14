import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeLabel, isSubscription, kindKey, modelLabel, sameAsKind } from '../src/renderer/lib/badge.js';
import { t } from '../src/renderer/lib/i18n.js';

test('sameAsKind: 시작 화면 AI 프로필 줄도 같은 기준(비었거나 종류와 같으면 겹침)', () => {
  assert.equal(sameAsKind('Claude Code', 'Claude Code'), true);
  assert.equal(sameAsKind(' codex ', 'Codex'), true);
  assert.equal(sameAsKind('', 'API'), true);
  assert.equal(sameAsKind('학교 계정', 'Claude Code'), false);
});

test('badgeLabel: 프로필 이름이 종류 이름과 같으면 한 번만', () => {
  assert.equal(badgeLabel('Claude Code', 'Claude Code', 'Opus 5.5'), 'Claude Code · Opus 5.5'); // 기본 프로필
  assert.equal(badgeLabel('  claude CODE ', 'Claude Code', 'Opus 5.5'), 'Claude Code · Opus 5.5'); // 앞뒤 공백·대소문자는 무시
  assert.equal(badgeLabel('Gemini API', 'Gemini API', 'gemini-4-argon'), 'Gemini API · gemini-4-argon');
});

test('badgeLabel: 이름이 다르면 셋 다, 비었으면 종류부터', () => {
  assert.equal(badgeLabel('학교 계정', 'Claude Code', 'Sonnet 5.5'), '학교 계정 · Claude Code · Sonnet 5.5');
  assert.equal(badgeLabel('Claude Code 2', 'Claude Code', 'Opus 5.5'), 'Claude Code 2 · Claude Code · Opus 5.5'); // 일부만 같으면 다른 이름
  assert.equal(badgeLabel(' 내 키 ', 'API 키', 'Opus 5.5'), '내 키 · API 키 · Opus 5.5'); // 이름의 앞뒤 공백은 떼고 적는다
  assert.equal(badgeLabel('  ', 'Codex', '기본 모델'), 'Codex · 기본 모델');
});

test('modelLabel·kindKey·isSubscription: 왼쪽 아래 AI 표시와 전사 칸이 같은 이름과 청구 방식을 쓴다', () => {
  assert.equal(modelLabel({ 종류: 'cli' }, '기본 모델'), 'Opus 5.5');
  assert.equal(modelLabel({ 종류: 'api', 모델: 'claude-sonnet-5-5' }, '기본 모델'), 'Sonnet 5.5');
  assert.equal(modelLabel({ 종류: 'codex' }, '기본 모델'), '기본 모델');
  assert.equal(modelLabel({ 종류: 'codex', 모델: 'gpt-6.1-codex' }, '기본 모델'), 'gpt-6.1-codex');
  assert.equal(modelLabel({ 종류: 'gemini' }, '기본 모델'), 'gemini-4-argon');
  assert.equal(modelLabel({ 종류: 'openai', 모델: 'gpt-6.1-sol' }, '기본 모델'), 'gpt-6.1-sol');
  assert.deepEqual((['cli', 'api', 'codex', 'gemini', 'openai'] as const).map(k => t(kindKey(k))), ['Claude Code', 'API 키', 'Codex', 'Gemini API', 'OpenAI API']);
  assert.deepEqual((['cli', 'api', 'codex', 'gemini', 'openai'] as const).map(isSubscription), [true, false, true, false, false]);
});
