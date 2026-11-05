import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SecretStore, type SafeStorageLike } from '../src/main/secrets.js';
import { DataError } from '../src/core/types.js';

const fake = (ok = true): SafeStorageLike => ({
  isEncryptionAvailable: () => ok,
  encryptString: (s) => Buffer.from('sealed:' + Buffer.from(s, 'utf-8').toString('base64')),
  decryptString: (b) => { const t = b.toString(); if (!t.startsWith('sealed:')) throw new Error('bad'); return Buffer.from(t.slice(7), 'base64').toString('utf-8'); },
});

test('SecretStore: 저장하면 파일에 평문이 없고, 보기엔 끝4자만, 열면 원문', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-secrets-'));
  try {
    const f = path.join(dir, 'secrets.json');
    const store = new SecretStore(f, fake());
    assert.deepEqual(await store.view('p1'), { 저장됨: false });
    const v = await store.set('p1', 'sk-ant-api03-ABCDEFGH1234');
    assert.deepEqual(v, { 저장됨: true, 끝4자: '1234', 열림: true });
    const text = await readFile(f, 'utf-8');
    assert.ok(!text.includes('sk-ant-api03-ABCDEFGH1234'));
    assert.equal(await store.open('p1'), 'sk-ant-api03-ABCDEFGH1234');
    await store.clear('p1');
    assert.deepEqual(await store.view('p1'), { 저장됨: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('SecretStore: 암호화를 못 쓰면 저장을 거절한다(평문 금지)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-secrets-'));
  try {
    await assert.rejects(new SecretStore(path.join(dir, 's.json'), fake(false)).set('p1', 'k'), DataError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('SecretStore: 다른 PC에서 봉인된 값은 열림 false로 보이고 open은 null', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-secrets-'));
  try {
    const f = path.join(dir, 's.json');
    await new SecretStore(f, fake()).set('p1', 'abcd1234');
    const other: SafeStorageLike = { ...fake(), decryptString: () => { throw new Error('다른 키'); } };
    const store = new SecretStore(f, other);
    assert.deepEqual(await store.view('p1'), { 저장됨: true, 끝4자: '1234', 열림: false });
    assert.equal(await store.open('p1'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('SecretStore: 빈 키·공백 키는 거절', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-secrets-'));
  try { await assert.rejects(new SecretStore(path.join(dir, 's.json'), fake()).set('p1', '   '), DataError); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
