import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { keyProblems, parseKey } from '../src/core/key.js';
import { matchRoster } from '../src/core/roster.js';
import type { Student, Transcript } from '../src/core/types.js';
import { imageToSend, maskBgra } from '../src/engine/privacy.js';
import { toTranscript, type RawResult, type TranscribeProvider } from '../src/engine/provider.js';
import { loadRules, systemPrompt } from '../src/engine/rules.js';
import { transcribeSet } from '../src/engine/transcribe.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const rect = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
const masked = { ...key, 이름가림: rect };

const k = { ...key, 대상: { 학년: 2, 반: [2] } };
const st = (반: number, 번호: number, 이름: string): Student => ({ 학년: 2, 반, 번호, 이름 });
const roster = [st(2, 2, '나가온'), st(2, 3, '나다슬'), st(2, 4, '나해람'), st(2, 8, '라윤솔'), st(2, 9, '라태빛'), st(6, 4, '나해봄')];
const tr = (o: Partial<Transcript>): Transcript => ({ page: 1, 학년: 2, 반: 2, 번호: 2, 이름: '나가온', 식별확신: '확실', 정량: {}, 정성: {}, 비고: [], ...o });

test('matchRoster: 번호와 이름이 맞으면 그대로', () => {
  const t = tr({});
  const r = matchRoster(t, k, roster);
  assert.equal(r.transcript, t); assert.equal(r.변경, null);
  assert.equal(matchRoster(tr({ 이름: '나가 온' }), k, roster).변경, null);
});

test('matchRoster: 실제 오독(같은 번호, 비슷한 이름)은 명단 이름으로, 추정과 근거를 남긴다', () => {
  for (const [읽음, 번호, 맞음] of [['나가율', 2, '나가온'], ['나보슬', 3, '나다슬'], ['라원솔', 8, '라윤솔']] as const) {
    const r = matchRoster(tr({ 이름: 읽음, 번호 }), k, roster).transcript;
    assert.equal(r.이름, 맞음); assert.equal(r.번호, 번호); assert.equal(r.식별확신, '추정');
    assert.ok(r.비고.some(b => b.includes(읽음) && b.includes(맞음)));
  }
});

test('matchRoster: 이름이 정확히 다른 학생이면 이름 우선, 번호를 고친다', () => {
  const r = matchRoster(tr({ 이름: '라태빛', 번호: 2 }), k, roster).transcript;
  assert.equal(r.번호, 9); assert.equal(r.식별확신, '추정');
  assert.ok(r.비고[0]!.includes('번호 불일치'));
});

test('matchRoster: 대상 반에 없는 학생을 비슷한 대상 반 학생으로 고치지 않는다', () => {
  const r = matchRoster(tr({ 이름: '나해봄', 번호: 4 }), k, roster).transcript; // 2반 4번 나해람과 '박'이 겹치지만 명단에 6반 4번 나해봄이 있다
  assert.equal(r.이름, '나해봄'); assert.equal(r.반, 2); assert.equal(r.식별확신, '추정');
  assert.ok(r.비고[0]!.includes('6반 4번') && r.비고[0]!.includes('대상 반'));
});

test('matchRoster: 닮지 않은 이름은 고치지 않고 비고에 적는다', () => {
  const r = matchRoster(tr({ 이름: '도미솔' }), k, roster).transcript;
  assert.equal(r.이름, '도미솔'); assert.equal(r.식별확신, '추정');
  assert.ok(r.비고[0]!.startsWith('명단 대조 실패:'));
});

