import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { rejudgeTranscript } from '../core/rejudge.js';
import { transcriptFileName } from '../core/setio.js';
import type { AnswerKey, Transcript } from '../core/types.js';
import { EngineError, toTranscript, userFacingMessage, withRetry, type Effort, type TranscribeInput, type TranscribeProvider } from './provider.js';
import type { Rules } from './rules.js';

const DEFAULT_EFFORT: Effort = 'high';

export async function transcribePage(provider: TranscribeProvider, input: Omit<TranscribeInput, 'effort'> & { effort?: Effort }, signal: AbortSignal, now: () => Date = () => new Date())
  : Promise<{ transcript: Transcript; inputTokens?: number; outputTokens?: number }> {
  const full: TranscribeInput = { ...input, effort: input.effort ?? DEFAULT_EFFORT };
  for (let attempt = 1; ; attempt++) {
    const raw = await withRetry(() => provider.transcribe(full, signal), signal);
    try {
      const transcript = toTranscript(raw.output, full.key, full.page,
        { 엔진: provider.id, 모델: raw.model, effort: full.effort, 규칙: full.rules.버전, 일시: now().toISOString() });
      return { transcript, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens };
    } catch (e) {
      // 스키마는 모양만 강제하므로 값이 틀릴 수 있다: 한 번만 다시 묻는다
      if (!(e instanceof EngineError) || e.kind !== 'invalid-output' || attempt >= 2) throw e;
    }
  }
}

export interface TranscribeOptions {
  effort?: Effort;
  onProgress?: (e: { page: number; done: number; total: number; inputTokens?: number; outputTokens?: number }) => void;
  outDir?: string;
  force?: boolean;
}

const exists = (p: string) => access(p).then(() => true, () => false);

/** 쓰다가 끊겨도 깨지지 않게 임시 파일에 쓰고 바꿔치기. transcripts 밖(outDir)에도 쓸 수 있어 setio.saveTranscript 대신 둔다. */
async function writeJson(dir: string, name: string, data: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, name), tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1), 'utf-8');
  await rename(tmp, target);
}

export async function transcribeSet(provider: TranscribeProvider, setDir: string, key: AnswerKey, rules: Rules, pages: number[], signal: AbortSignal, opts: TranscribeOptions = {})
  : Promise<{ ok: number[]; failed: { page: number; error: string }[]; skipped: number[] }> {
  const outDir = opts.outDir ?? path.join(setDir, 'transcripts');
  const ok: number[] = [], failed: { page: number; error: string }[] = [], skipped: number[] = [];
  let done = 0;
  for (const page of pages) {
    if (signal.aborted) break;
    const name = transcriptFileName(page);
    if (!opts.force && await exists(path.join(outDir, name))) { skipped.push(page); done++; opts.onProgress?.({ page, done, total: pages.length }); continue; }
    try {
      const image = (await readFile(path.join(setDir, 'pages', `p${String(page).padStart(2, '0')}.jpg`))).toString('base64');
      const r = await transcribePage(provider, { imageJpegBase64: image, key, rules, page, effort: opts.effort }, signal);
      await writeJson(outDir, name, rejudgeTranscript(key, r.transcript).transcript); // 사례·정답 정확 일치는 저장 전에 맞춘다
      ok.push(page); done++;
      opts.onProgress?.({ page, done, total: pages.length, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
    } catch (e) {
      if (e instanceof EngineError && e.kind === 'cancelled') break;
      failed.push({ page, error: userFacingMessage(e) }); done++;
      opts.onProgress?.({ page, done, total: pages.length });
      // 로그인·설치·버전 문제는 다음 장도 똑같이 실패하므로 멈춘다
      if (e instanceof EngineError && ['signed-out', 'not-installed', 'needs-update'].includes(e.kind)) break;
    }
  }
  return { ok, failed, skipped };
}
