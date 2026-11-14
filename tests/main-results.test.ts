import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAllCumulative, friendlyFsError, latestResult, rebuildResult, saveAndRebuild } from '../src/main/results.js';
import { loadSet } from '../src/core/setio.js';
import { DataError } from '../src/core/types.js';

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const deps = { version: '0.0.0-test', now: () => new Date(2026, 10, 6, 10, 0, 0) };

async function semester(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-results-'));
  await cp(FX, path.join(dir, '세트A'), { recursive: true });
  return dir;
}

test('rebuildResult: 세트 폴더에 채점결과 엑셀을 만든다', async () => {
  const dir = await semester();
  try {
    const r = await rebuildResult(path.join(dir, '세트A'), null, deps);
    assert.ok(r.엑셀.endsWith('_채점결과_2026-11-06.xlsx'));
    assert.ok((await readdir(path.join(dir, '세트A'))).some(n => n.endsWith('.xlsx')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('latestResult: 가장 최근에 쓴 채점결과 엑셀, 잠금 파일·누가기록은 빼고, 없으면 null', async () => {
  const dir = await semester();
  try {
    const set = path.join(dir, '세트A');
    assert.equal(await latestResult(set), null);
    const at = async (name: string, minutes: number) => { const f = path.join(set, name); await writeFile(f, ''); const t = new Date(2026, 10, 6, 10, minutes); await utimes(f, t, t); return f; };
    await at('2026-2학기_1학년_1반_봄비_채점결과_2026-11-05.xlsx', 1);
    // 정답표에서 반을 고쳐 이름이 달라져도 나중에 쓴 파일이 지금 결과다
    const newest = await at('2026-2학기_1학년_1·2반_봄비_채점결과_2026-11-04.xlsx', 5);
    await at('~$26-2학기_1학년_1·2반_봄비_채점결과_2026-11-04.xlsx', 9); // 엑셀이 열어 둔 동안의 잠금 파일
    await at('2026-2학기_1학년_누가기록_2026-11-06.xlsx', 9);
    assert.equal(await latestResult(set), newest);
    assert.equal(await latestResult(path.join(dir, '없는 세트')), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveAndRebuild: 전사는 저장되고 엑셀 오류는 메시지로만', async () => {
  const dir = await semester();
  try {
    const set = path.join(dir, '세트A');
    const { transcripts } = await loadSet(set);
    const t = { ...transcripts[0]!, 비고: ['고침'] };
    const r = await saveAndRebuild(set, t, null, deps);
    assert.ok(r.엑셀 && !r.엑셀오류);
    assert.deepEqual((await loadSet(set)).transcripts[0]!.비고, ['고침']);
    // 엑셀을 못 쓰는 상황: 같은 이름의 폴더를 만들어 둔다
    await (await import('node:fs/promises')).mkdir(r.엑셀!, { recursive: true }).catch(() => undefined);
    await rm(r.엑셀!, { force: true }).catch(() => undefined);
    await (await import('node:fs/promises')).mkdir(r.엑셀!, { recursive: true });
    const r2 = await saveAndRebuild(set, { ...t, 비고: ['또 고침'] }, null, deps);
    assert.ok(r2.엑셀오류 && !r2.엑셀);
    assert.deepEqual((await loadSet(set)).transcripts[0]!.비고, ['또 고침']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('buildAllCumulative: 학년별 누가기록 파일, 폴더명순', async () => {
  const dir = await semester();
  try {
    await cp(FX, path.join(dir, '세트B'), { recursive: true });
    const r = await buildAllCumulative(dir, null, deps);
    assert.equal(r.파일.length, 1);
    assert.ok(r.파일[0]!.includes('누가기록'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('friendlyFsError: EPERM·EBUSY는 열려 있다는 안내로', () => {
  const e = Object.assign(new Error('x'), { code: 'EPERM' });
  assert.match(friendlyFsError(e, '엑셀 파일').message, /열려 있어/);
  assert.ok(friendlyFsError(new Error('다른 오류'), '파일') instanceof DataError);
});