test('matchRoster: 번호와 이름이 함께 어긋나면 다른 학생으로 옮기지 않는다(실제 사례)', () => {
  const big = [...roster, st(6, 15, '라정겸')];
  const k26 = { ...k, 대상: { 학년: 2, 반: [2, 6] } };
  // 6반 15번으로 읽었으면 다른 반의 더 닮은 이름(2반 9번 라태빛)이 아니라 같은 번호의 라정겸
  assert.equal(matchRoster(tr({ 이름: '라지빛', 반: 6, 번호: 15 }), k26, big).transcript.이름, '라정겸');
  // 대상 반이 빠져 그 번호가 없으면 라태빛으로 옮기지 않는다
  const noClass = matchRoster(tr({ 이름: '라지빛', 번호: 15 }), k, big).transcript;
  assert.equal(noClass.이름, '라지빛'); assert.equal(noClass.번호, 15); assert.ok(noClass.비고[0]!.startsWith('명단 대조 실패:'));
  // 같은 번호 학생과 글자가 겹쳐도 같은 반의 다른 학생이 더 닮았으면 고르지 않는다
  const conflict = matchRoster(tr({ 이름: '나가율', 번호: 3 }), k, roster).transcript;
  assert.equal(conflict.이름, '나가율'); assert.equal(conflict.번호, 3); assert.ok(conflict.비고[0]!.includes('고르지 못함'));
});

test('matchRoster: 번호를 못 읽었으면 이름이 한 글자 다른 학생이 하나일 때만 맞춘다', () => {
  const r = matchRoster(tr({ 이름: '라태별', 번호: null }), k, roster).transcript;
  assert.equal(r.이름, '라태빛'); assert.equal(r.번호, 9); assert.equal(r.식별확신, '추정');
  assert.ok(matchRoster(tr({ 이름: '도미솔', 번호: null }), k, roster).transcript.비고[0]!.startsWith('명단 대조 실패:'));
});

test('matchRoster: 같은 이름 두 명이면 고르지 않는다', () => {
  const r = matchRoster(tr({ 이름: '주아린', 번호: 2 }), k, [...roster, st(2, 11, '주아린'), st(2, 12, '주아린')]).transcript;
  assert.equal(r.번호, 2); assert.ok(r.비고[0]!.includes('2명'));
});

test('matchRoster: 다시 돌려도 결과가 같고 비고가 늘지 않는다', () => {
  for (const 이름 of ['나가율', '도미솔']) {
    const once = matchRoster(tr({ 이름 }), k, roster).transcript;
    const twice = matchRoster(once, k, roster);
    assert.equal(twice.변경, null); assert.deepEqual(twice.transcript, once);
  }
});

test('matchRoster: 이름이 비면 번호로 채운다. 가린 세트는 비고를 늘리지 않고 식별도 그대로', () => {
  const plain = matchRoster(tr({ 이름: null }), k, roster).transcript;
  assert.equal(plain.이름, '나가온'); assert.equal(plain.식별확신, '추정'); assert.equal(plain.비고.length, 1);
  const hidden = matchRoster(tr({ 이름: null }), { ...k, 이름가림: rect }, roster).transcript;
  assert.equal(hidden.이름, '나가온'); assert.equal(hidden.식별확신, '확실'); assert.deepEqual(hidden.비고, []);
  const none = matchRoster(tr({ 이름: null, 번호: 40 }), { ...k, 이름가림: rect }, roster).transcript;
  assert.equal(none.이름, null); assert.ok(none.비고[0]!.includes('명단에 없음'));
  const unknown = tr({ 이름: null, 반: null, 번호: null, 식별확신: '불명' });
  assert.equal(matchRoster(unknown, k, roster).변경, null);
});

test('maskBgra: 영역만 희게, 경계는 바깥으로 올림', () => {
  const w = 4, h = 4, px = Buffer.alloc(w * h * 4, 0);
  maskBgra(px, w, h, { x: 0.3, y: 0.5, w: 0.4, h: 0.2 }); // x 0.3~0.7 → 칸 1~2, y 0.5~0.7 → 줄 2
  const at = (x: number, y: number) => px[(y * w + x) * 4];
  assert.equal(at(1, 2), 255); assert.equal(at(2, 2), 255);
  assert.equal(at(0, 2), 0); assert.equal(at(3, 2), 0); assert.equal(at(1, 1), 0); assert.equal(at(1, 3), 0);
});

