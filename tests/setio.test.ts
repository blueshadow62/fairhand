import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSet, checkAllTranscribed, saveTranscript, transcriptFileName, listPages, removePage, loadUploads, appendUpload } from '../src/core/setio.js';
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
  assert.equal(transcripts[1]!.식별확신, '추정');
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
  const t = { ...transcripts[1]!, 확인완료: true };
  await saveTranscript(d, t);
  const raw = readFileSync(path.join(d, 'transcripts', 'p02.json'), 'utf-8');
  assert.ok(raw.includes('"식별확신": "추정"'));
  assert.ok(!raw.includes('이름확신'));
  assert.ok(raw.includes('"확인완료": true'));
  const { transcripts: again } = await loadSet(d);
  assert.equal(again[1]!.확인완료, true);
});

test('loadSet_page_mismatch_stops: 파일 이름과 안의 page가 다르면 멈춘다', async () => {
  const d = sample();
  writeFileSync(path.join(d, 'transcripts', 'p04.json'),
    JSON.stringify({ page: 5, 식별확신: '불명', 정량: {}, 정성: {}, 비고: [] }), 'utf-8');
  await assert.rejects(loadSet(d), (e: unknown) => e instanceof DataError && /p04\.json/.test(e.message) && /page/.test(e.message));
});

test('removePage: 그림과 전사를 지우고 번호는 비워 둔다', async () => {
  const d = sample();
  mkdirSync(path.join(d, 'pages'), { recursive: true });
  for (const p of [1, 2, 3, 4]) writeFileSync(path.join(d, 'pages', `p0${p}.jpg`), 'x');
  assert.deepEqual(await removePage(d, 2), { 전사있었음: true });
  assert.deepEqual(await listPages(d), [1, 3, 4]);
  assert.ok(!(await loadSet(d)).transcripts.some(t => t.page === 2));
  assert.deepEqual(await removePage(d, 4), { 전사있었음: false }); // 전사 없는 장
  await assert.rejects(removePage(d, 2), (e: unknown) => e instanceof DataError && /p02/.test(e.message)); // 이미 없는 장
  await assert.rejects(removePage(d, 0), DataError);
});

test('uploads: 기록이 없으면 빈 배열, 더하면 이어진다', async () => {
  const d = sample();
  assert.deepEqual(await loadUploads(d), []);
  const r = { 이름: 'a.pdf', 크기: 10, 지문: 'ab', 장수: 2, 시작: 1, 끝: 2, 일시: '2026-11-06T00:00:00.000Z' };
  await appendUpload(d, r); await appendUpload(d, { ...r, 이름: 'b.pdf', 시작: 3, 끝: 4 });
  const all = await loadUploads(d);
  assert.equal(all.length, 2); assert.equal(all[1]!.이름, 'b.pdf');
  writeFileSync(path.join(d, '올린파일.json'), '{깨짐', 'utf-8');
  assert.deepEqual(await loadUploads(d), []); // 깨진 기록은 빈 것으로(올리기를 막지 않는다)
  await appendUpload(d, r);
  assert.equal(readFileSync(path.join(d, '올린파일.json.깨짐'), 'utf-8'), '{깨짐'); // 덮어쓰지 않고 옆으로
  assert.equal((await loadUploads(d)).length, 1);
});

test('listPages: 프로그램이 쓰는 이름(p01, p100)만 인식하고 p1.jpg·P01.JPG는 무시', async () => {
  const d = sample();
  mkdirSync(path.join(d, 'pages'), { recursive: true });
  for (const n of ['p01.jpg', 'p100.jpg', 'p1.jpg', 'P02.JPG', 'p03.jpeg']) writeFileSync(path.join(d, 'pages', n), 'x');
  assert.deepEqual(await listPages(d), [1, 100]);
});
