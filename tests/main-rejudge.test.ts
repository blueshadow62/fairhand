import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SettingsStore } from '../src/main/settings.js';
import { SecretStore } from '../src/main/secrets.js';
import { loadSet } from '../src/core/setio.js';
import type { RawResult, StructuredRequest, TranscribeProvider } from '../src/engine/provider.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

// 픽스처: p01 1-1 '가나' O, 3-1 '열심히' X / p02 1-1 '가나' O / p03 1-1 '' X
async function setup(confirmed = true) {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-rejudge-'));
  const set = path.join(dir, '세트A');
  await cp(FX, set, { recursive: true });
  await mkdir(path.join(set, 'pages'), { recursive: true });
  for (const p of [1, 2, 3]) await writeFile(path.join(set, 'pages', `p0${p}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const keyPath = path.join(set, '정답표.json');
  const key = JSON.parse(await readFile(keyPath, 'utf-8'));
  if (confirmed) key.확인 = { 완료: true };
  await writeFile(keyPath, JSON.stringify(key), 'utf-8');
  const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
  return { dir, set, bridge, key };
}
const verdict = async (set: string, page: number, id: string) => (await loadSet(set)).transcripts.find(t => t.page === page)!.정량[id]!.판정;
const sheet = async (set: string, page: number) => (await loadSet(set)).transcripts.find(t => t.page === page)!;
/** 검토에서 확인한 것처럼 전사 파일에 확인 표시를 적는다 */
async function mark(set: string, page: number, patch: { 확인완료?: boolean; 확인단위?: string[] }) {
  const file = path.join(set, 'transcripts', `p0${page}.json`);
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf-8')), ...patch }), 'utf-8');
}

test('applyCase: 사례를 기록하고 같은 답을 쓴 장만 바꾸며, 바뀐 판정을 구조로 돌려주고 엑셀을 만든다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    await mark(set, 2, { 확인완료: true });
    const r = await bridge.applyCase(set, { 단위: '1-1', 답: '가나', 판정: 'X', page: 1 }, () => new Date('2026-11-06T00:00:00Z'));
    assert.equal((await sheet(set, 2)).확인완료, true); // 선생님이 확인 창에서 보고 정한 판정이라 확인을 풀지 않는다
    assert.equal(r.다시확인, undefined);
    const { key, transcripts } = await loadSet(set);
    assert.deepEqual(key.사례, [{ 단위: '1-1', 답: '가나', 판정: 'X', 일시: '2026-11-06T00:00:00.000Z', 출처: '검토 p01' }]);
    assert.equal(key.확인?.완료, true); // 사례는 확인을 지우지 않는다
    assert.deepEqual(r.바뀐장.map(c => c.page), [1, 2]); // 확인 창에 보인 장과 같게: 같은 답을 쓴 장만
    assert.deepEqual(r.바뀐장[1]!.변경, ['1-1 O→X']);
    assert.deepEqual(r.판정변경, [{ page: 1, 단위: '1-1', 이전: 'O', 이후: 'X' }, { page: 2, 단위: '1-1', 이전: 'O', 이후: 'X' }]);
    assert.equal(r.이전사례, undefined);
    assert.equal(await verdict(set, 2, '1-1'), 'X');
    assert.deepEqual(transcripts.find(t => t.page === 3)!.정량['1-1'], { 답: '', 판정: 'X' }); // 전체 재판정이면 빈칸으로 바뀌었을 장
    assert.deepEqual(transcripts.find(t => t.page === 2)!.비고, ['이름 흐림', '재판정: 1-1 O→X (사례)']);
    assert.ok(r.엑셀 && !r.엑셀오류);
    assert.equal(transcripts.find(t => t.page === 2)!.정량['1-1']!.답, '가나');
    await assert.rejects(bridge.applyCase(set, { 단위: '1-1', 답: '가나', 판정: 'X', page: 0 }), /장 번호/);
    await assert.rejects(bridge.applyCase(set, { 단위: '1-1', 답: ' ', 판정: 'X', page: 1 }), /빈 답/);
    await assert.rejects(bridge.applyCase(set, { 단위: '9-9', 답: '가나', 판정: 'X', page: 1 }), /단위 9-9/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('revertCase: 사례를 지우고(바꿔 쓴 사례는 되살림) 함께 바뀐 장의 판정·비고를 돌리고, 그사이 바뀐 장은 그대로 둔다', async () => {
  const { dir, set, bridge } = await setup();
  try {
    await bridge.applyCase(set, { 단위: '1-1', 답: '가나', 판정: 'O', page: 2 }, () => new Date('2026-11-05T00:00:00Z')); // 판정은 그대로라 사례만
    const before = await loadSet(set);
    const r = await bridge.applyCase(set, { 단위: '1-1', 답: '가나', 판정: 'X', page: 1 }, () => new Date('2026-11-06T00:00:00Z'));
    assert.deepEqual(r.이전사례, { 단위: '1-1', 답: '가나', 판정: 'O', 일시: '2026-11-05T00:00:00.000Z', 출처: '검토 p02' });
    const undo = { 사례: [{ 단위: '1-1', 답: '가나', 판정: 'X' as const, 이전사례: r.이전사례 }], 변경: r.판정변경.filter(c => c.page !== 1) };
    const back = await bridge.revertCase(set, undo);
    assert.deepEqual([back.사례, back.복원, back.건너뜀], [1, 1, 0]);
    assert.ok(back.엑셀 && !back.엑셀오류);
    const after = await loadSet(set);
    assert.deepEqual(after.key.사례, before.key.사례); // 바꿔 쓴 사례가 그대로 돌아온다
    assert.deepEqual(after.transcripts.find(t => t.page === 2), before.transcripts.find(t => t.page === 2)); // 판정과 비고 모두
    assert.equal(await verdict(set, 1, '1-1'), 'X'); // 선생님이 직접 바꾼 장은 되돌리지 않는다
    const again = await bridge.revertCase(set, undo); // 이미 돌렸으면 바꿀 것이 없다
    assert.deepEqual([again.사례, again.복원, again.건너뜀, again.엑셀], [0, 0, 1, undefined]);
    await assert.rejects(bridge.revertCase(set, { 사례: [{ 단위: '1-1', 답: '가나', 판정: 'X' }], 변경: [{ page: 2, 단위: '3-1', 이전: 'O', 이후: 'X' }] }), /단위가 사례와 맞지/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejudge: 허용에 표기를 더하면 그 표기를 쓴 장이 O로', async () => {
  const { dir, set, bridge, key } = await setup();
  try {
    key.정량[1].허용 = ['열심히'];
    await writeFile(path.join(set, '정답표.json'), JSON.stringify(key), 'utf-8');
    const r = await bridge.rejudge(set);
    assert.ok(r.바뀐장.some(c => c.page === 1 && c.변경.includes('3-1 X→O')));
    assert.equal(await verdict(set, 1, '3-1'), 'O');
    assert.equal(await verdict(set, 3, '1-1'), '빈칸'); // 빈 답은 빈칸으로
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejudge: 이미 확인한 판정이 바뀐 장은 그 단위의 확인과 확인 완료를 풀고 장 번호를 돌려준다. 바뀌지 않은 장의 확인은 그대로', async () => {
  const { dir, set, bridge, key } = await setup();
  try {
    await mark(set, 1, { 확인완료: true });          // 답안지별에서 확인 완료
    await mark(set, 2, { 확인완료: true });          // 판정이 바뀌지 않을 장
    await mark(set, 3, { 확인단위: ['1-1'] });       // 문항별에서 1-1만 확인
    key.정량[1].허용 = ['열심히'];
    await writeFile(path.join(set, '정답표.json'), JSON.stringify(key), 'utf-8');
    const r = await bridge.rejudge(set);
    assert.deepEqual(r.바뀐장.map(c => c.page), [1, 3]); // p01 3-1 X→O, p03 1-1 X→빈칸
    assert.deepEqual(r.다시확인, [1, 3]);
    const p1 = await sheet(set, 1);
    assert.deepEqual([p1.확인완료, p1.확인단위], [false, ['1-1', 'E1']]); // 바뀐 3-1만 다시 확인할 대상
    assert.equal((await sheet(set, 2)).확인완료, true);
    const p3 = await sheet(set, 3);
    assert.deepEqual([p3.확인완료, p3.확인단위], [false, undefined]);
    assert.deepEqual((await bridge.rejudge(set)).다시확인, []); // 다시 돌려 바뀐 것이 없으면 0
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('judgeWithModel: 가짜 제공자 판정으로 바꾸고, 실행 중에는 거절', async () => {
  const { dir, set, bridge } = await setup();
  try {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const fake: TranscribeProvider = {
      id: 'api',
      async complete(req: StructuredRequest): Promise<RawResult> { await gate; void req; return { output: { quant: [{ id: '1-1', verdict: 'X' }, { id: '3-1', verdict: 'O' }] }, model: 'f' }; },
      async transcribe(): Promise<RawResult> { throw new Error('쓰지 않음'); },
    };
    (bridge as any).provider = async () => fake;
    for (const p of [1, 2]) await mark(set, p, { 확인완료: true });
    const seen: number[] = [];
    const running = bridge.judgeWithModel(set, [1, 2], e => seen.push(e.page));
    await assert.rejects(bridge.startRun(set, {}, () => undefined), /이미 실행 중/);
    release();
    const r = await running;
    assert.deepEqual(r.바뀐장.map(c => c.page), [1]); // p02는 1-1뿐이고 '가나'는 정답과 글자가 같아 모델 X를 무시한다
    assert.deepEqual(seen, [1, 2]);
    assert.equal(await verdict(set, 1, '3-1'), 'O'); // '열심히'는 글자로 못 정하니 모델 판정대로
    assert.equal(await verdict(set, 2, '1-1'), 'O');
    assert.ok((await loadSet(set)).transcripts.find(t => t.page === 1)!.비고.includes('모델 재판정: 3-1 X→O'));
    assert.deepEqual(r.다시확인, [1]); // 확인 완료한 p01의 3-1이 바뀌었다
    assert.deepEqual([(await sheet(set, 1)).확인완료, (await sheet(set, 1)).확인단위], [false, ['1-1', 'E1']]);
    assert.equal((await sheet(set, 2)).확인완료, true); // 바뀌지 않은 장은 그대로
    assert.equal(bridge.running(), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveKey: 사례·채점규칙만 바꾸면 확인 유지, 정답을 바꾸면 확인을 지운다', async () => {
  const { dir, set, bridge, key } = await setup();
  try {
    const k1 = (await bridge.saveKey(set, { ...key, 채점규칙: { 넓은말: '인정' }, 사례: [{ 단위: '1-1', 답: '가', 판정: 'O', 일시: '', 출처: '' }], 정량: key.정량.map((u: any) => ({ ...u, 유형: '단답형' })) })).key;
    assert.equal(k1.확인?.완료, true);
    const k2 = (await bridge.saveKey(set, { ...k1, 정량: k1.정량.map(u => u.id === '1-1' ? { ...u, 정답: '다른 답' } : u) })).key;
    assert.equal(k2.확인?.완료, false);
    assert.equal((await loadSet(set)).key.확인?.완료, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
