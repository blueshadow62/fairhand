import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_PROFILE, SettingsStore, applyPatch, defaultSettings, parseSettings } from '../src/main/settings.js';
import { DataError } from '../src/core/types.js';
import { DEFAULT_ANSWER_POSITIONS } from '../src/shared/ipc.js';

test('parseSettings: 비었거나 깨진 값은 기본값, 모르는 회전은 0', () => {
  assert.deepEqual(parseSettings(undefined), defaultSettings());
  assert.deepEqual(parseSettings({ 기본회전: 45, 프로필: 'x' }), defaultSettings());
  const s = parseSettings({ 학기폴더: 'D:\\학기', 기본회전: 270, 프로필: [{ id: 'a', 이름: 'Max', 종류: 'cli', configDir: 'C:\\u\\.claude-max' }], 사용중: 'a' }, 'win32');
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
  assert.equal(parseSettings({}).자동설치, false); // 받아 두기는 기본 꺼짐, true일 때만 켜짐
  assert.equal(parseSettings({ 자동설치: 'yes' }).자동설치, false);
  assert.equal(parseSettings({ 자동설치: true }).자동설치, true);
});

test('parseSettings: 화면색은 sky·dawn·dark만, 없거나 모르는 값은 sky', () => {
  assert.equal(parseSettings({}).화면색, 'sky');
  assert.equal(parseSettings({ 화면색: 'dawn' }).화면색, 'dawn');
  assert.equal(parseSettings({ 화면색: 'dark' }).화면색, 'dark');
  assert.equal(parseSettings({ 화면색: 'pink' }).화면색, 'sky');
  assert.equal(applyPatch(defaultSettings(), { 화면색: 'dark' }).화면색, 'dark');
});

test('parseSettings: 답 위치 받기는 기본값(꺼짐)을 따르고 true·false만 받는다', () => {
  assert.equal(DEFAULT_ANSWER_POSITIONS, false); // 켜면 모든 세트의 지시문이 바뀐다. 실제 모델로 잰 뒤에 바꾼다
  assert.equal(parseSettings({}).답위치, false);
  assert.equal(parseSettings({ 답위치: 'yes' }).답위치, false);
  assert.equal(parseSettings({ 답위치: true }).답위치, true);
  assert.equal(applyPatch(applyPatch(defaultSettings(), { 답위치: true }), { 언어: 'en' }).답위치, true);
});

test('parseSettings: Codex 프로필은 실행 파일·로그인 폴더와 명령줄에 안전한 모델 이름만 남긴다', () => {
  const s = parseSettings({ 프로필: [
    { id: 'c', 이름: 'GPT', 종류: 'codex', cliPath: 'C:\\npm\\codex.cmd', configDir: 'C:\\u\\.codex-b', 모델: 'gpt-x.1', 노력: 'xhigh' },
    { id: 'd', 이름: 'GPT2', 종류: 'codex', 모델: 'gpt; rm -rf' },
    { id: 'e', 이름: 'API', 종류: 'api', 모델: 'gpt-x.1' }] }, 'win32');
  const c = s.프로필.find(p => p.id === 'c')!, d = s.프로필.find(p => p.id === 'd')!, e = s.프로필.find(p => p.id === 'e')!;
  assert.deepEqual(c, { id: 'c', 이름: 'GPT', 종류: 'codex', cliPath: 'C:\\npm\\codex.cmd', configDir: 'C:\\u\\.codex-b', 모델: 'gpt-x.1', 노력: 'xhigh' });
  assert.equal(d.모델, undefined);
  assert.equal(e.모델, undefined); // API 키 프로필은 Claude 모델만
});

test('parseSettings: Gemini 프로필은 목록의 모델만, 실행 파일·로그인 폴더는 두지 않는다', () => {
  const s = parseSettings({ 프로필: [
    { id: 'g', 이름: 'Gemini', 종류: 'gemini', 모델: 'gemini-3.8-flash', 노력: 'low', cliPath: 'C:\\x\\a.exe', configDir: 'C:\\x' },
    { id: 'h', 이름: 'Gemini2', 종류: 'gemini', 모델: 'gemini-2.5-pro' }] });
  assert.deepEqual(s.프로필.find(p => p.id === 'g'), { id: 'g', 이름: 'Gemini', 종류: 'gemini', 모델: 'gemini-3.8-flash', 노력: 'low' });
  assert.equal(s.프로필.find(p => p.id === 'h')!.모델, undefined);
});

