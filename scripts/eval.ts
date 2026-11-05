import { parseArgs } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSet } from '../src/core/setio.js';
import { parseTranscript } from '../src/core/transcript.js';
import { evaluate, formatSummary } from '../src/engine/eval.js';
import { DataError, type Transcript } from '../src/core/types.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { got: { type: 'string' } } });
const setDir = positionals[0];
if (!setDir || !values.got) { console.error('사용법: npm run eval -- "<세트 폴더>" --got "<엔진 결과 폴더>"'); process.exit(2); }

try {
  const { key, transcripts } = await loadSet(setDir);
  const got: Transcript[] = [];
  for (const name of (await readdir(values.got)).filter(n => /^p\d+\.json$/.test(n)))
    got.push(parseTranscript(await readFile(path.join(values.got, name), 'utf-8'), name));
  const s = evaluate(key, transcripts, got);
  console.log(formatSummary(s));
  await writeFile(path.join(values.got, 'eval-summary.json'), JSON.stringify(s, null, 1), 'utf-8');
} catch (e) {
  if (e instanceof DataError) { console.error(`멈춤: ${e.message}`); process.exit(1); }
  throw e;
}
