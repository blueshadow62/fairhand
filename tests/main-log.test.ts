import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installLog, logFileName, logLine, pruneOld } from '../src/main/log.js';

test('logLine·logFileName: 시각·수준·메시지, Error는 메시지와 스택 첫 줄', () => {
  const d = new Date(Date.UTC(2026, 10, 6, 1, 2, 3));
  assert.equal(logFileName(d), '2026-11-06.log');
  const e = new Error('터짐'); e.stack = 'Error: 터짐\n    at a.js:1\n    at b.js:2';
  const line = logLine('error', ['[ipc]', e], d);
  assert.ok(line.startsWith('2026-11-06T01:02:03.000Z [error] [ipc] 터짐'));
  assert.ok(line.includes('at a.js:1') && !line.includes('b.js'));
  assert.ok(line.endsWith('\n'));
});

test('pruneOld: 14일 지난 로그만, 다른 파일은 두기', () => {
  const today = new Date(2026, 10, 20);
  assert.deepEqual(pruneOld(['2026-11-01.log', '2026-11-06.log', '2026-11-20.log', 'other.txt'], today), ['2026-11-01.log']);
});

test('installLog: console.error가 파일에도 남고, 오래된 파일은 지워진다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-log-'));
  const orig = console.error; const seen: unknown[][] = [];
  const fake = (...a: unknown[]) => { seen.push(a); };
  console.error = fake; // 가로채기 전의 콘솔(검사 출력을 어지럽히지 않게)
  try {
    await writeFile(path.join(dir, '2020-01-01.log'), 'old');
    const log = installLog(dir, () => new Date(2026, 10, 6, 10, 0, 0));
    try { log.write('error', '시험', 1); console.error('콘솔로도'); } finally { log.close(); }
    assert.equal(console.error, fake, 'close() 뒤에는 가로채기 전으로');
    assert.deepEqual(seen, [['콘솔로도']], '원래 콘솔 출력도 유지');
    const names = await readdir(dir);
    assert.ok(!names.includes('2020-01-01.log'));
    const text = await readFile(path.join(dir, '2026-11-06.log'), 'utf-8');
    assert.ok(text.includes('[error] 시험 1') && text.includes('콘솔로도'));
  } finally { console.error = orig; await rm(dir, { recursive: true, force: true }); }
});
