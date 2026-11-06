import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadSet, listPages } from '../src/core/setio.js';
import { loadRules } from '../src/engine/rules.js';
import { CliProvider } from '../src/engine/cli.js';
import { ApiProvider } from '../src/engine/api.js';
import { transcribeSet } from '../src/engine/transcribe.js';
import type { Effort } from '../src/engine/provider.js';
import { DataError } from '../src/core/types.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  engine: { type: 'string', default: 'cli' }, pages: { type: 'string' }, effort: { type: 'string', default: 'high' }, model: { type: 'string', default: 'claude-opus-5-5' },
  out: { type: 'string' }, force: { type: 'boolean', default: false } } });
const setDir = positionals[0];
if (!setDir) { console.error('사용법: npm run transcribe -- "<세트 폴더>" --engine cli|api [--pages 1-3,7] [--effort high] [--model claude-opus-5-5|claude-sonnet-5-5] [--out <폴더>] [--force]'); process.exit(2); }

function parsePages(spec: string | undefined, all: number[]): number[] {
  if (!spec) return all;
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new DataError(`--pages 형식이 잘못됨: ${part}`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    for (let p = a; p <= b; p++) if (all.includes(p)) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

try {
  const { key } = await loadSet(setDir);
  const rules = await loadRules();
  const pages = parsePages(values.pages, await listPages(setDir));
  const provider = values.engine === 'api' ? new ApiProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: values.model }) : new CliProvider({ model: values.model });
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  let inTok = 0, outTok = 0;
  const r = await transcribeSet(provider, setDir, key, rules, pages, ac.signal, {
    effort: values.effort as Effort, outDir: values.out ? path.resolve(values.out) : undefined, force: values.force,
    onProgress: e => { inTok += e.inputTokens ?? 0; outTok += e.outputTokens ?? 0; console.log(`${e.done}/${e.total} p${String(e.page).padStart(2, '0')} 입력 ${e.inputTokens ?? '-'} 출력 ${e.outputTokens ?? '-'}`); },
  });
  console.log(`끝: 성공 ${r.ok.length}, 실패 ${r.failed.length}, 건너뜀 ${r.skipped.length}, 토큰 입력 ${inTok} 출력 ${outTok}`);
  for (const f of r.failed) console.log(`  p${String(f.page).padStart(2, '0')}: ${f.error}`);
  process.exit(r.failed.length ? 1 : 0);
} catch (e) {
  if (e instanceof DataError) { console.error(`멈춤: ${e.message}`); process.exit(1); }
  throw e;
}
