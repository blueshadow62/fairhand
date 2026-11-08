import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKey } from '../src/core/key.js';
import { mergeCases } from '../src/core/rejudge.js';
import { loadSet } from '../src/core/setio.js';
import type { AnswerKey, Case } from '../src/core/types.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const key = parseKey(readFileSync(path.join(FX, '정답표.json'), 'utf-8')); // 정량 1-1·3-1, 정성 E1
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
const c = (단위: string, 답: string, 판정: 'O' | 'X', 출처 = '검토'): Case => ({ 단위, 답, 판정, 일시: '2026-11-08T00:00:00.000Z', 출처 });

test('mergeCases: 파일의 사례가 기준, 화면에만 있는 답은 더하고, 같은 답은 파일을 따르고, 지운 단위의 사례는 버린다', () => {
  const file = [c('1-1', '가나', 'X', '문항별 검토'), c('3-1', '열심히', 'O')];
  const sent = [c('1-1', ' 가나.', 'O', '옛 화면'), c('1-1', '다라', 'O', '가져오기'), c('9-9', '없는 단위', 'O')];
  assert.deepEqual(mergeCases(file, sent, key), [file[0], file[1], sent[1]]);
  assert.deepEqual(mergeCases(file, [], key), file); // 화면이 열 때 사례가 없었어도 파일의 사례는 남긴다
  assert.deepEqual(mergeCases(undefined, sent, key), [sent[0], sent[1]]); // 파일이 없으면 화면의 사례(같은 단위가 있는 것만)
  assert.deepEqual(mergeCases(file, undefined, { 정량: key.정량.filter(u => u.id !== '3-1') }), [file[0]]);
  assert.deepEqual(mergeCases(undefined, undefined, key), []);
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-cases-'));
  const set = path.join(dir, '세트A');
  await cp(FX, set, { recursive: true });
  await mkdir(path.join(set, 'pages'), { recursive: true });
  const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
  return { dir, set, bridge };
}

test('saveKey: 화면이 열 때 읽은 사례 목록으로 저장해도 그사이 검토에서 쌓인 사례가 남는다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    const screen: AnswerKey = structuredClone((await loadSet(set)).key); // 문항 설정 화면이 세트를 연 때(사례 없음)
    await bridge.setUnitResults(set, { 단위: '1-1', 항목: [{ page: 1, 판정: 'X' }, { page: 2, 판정: 'X' }], 사례기록: true }); // 문항별 검토
    await bridge.applyCase(set, { 단위: '3-1', 답: '열심히', 판정: 'O', page: 1 }); // 답안지별 검토
    const saved = (await bridge.saveKey(set, { ...screen, 채점규칙: { 맞춤법: '불인정' } })).key;
    assert.deepEqual(saved.사례?.map(x => [x.단위, x.답, x.판정]), [['1-1', '가나', 'X'], ['3-1', '열심히', 'O']]);
    assert.deepEqual((await loadSet(set)).key.사례, saved.사례);
    assert.equal((await loadSet(set)).key.채점규칙?.맞춤법, '불인정');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveKey: 가져온 정답표의 사례는 파일에 없으면 더하고, 같은 답이면 파일을 따른다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    await bridge.applyCase(set, { 단위: '1-1', 답: '가나', 판정: 'X', page: 1 });
    const imported = [c('1-1', '가나', 'O', '다른 세트'), c('1-1', '마바', 'O', '다른 세트')];
    const saved = (await bridge.saveKey(set, { ...key, 사례: imported })).key;
    assert.deepEqual(saved.사례?.map(x => [x.단위, x.답, x.판정, x.출처]), [['1-1', '가나', 'X', '검토 p01'], ['1-1', '마바', 'O', '다른 세트']]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveKey: 단위를 지운 정답표는 그 단위의 사례(파일·화면 모두)를 버리고 저장된다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    await bridge.applyCase(set, { 단위: '3-1', 답: '열심히', 판정: 'O', page: 1 });
    await bridge.applyCase(set, { 단위: '1-1', 답: '가나', 판정: 'X', page: 1 });
    const screen = { ...key, 정량: key.정량.filter(u => u.id !== '3-1'), 사례: [c('3-1', '열심히', 'O')] }; // 화면이 들고 있던 옛 사례
    const saved = (await bridge.saveKey(set, screen)).key;
    assert.deepEqual(saved.사례?.map(x => x.단위), ['1-1']);
    const all = (await bridge.saveKey(set, { ...key, 정량: key.정량.filter(u => u.id === '3-1') })).key;
    assert.equal(all.사례, undefined); // 남는 사례가 없으면 칸을 두지 않는다
  } finally { await rm(dir, { recursive: true, force: true }); }
});