test('parseSettings: OpenAI 프로필은 목록의 모델만, 실행 파일·로그인 폴더는 두지 않는다', () => {
  const s = parseSettings({ 프로필: [
    { id: 'o', 이름: 'GPT', 종류: 'openai', 모델: 'gpt-6.1-sol', 노력: 'max', cliPath: 'C:\\x\\a.exe', configDir: 'C:\\x' },
    { id: 'p', 이름: 'GPT2', 종류: 'openai', 모델: 'gpt-4o' }] }, 'win32');
  assert.deepEqual(s.프로필.find(p => p.id === 'o'), { id: 'o', 이름: 'GPT', 종류: 'openai', 모델: 'gpt-6.1-sol', 노력: 'max' });
  assert.equal(s.프로필.find(p => p.id === 'p')!.모델, undefined); // 목록 밖 모델은 버리고 기본 모델을 쓴다
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

test('parseSettings: 전사기록은 0 이상의 유한한 수 다섯 개인 항목만 두고, 없거나 다 틀리면 칸을 두지 않는다. 다른 칸 저장에도 그대로', () => {
  const ok = { 장: 3, 초: 120.5, 토큰장: 3, 입력: 9000, 출력: 2400 };
  const s = parseSettings({ 전사기록: { 'api|claude-opus-5-5|medium': ok, 'cli||medium': { ...ok, 초: -1 }, x: { ...ok, 장: '3' }, '': ok, y: null, z: { ...ok, 출력: Infinity } } });
  assert.deepEqual(s.전사기록, { 'api|claude-opus-5-5|medium': ok });
  assert.equal('전사기록' in parseSettings({ 전사기록: { a: { 장: Number.NaN } } }), false);
  assert.equal('전사기록' in parseSettings({}), false);
  assert.deepEqual(applyPatch(s, { 언어: 'en' }).전사기록, s.전사기록);
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
    { id: 'c', 이름: 'C', 종류: 'cli', cliPath: 'C:\\tools\\evil.bat' }] }, 'win32');
  assert.equal(s.학기폴더, null); assert.equal(s.명단, 'C:\\명단.xlsx');
  const a = s.프로필.find(p => p.id === 'a')!, b = s.프로필.find(p => p.id === 'b')!, c = s.프로필.find(p => p.id === 'c')!;
  assert.equal(a.cliPath, undefined); assert.equal(a.configDir, undefined);
  assert.equal(b.cliPath, 'C:\\tools\\claude.cmd'); assert.equal(b.configDir, 'C:\\Users\\t\\.claude-max');
  assert.equal(c.cliPath, undefined);
});

test('parseSettings(맥·리눅스): /로 시작하는 절대 경로, 확장자 없는 실행 파일도 받는다', () => {
  const s = parseSettings({ 학기폴더: '/Users/t/학기', 명단: 'C:\\명단.xlsx', 프로필: [
    { id: 'a', 이름: 'A', 종류: 'cli', cliPath: '/Users/t/.local/bin/claude', configDir: '/Users/t/.claude-max' },
    { id: 'b', 이름: 'B', 종류: 'codex', cliPath: 'bin/codex' }] }, 'darwin');
  assert.equal(s.학기폴더, '/Users/t/학기');
  assert.equal(s.명단, null); // 맥에서 C:\ 는 절대 경로가 아니다
  assert.equal(s.프로필.find(p => p.id === 'a')!.cliPath, '/Users/t/.local/bin/claude');
  assert.equal(s.프로필.find(p => p.id === 'a')!.configDir, '/Users/t/.claude-max');
  assert.equal(s.프로필.find(p => p.id === 'b')!.cliPath, undefined); // 상대 경로는 버린다
});
