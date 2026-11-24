import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identityMask } from '../src/core/key.js';
import { DataError, type AnswerKey, type MaskRect, type Transcript } from '../src/core/types.js';
import { regionImageToSend } from '../src/engine/privacy.js';
import { EngineError, type RawResult, type StructuredRequest, type TranscribeProvider } from '../src/engine/provider.js';
import { findRegions, fromRegionOutput, regionRequest, toRect } from '../src/engine/regions.js';
import { loadRules } from '../src/engine/rules.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

const key = { 글: '시험', 정량: [{ id: '1-1', 문항: 1, 설명: '첫 빈칸', 정답: '가나' }, { id: '1-2', 문항: 1, 설명: '둘째 빈칸', 정답: '다라' }], 정성: [{ id: 'E1', 문항: 2, 설명: '생각 쓰기' }] } as unknown as AnswerKey;
const transcript = { page: 3, 학년: 1, 반: 1, 번호: 1, 이름: null, 식별확신: '확실', 정량: { '1-1': { 답: '가나다', 판정: 'X' }, '1-2': { 답: '', 판정: '빈칸' } }, 정성: { E1: { 응답: true, 답: '나는 이렇게 생각한다' } }, 비고: [] } as Transcript;
const box = (x0: number | null, y0: number | null, x1: number | null, y1: number | null) => ({ x0, y0, x1, y1 });

test('toRect: 0~1000 정수 상자를 쪽 비율로, 범위 밖·뒤집힘·소수·null은 버린다', () => {
  assert.deepEqual(toRect(box(100, 200, 400, 250)), { x: 0.1, y: 0.2, w: 0.3, h: 0.05 });
  assert.deepEqual(toRect(box(0, 0, 1000, 1000)), { x: 0, y: 0, w: 1, h: 1 });
  for (const b of [box(-1, 0, 10, 10), box(0, 0, 1001, 10), box(50, 0, 50, 10), box(60, 0, 50, 10), box(0, 30, 10, 20), box(0.5, 0, 10, 10), box(null, null, null, null)])
    assert.equal(toRect(b), null, JSON.stringify(b));
});

