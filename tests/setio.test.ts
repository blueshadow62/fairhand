import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSet, checkAllTranscribed, saveTranscript, transcriptFileName, listPages } from '../src/core/setio.js';
import { DataError } from '../src/core/types.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
/** cpSync는 GitHub의 Node 22(Windows)에서 프로세스째 죽어(0xC0000409) 직접 복사한다 */
function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), t = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, t); else copyFileSync(s, t);
  }
}
function sample(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'geulnun-set-'));
  copyDirSync(FX, d);
  return d;
}

test('transcriptFileName: 두 자리, 100 이상은 그대로', () => {
  assert.equal(transcriptFileName(7), 'p07.json');
  assert.equal(transcriptFileName(100), 'p100.json');
});

test('loadSet: 정답표와 전사를 읽는다', async () => {
  const { key, transcripts } = await loadSet(sample());
  assert.equal(key.세트, '세트샘플');
  assert.deepEqual(transcripts.map(t => t.page), [1, 2, 3]);
  assert.equal(transcripts[1].식별확신, '추정');
});

test('loadSet_sorts_by_page_number: p100이 p99 뒤에 온다', async () => {
  const d = sample();
  for (const p of [99, 100]) writeFileSync(path.join(d, 'transcripts', transcriptFileName(p)),
    JSON.stringify({ page: p, 학년: 3, 반: 1, 번호: p, 식별확신: '확실', 정량: {}, 정성: {}, 비고: [] }), 'utf-8');
  const { transcripts } = await loadSet(d);
  assert.deepEqual(transcripts.map(t => t.page), [1, 2, 3, 99, 100]);
});

test('loadSet: 깨진 전사는 파일명과 함께 멈춘다', async () => {
  const d = sample();
  writeFileSync(path.join(d, 'transcripts', 'p04.json'), '{깨짐', 'utf-8');
  await assert.rejects(loadSet(d), (e: unknown) => e instanceof DataError && /p04\.json/.test(e.message));
});

test('untranscribed_page_stops: 전사 없는 장이 있으면 멈춘다', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'geulnun-'));
  mkdirSync(path.join(d, 'pages')); mkdirSync(path.join(d, 'transcripts'));
  await assert.rejects(checkAllTranscribed(d), /전사/);
  writeFileSync(path.join(d, 'pages', 'p01.jpg'), ''); writeFileSync(path.join(d, 'pages', 'p02.jpg'), '');
  writeFileSync(path.join(d, 'transcripts', 'p01.json'), '');
  await assert.rejects(checkAllTranscribed(d), /p02/);
  writeFileSync(path.join(d, 'transcripts', 'p02.json'), '');
  await checkAllTranscribed(d);
  assert.deepEqual(await listPages(d), [1, 2]);
});

test('saveTranscript: 새 양식으로만 저장하고 임시 파일을 남기지 않는다', async () => {
  const d = sample();
  const { transcripts } = await loadSet(d);
  const t = { ...transcripts[1], 확인완료: true };
  await saveTranscript(d, t);
  const raw = readFileSync(path.join(d, 'transcripts', 'p02.json'), 'utf-8');
  assert.ok(raw.includes('"식별확신": "추정"'));
  assert.ok(!raw.includes('이름확신'));
  assert.ok(raw.includes('"확인완료": true'));
  const { transcripts: again } = await loadSet(d);
  assert.equal(again[1].확인완료, true);
});

test('loadSet_page_mismatch_stops: 파일 이름과 안의 page가 다르면 멈춘다', async () => {
  const d = sample();
  writeFileSync(path.join(d, 'transcripts', 'p04.json'),
    JSON.stringify({ page: 5, 식별확신: '불명', 정량: {}, 정성: {}, 비고: [] }), 'utf-8');
  await assert.rejects(loadSet(d), (e: unknown) => e instanceof DataError && /p04\.json/.test(e.message) && /page/.test(e.message));
});
