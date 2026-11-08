import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { rejudgeTranscript } from '../core/rejudge.js';
import { matchRoster } from '../core/roster.js';
import { pageImageName, transcriptFileName, writeJsonAtomic } from '../core/setio.js';
import type { AnswerKey, Student, Transcript } from '../core/types.js';
import { EngineError, toTranscript, userFacingMessage, withRetry, type Effort, type TranscribeInput, type TranscribeProvider } from './provider.js';
import { imageToSend, type JpegMasker } from './privacy.js';
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
  /** skipped: 이미 전사해 건너뛴 장, error: 실패한 장. 걸린 시간을 잴 때 둘을 뺀다 */
  onProgress?: (e: { page: number; done: number; total: number; inputTokens?: number; outputTokens?: number; error?: string; skipped?: boolean }) => void;
  outDir?: string;
  force?: boolean;
  maskJpeg?: JpegMasker;
  /** 있으면 저장 전에 명단과 맞춘다 */
  roster?: Student[] | null;
  /** 정량 단위마다 답의 세로 위치도 받는다(설정 '답 위치 받기') */
  위치?: boolean;
}

const exists = (p: string) => access(p).then(() => true, () => false);

export async function transcribeSet(provider: TranscribeProvider, setDir: string, key: AnswerKey, rules: Rules, pages: number[], signal: AbortSignal, opts: TranscribeOptions = {})
  : Promise<{ ok: number[]; failed: { page: number; error: string }[]; skipped: number[] }> {
  const outDir = opts.outDir ?? path.join(setDir, 'transcripts');
  const ok: number[] = [], failed: { page: number; error: string }[] = [], skipped: number[] = [];
  let done = 0;
  for (const page of pages) {
    if (signal.aborted) break;
    const name = transcriptFileName(page);
    if (!opts.force && await exists(path.join(outDir, name))) { skipped.push(page); done++; opts.onProgress?.({ page, done, total: pages.length, skipped: true }); continue; }
    try {
      const image = (await imageToSend(await readFile(path.join(setDir, 'pages', pageImageName(page))), key, opts.maskJpeg)).toString('base64');
      const r = await transcribePage(provider, { imageJpegBase64: image, key, rules, page, effort: opts.effort, 위치: opts.위치 }, signal);
      const judged = rejudgeTranscript(key, r.transcript).transcript; // 사례·정답 정확 일치는 저장 전에 맞춘다
      await writeJsonAtomic(outDir, name, opts.roster ? matchRoster(judged, key, opts.roster).transcript : judged); // 잠긴 파일이면 사람 말 오류(검토 저장과 같은 길)
      ok.push(page); done++;
      opts.onProgress?.({ page, done, total: pages.length, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
    } catch (e) {
      if (e instanceof EngineError && e.kind === 'cancelled') break;
      const error = userFacingMessage(e);
      failed.push({ page, error }); done++;
      opts.onProgress?.({ page, done, total: pages.length, error });
      // 로그인·설치·버전 문제는 다음 장도 똑같이 실패하므로 멈춘다
      if (e instanceof EngineError && ['signed-out', 'not-installed', 'needs-update'].includes(e.kind)) break;
    }
  }
  return { ok, failed, skipped };
}
