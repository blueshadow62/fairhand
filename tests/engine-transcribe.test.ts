import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKey } from '../src/core/key.js';
import { loadRules } from '../src/engine/rules.js';
import { EngineError, type RawResult, type TranscribeProvider } from '../src/engine/provider.js';
import { transcribePage, transcribeSet } from '../src/engine/transcribe.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const key = parseKey(readFileSync(path.join(FX, '정답표.json'), 'utf-8'));
const rules = await loadRules();
const good = (page: number) => ({ page, 학년: 3, 반: 1, 번호: page, 이름: null, 식별확신: '확실', 정량: { '1-1': { 답: 'x', 판정: 'X' }, '3-1': { 답: '', 판정: '빈칸' } }, 정성: { E1: { 응답: false, 답: '' } }, 비고: [] });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // 검사용 최소 JPEG 바이트. 모델에 보내지 않는다.

function provider(script: (page: number, call: number) => RawResult | Error): TranscribeProvider & { calls: number } {
  let calls = 0;
  return { id: 'cli', get calls() { return calls; }, async transcribe(input) { calls++; const r = script(input.page, calls); if (r instanceof Error) throw r; return r; } };
}
function sampleSet(pages: number[]): string {
  const d = mkdtempSync(path.join(tmpdir(), 'geulnun-tr-'));
  cpSync(FX, d, { recursive: true });
  mkdirSync(path.join(d, 'pages'), { recursive: true });
  for (const p of pages) writeFileSync(path.join(d, 'pages', `p${String(p).padStart(2, '0')}.jpg`), JPEG);
  return d;
}

test('transcribePage: 성공하면 전사정보가 붙는다', async () => {
  const p = provider(page => ({ output: good(page), model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 2 }));
  const r = await transcribePage(p, { imageJpegBase64: 'AAAA', key, rules, page: 1 }, new AbortController().signal, () => new Date(2026, 10, 6, 9, 0));
  assert.equal(r.transcript.전사정보?.엔진, 'cli'); assert.equal(r.transcript.전사정보?.규칙, 'transcribe-v1'); assert.equal(r.transcript.전사정보?.effort, 'high');
  assert.equal(r.inputTokens, 10);
});

test('transcribePage_retries_invalid_once', async () => {
  const p = provider((page, call) => ({ output: call === 1 ? { ...good(page), page: 99 } : good(page), model: 'm' }));
  const r = await transcribePage(p, { imageJpegBase64: 'AAAA', key, rules, page: 1 }, new AbortController().signal);
  assert.equal(r.transcript.page, 1); assert.equal(p.calls, 2);
  const p2 = provider(page => ({ output: { ...good(page), page: 99 }, model: 'm' }));
  await assert.rejects(transcribePage(p2, { imageJpegBase64: 'AAAA', key, rules, page: 1 }, new AbortController().signal), (e: unknown) => e instanceof EngineError && e.kind === 'invalid-output');
  assert.equal(p2.calls, 2);
});

test('transcribeSet: 장마다 저장하고 실패는 기록하고 계속', async () => {
  const d = sampleSet([4, 5, 6]);
  const p = provider(page => (page === 5 ? new EngineError('refusal', '거절') : { output: good(page), model: 'm' }));
  const seen: number[] = [];
  const r = await transcribeSet(p, d, key, rules, [4, 5, 6], new AbortController().signal, { onProgress: e => seen.push(e.page) });
  assert.deepEqual(r.ok, [4, 6]); assert.deepEqual(r.failed.map(f => f.page), [5]); assert.deepEqual(r.skipped, []);
  assert.ok(existsSync(path.join(d, 'transcripts', 'p04.json')) && !existsSync(path.join(d, 'transcripts', 'p05.json')));
  assert.deepEqual(seen, [4, 5, 6]);
});

test('transcribe_set_skips_existing', async () => {
  const d = sampleSet([1, 4]); // p01.json은 픽스처(선생님 확인본)에 이미 있다
  const before = readFileSync(path.join(d, 'transcripts', 'p01.json'), 'utf-8');
  const p = provider(page => ({ output: good(page), model: 'm' }));
  const r = await transcribeSet(p, d, key, rules, [1, 4], new AbortController().signal);
  assert.deepEqual(r.skipped, [1]); assert.deepEqual(r.ok, [4]);
  assert.equal(readFileSync(path.join(d, 'transcripts', 'p01.json'), 'utf-8'), before);
  const r2 = await transcribeSet(p, d, key, rules, [1], new AbortController().signal, { force: true });
  assert.deepEqual(r2.ok, [1]);
  assert.notEqual(readFileSync(path.join(d, 'transcripts', 'p01.json'), 'utf-8'), before);
});

test('transcribeSet: outDir에 쓰면 transcripts는 그대로', async () => {
  const d = sampleSet([1]);
  const before = readFileSync(path.join(d, 'transcripts', 'p01.json'), 'utf-8');
  const out = path.join(d, '평가', 'cli');
  const r = await transcribeSet(provider(page => ({ output: good(page), model: 'm' })), d, key, rules, [1], new AbortController().signal, { outDir: out });
  assert.deepEqual(r.ok, [1]);
  assert.ok(existsSync(path.join(out, 'p01.json')));
  assert.equal(readFileSync(path.join(d, 'transcripts', 'p01.json'), 'utf-8'), before);
});

test('transcribeSet: 중단하면 그 자리에서 멈춘다', async () => {
  const d = sampleSet([1, 2, 3]);
  const ac = new AbortController();
  const p = provider(page => { if (page === 2) ac.abort(); return { output: good(page), model: 'm' }; });
  const r = await transcribeSet(p, d, key, rules, [1, 2, 3], ac.signal, { force: true });
  assert.ok(r.ok.length <= 2); assert.ok(!r.ok.includes(3));
});