test('imageToSend: 가리지 않는 세트는 원본, 가릴 수 없으면 원본을 보내지 않고 멈춘다', async () => {
  const jpeg = Buffer.from('원본');
  assert.equal(await imageToSend(jpeg, key), jpeg);
  await assert.rejects(imageToSend(jpeg, masked), /가릴 수 없습니다/);
  const out = await imageToSend(jpeg, masked, (_j, r) => Buffer.from(JSON.stringify(r)));
  assert.deepEqual(JSON.parse(out.toString()), rect);
});

test('keyProblems: 쪽을 벗어난 가림 영역 거절', () => {
  assert.deepEqual(keyProblems(masked), []);
  for (const m of [{ ...rect, x: 0.8 }, { ...rect, w: 0 }, { ...rect, y: -1 }, { ...rect, h: '0.1' }, null])
    assert.ok(keyProblems({ ...key, 이름가림: m }).some(p => p.includes('이름가림')), JSON.stringify(m));
});

test('가린 세트: 프롬프트에 안내, 정답표 내용에 영역을 넣지 않고, 출력의 이름은 버린다', async () => {
  const rules = await loadRules();
  const p = systemPrompt(rules, masked);
  assert.ok(p.includes('# 이름 칸 가림'));
  assert.ok(!p.includes('이름가림') && !systemPrompt(rules, key).includes('# 이름 칸 가림'));
  const out = { page: 1, grade: 3, class: 1, number: 1, name: '답글에서옮김', id_confidence: '확실', quant: key.정량.map(u => ({ id: u.id, answer: '', verdict: '빈칸' })), qual: key.정성.map(u => ({ id: u.id, responded: false, answer: '' })), notes: [] };
  const info = { 엔진: 'api' as const, 모델: 'm', effort: 'low', 규칙: 'r', 일시: 'd' };
  assert.equal(toTranscript(out, masked, 1, info).이름, null);
  assert.equal(toTranscript(out, key, 1, info).이름, '답글에서옮김');
});

test('transcribeSet: 가린 세트는 가린 그림만 보내고, 가릴 수 없으면 모델을 부르지 않는다. 저장 전에 명단과 맞춘다', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'mask-')); mkdirSync(path.join(d, 'pages'));
  writeFileSync(path.join(d, 'pages', 'p01.jpg'), '원본그림');
  const sent: (string | undefined)[] = [];
  const provider: TranscribeProvider = { id: 'api',
    async complete(): Promise<RawResult> { throw new Error('안 씀'); },
    async transcribe(input): Promise<RawResult> {
      sent.push(input.imageJpegBase64);
      return { model: 'm', output: { page: input.page, grade: 3, class: 1, number: 7, name: null, id_confidence: '확실', quant: key.정량.map(u => ({ id: u.id, answer: '', verdict: '빈칸' })), qual: key.정성.map(u => ({ id: u.id, responded: false, answer: '' })), notes: [] } };
    } };
  const rules = await loadRules();
  const none = await transcribeSet(provider, d, masked, rules, [1], new AbortController().signal);
  assert.equal(sent.length, 0); assert.match(none.failed[0]!.error, /가릴 수 없습니다/);
  const m3 = { ...masked, 대상: { 학년: 3, 반: [1] } };
  const r = await transcribeSet(provider, d, m3, rules, [1], new AbortController().signal, { maskJpeg: () => Buffer.from('가린그림'), roster: [{ 학년: 3, 반: 1, 번호: 7, 이름: '명단이름' }] });
  assert.deepEqual(r.ok, [1]);
  assert.deepEqual(sent, [Buffer.from('가린그림').toString('base64')]);
  assert.equal(JSON.parse(readFileSync(path.join(d, 'transcripts', 'p01.json'), 'utf-8')).이름, '명단이름');
});
