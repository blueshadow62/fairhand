import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_PROFILE, SettingsStore, applyPatch, defaultSettings, parseSettings } from '../src/main/settings.js';
import { DataError } from '../src/core/types.js';

test('parseSettings: 비었거나 깨진 값은 기본값, 모르는 회전은 0', () => {
  assert.deepEqual(parseSettings(undefined), defaultSettings());
  assert.deepEqual(parseSettings({ 기본회전: 45, 프로필: 'x' }), defaultSettings());
  const s = parseSettings({ 학기폴더: 'D:\\학기', 기본회전: 270, 프로필: [{ id: 'a', 이름: 'Max', 종류: 'cli', configDir: 'C:\\u\\.claude-max' }], 사용중: 'a' });
  assert.equal(s.학기폴더, 'D:\\학기'); assert.equal(s.기본회전, 270); assert.equal(s.사용중, 'a');
  assert.deepEqual(s.프로필.find(p => p.id === 'a'), { id: 'a', 이름: 'Max', 종류: 'cli', configDir: 'C:\\u\\.claude-max' });
});

test('parseSettings: 기본 프로필이 없으면 앞에 넣고, 사용중이 목록에 없으면 기본 프로필로', () => {
  const s = parseSettings({ 프로필: [{ id: 'k', 이름: 'API', 종류: 'api' }], 사용중: '없음' });
  assert.deepEqual(s.프로필.map(p => p.id), ['cli-default', 'k']);
  assert.equal(s.사용중, DEFAULT_PROFILE.id);
});

test('parseSettings: 자동업데이트는 기본 켜짐, false일 때만 꺼짐', () => {
  assert.equal(parseSettings({}).자동업데이트, true);
  assert.equal(parseSettings({ 자동업데이트: false }).자동업데이트, false);
});

test('applyPatch: id 중복·빈 이름은 DataError, 사용중은 목록 안에서만', () => {
  const cur = defaultSettings();
  assert.throws(() => applyPatch(cur, { 프로필: [DEFAULT_PROFILE, { id: 'cli-default', 이름: 'x', 종류: 'cli' }] }), DataError);
  assert.throws(() => applyPatch(cur, { 프로필: [{ id: 'a', 이름: ' ', 종류: 'api' }] }), DataError);
  const s = applyPatch(cur, { 사용중: '없는것' });
  assert.equal(s.사용중, DEFAULT_PROFILE.id);
});

test('SettingsStore: 없으면 기본값, 저장은 원자적이고 다시 읽힌다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-settings-'));
  try {
    const store = new SettingsStore(path.join(dir, 'settings.json'));
    assert.deepEqual(await store.load(), defaultSettings());
    const s = await store.save({ 학기폴더: 'D:\\학기', 기본회전: 90 });
    assert.equal(s.기본회전, 90);
    assert.deepEqual(await new SettingsStore(path.join(dir, 'settings.json')).load(), s);
    assert.ok((await readFile(path.join(dir, 'settings.json'), 'utf-8')).includes('"학기폴더"'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