test('fromRegionOutput: 단위마다 따로 검사하고, 틀린 단위만 null(빠짐·두 번·목록 밖 id 포함)', () => {
  const out = fromRegionOutput({ boxes: [
    { id: '1-1', ...box(100, 200, 400, 250) },
    { id: 'E1', ...box(100, 600, 900, 900) }, { id: 'E1', ...box(100, 610, 900, 900) }, // 두 번 나온 단위
    { id: '9-9', ...box(0, 0, 10, 10) }, // 묻지 않은 단위
  ] }, ['1-1', '1-2', 'E1']);
  assert.deepEqual(out, { '1-1': { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, '1-2': null, E1: null });
  assert.throws(() => fromRegionOutput({ boxes: 'x' }, ['1-1']), EngineError);
  assert.throws(() => fromRegionOutput(null, ['1-1']), EngineError);
});

test('regionRequest: 묻는 단위만, 이 장에서 학생이 쓴 답을 함께 보내고 정답은 보내지 않는다', async () => {
  const rules = await loadRules('regions-v1');
  const req = regionRequest({ imageJpegBase64: 'IMG', key, transcript, 단위: ['1-1', '1-2', 'E1'], effort: 'medium' }, rules);
  assert.equal(req.imageJpegBase64, 'IMG');
  assert.ok(req.user.includes('1-1') && req.user.includes('"가나다"'));
  assert.match(req.user, /1-2 [^\n]*\(빈칸\)/);
  assert.ok(req.user.includes('"나는 이렇게 생각한다"'));
  assert.ok(!req.user.includes('다라')); // 정답
  assert.ok(req.system.includes('0~1000'));
  const only = regionRequest({ imageJpegBase64: 'IMG', key, transcript, 단위: ['1-2'], effort: 'medium' }, rules);
  assert.ok(!only.user.includes('1-1') && !only.user.includes('E1'));
  assert.deepEqual(((only.schema.properties as any).boxes.items.properties.id.enum), ['1-2']);
});

test('regionImageToSend: 신원 영역은 늘, 이름 칸은 설정했을 때 칠한다. 가릴 수 없으면 보내지 않는다', async () => {
  const painted: MaskRect[] = [];
  const masker = (j: Buffer, r: MaskRect) => { painted.push(r); return Buffer.concat([j, Buffer.from('+')]); };
  assert.equal((await regionImageToSend(Buffer.from('원본'), key, masker)).toString(), '원본+');
  assert.deepEqual(painted, [identityMask(key)]);
  const name = { x: 0.6, y: 0, w: 0.4, h: 0.1 };
  painted.length = 0;
  await regionImageToSend(Buffer.from('원본'), { ...key, 이름가림: name }, masker);
  assert.deepEqual(painted, [identityMask(key), name]);
  await assert.rejects(regionImageToSend(Buffer.from('원본'), key), DataError);
});

test('findRegions: provider.complete로 묻고 결과를 쪽 비율로', async () => {
  let asked: StructuredRequest | undefined;
  const p = { id: 'api', async complete(req: StructuredRequest): Promise<RawResult> { asked = req; return { output: { boxes: [{ id: 'E1', ...box(100, 500, 900, 800) }] }, model: 'fake' }; } } as unknown as TranscribeProvider;
  const r = await findRegions(p, { imageJpegBase64: 'IMG', key, transcript, 단위: ['E1'], effort: 'low' }, new AbortController().signal);
  assert.deepEqual(r, { E1: { x: 0.1, y: 0.5, w: 0.8, h: 0.3 } });
  assert.equal(asked?.effort, 'low');
});

test('findAnswerRegions: 확인 완료·전사·그림이 있어야 하고, 가린 그림을 보내며 정답표는 쓰지 않는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-'));
  try {
    const set = path.join(dir, '세트A');
    await cp(FX, set, { recursive: true });
    const keyPath = path.join(set, '정답표.json');
    const painted: MaskRect[] = [];
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {},
      maskJpeg: (j, r) => { painted.push(r); return Buffer.concat([j, Buffer.from('#가림')]); } });
    let sent = '';
    (bridge as any).provider = async () => ({ id: 'api', async complete(req: StructuredRequest): Promise<RawResult> {
      sent = Buffer.from(req.imageJpegBase64!, 'base64').toString();
      return { output: { boxes: [{ id: '1-1', ...box(100, 200, 400, 250) }, { id: '3-1', ...box(null, null, null, null) }] }, model: 'fake' };
    } });
    await assert.rejects(bridge.findAnswerRegions(set, 1, ['1-1']), /확인되지 않았습니다/);
    const k = JSON.parse(await readFile(keyPath, 'utf-8'));
    await writeFile(keyPath, JSON.stringify({ ...k, 확인: { 완료: true } }), 'utf-8');
    const before = await readFile(keyPath, 'utf-8');
    await assert.rejects(bridge.findAnswerRegions(set, 9, ['1-1']), /p09 장의 전사가 없습니다/);
    await assert.rejects(bridge.findAnswerRegions(set, 1, ['1-1']), /p01 장의 그림 파일이 없습니다/);
    await mkdir(path.join(set, 'pages'), { recursive: true });
    await writeFile(path.join(set, 'pages', 'p01.jpg'), '그림');
    await assert.rejects(bridge.findAnswerRegions(set, 1, ['9-9']), /찾을 단위가 없습니다/);
    const r = await bridge.findAnswerRegions(set, 1, ['1-1', '3-1', '9-9']);
    assert.deepEqual(r, { '1-1': { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, '3-1': null });
    assert.equal(sent, '그림#가림'); // 원본이 아니라 가린 그림
    assert.deepEqual(painted, [identityMask(k)]);
    assert.equal(await readFile(keyPath, 'utf-8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
