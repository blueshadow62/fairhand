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

test('parseSettings: 화면색은 sky·dawn·dark만, 없거나 모르는 값은 sky', () => {
  assert.equal(parseSettings({}).화면색, 'sky');
  assert.equal(parseSettings({ 화면색: 'dawn' }).화면색, 'dawn');
  assert.equal(parseSettings({ 화면색: 'dark' }).화면색, 'dark');
  assert.equal(parseSettings({ 화면색: 'pink' }).화면색, 'sky');
  assert.equal(applyPatch(defaultSettings(), { 화면색: 'dark' }).화면색, 'dark');
});

test('parseSettings: Codex 프로필은 실행 파일·로그인 폴더와 명령줄에 안전한 모델 이름만 남긴다', () => {
  const s = parseSettings({ 프로필: [
    { id: 'c', 이름: 'GPT', 종류: 'codex', cliPath: 'C:\\npm\\codex.cmd', configDir: 'C:\\u\\.codex-b', 모델: 'gpt-x.1', 노력: 'xhigh' },
    { id: 'd', 이름: 'GPT2', 종류: 'codex', 모델: 'gpt; rm -rf' },
    { id: 'e', 이름: 'API', 종류: 'api', 모델: 'gpt-x.1' }] });
  const c = s.프로필.find(p => p.id === 'c')!, d = s.프로필.find(p => p.id === 'd')!, e = s.프로필.find(p => p.id === 'e')!;
  assert.deepEqual(c, { id: 'c', 이름: 'GPT', 종류: 'codex', cliPath: 'C:\\npm\\codex.cmd', configDir: 'C:\\u\\.codex-b', 모델: 'gpt-x.1', 노력: 'xhigh' });
  assert.equal(d.모델, undefined);
  assert.equal(e.모델, undefined); // API 키 프로필은 Claude 모델만
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

test('parseSettings: 프로필의 모델·노력은 허용 값만 남는다', () => {
  const s = parseSettings({ 프로필: [{ id: 'a', 이름: 'A', 종류: 'cli', 모델: 'claude-sonnet-5-5', 노력: 'low' }, { id: 'b', 이름: 'B', 종류: 'api', 모델: 'gpt', 노력: '최대' }] });
  const a = s.프로필.find(p => p.id === 'a')!, b = s.프로필.find(p => p.id === 'b')!;
  assert.equal(a.모델, 'claude-sonnet-5-5'); assert.equal(a.노력, 'low');
  assert.equal(b.모델, undefined); assert.equal(b.노력, undefined);
});

test('parseSettings: 경로는 절대 경로만, CLI 파일은 exe·cmd만 남는다', () => {
  const s = parseSettings({ 학기폴더: 'local/학기', 명단: 'C:\\명단.xlsx', 프로필: [
    { id: 'a', 이름: 'A', 종류: 'cli', cliPath: 'claude.exe', configDir: '.claude-max' },
    { id: 'b', 이름: 'B', 종류: 'cli', cliPath: 'C:\\tools\\claude.cmd', configDir: 'C:\\Users\\t\\.claude-max' },
    { id: 'c', 이름: 'C', 종류: 'cli', cliPath: 'C:\\tools\\evil.bat' }] });
  assert.equal(s.학기폴더, null); assert.equal(s.명단, 'C:\\명단.xlsx');
  const a = s.프로필.find(p => p.id === 'a')!, b = s.프로필.find(p => p.id === 'b')!, c = s.프로필.find(p => p.id === 'c')!;
  assert.equal(a.cliPath, undefined); assert.equal(a.configDir, undefined);
  assert.equal(b.cliPath, 'C:\\tools\\claude.cmd'); assert.equal(b.configDir, 'C:\\Users\\t\\.claude-max');
  assert.equal(c.cliPath, undefined);
});
