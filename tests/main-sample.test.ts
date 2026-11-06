import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows } from '../src/core/score.js';
import { loadSet } from '../src/core/setio.js';
import { copySampleSet, defaultSemesterDir, makeDefaultSemester, SAMPLE_DIR } from '../src/main/sample.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('defaultSemesterDir: 3~8월 1학기, 9~12월 2학기, 1·2월은 앞 해 2학기', () => {
  assert.equal(defaultSemesterDir('D:\\문서', new Date(2026, 10, 6)), path.join('D:\\문서', '글눈', '2026-2학기'));
  assert.equal(defaultSemesterDir('D:\\문서', new Date(2026, 3, 1)), path.join('D:\\문서', '글눈', '2026-1학기'));
  assert.equal(defaultSemesterDir('D:\\문서', new Date(2027, 1, 10)), path.join('D:\\문서', '글눈', '2026-2학기'));
});

test('copySampleSet: 두 번 넣으면 덮어쓰지 않고 (2), 읽히고 채점된다', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'geulnun-sample-'));
  try {
    const a = await copySampleSet(SAMPLE_DIR(ROOT), tmp);
    const b = await copySampleSet(SAMPLE_DIR(ROOT), tmp);
    assert.equal(a, '샘플_1학년_봄비오는날');
    assert.equal(b, '샘플_1학년_봄비오는날 (2)');
    assert.deepEqual((await readdir(tmp)).sort(), [a, b].sort());
    const { key, transcripts } = await loadSet(path.join(tmp, b));
    assert.equal(key.확인?.완료, true);
    assert.equal(transcripts.length, 3);
    assert.equal((await readdir(path.join(tmp, b, 'pages'))).length, 3);
    const { rows, unmatched } = buildRows(key, null, transcripts);
    assert.equal(unmatched.length, 0);
    assert.deepEqual(rows.map(r => [r.page, r.합계]), [[1, 6], [2, 3], [3, 4]]);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('makeDefaultSemester: 폴더를 만들고 경로를 돌려준다', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'geulnun-docs-'));
  try {
    const p = await makeDefaultSemester(tmp, new Date(2026, 10, 6));
    assert.equal(p, path.join(tmp, '글눈', '2026-2학기'));
    assert.ok((await stat(p)).isDirectory());
    assert.equal(await makeDefaultSemester(tmp, new Date(2026, 10, 6)), p); // 이미 있어도 된다
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
