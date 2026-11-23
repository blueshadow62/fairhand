import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { drawsMarks, pageShapes, planAnswerPdf, type AnswerPdfOptions, type AnswerPdfResult } from '../core/answer-pdf.js';
import { uniqueName } from '../core/names.js';
import { PdfWriter, readJpegInfo, type Sink } from '../core/pdf.js';
import { listPages, loadSet, pageImageName } from '../core/setio.js';
import { DataError, pageTag, type Transcript } from '../core/types.js';
import { friendlyFsError } from './results.js';

/** 작은 조각(PDF 머리·내용 흐름)은 모아서 한 번에 쓴다. 그림은 장마다 읽어 넘기고 잡아 두지 않는다 */
function fileSink(fh: FileHandle): Sink & { flush(): Promise<void> } {
  let parts: Uint8Array[] = [], size = 0;
  const writeAll = async (b: Uint8Array) => { for (let o = 0; o < b.length;) o += (await fh.write(b, o, b.length - o)).bytesWritten; };
  const flush = async () => { if (!size) return; const b = Buffer.concat(parts, size); parts = []; size = 0; await writeAll(b); };
  return {
    async write(c) { if (c.length >= 64 * 1024) { await flush(); await writeAll(c); return; } parts.push(c); size += c.length; if (size >= 256 * 1024) await flush(); },
    flush,
  };
}

/**
 * 세트의 답안지 그림을 PDF로 받는다. outDir은 사용자가 폴더 고르기 창에서 고른 폴더.
 * 같은 이름의 파일·폴더가 있으면 덮어쓰지 않고 ' (2)'를 붙이고, 쓰는 중에는 임시 이름(.part)에 써서 끊겨도 반쪽 PDF가 남지 않게 한다
 */
export async function exportAnswerPdf(setDir: string, outDir: string, o: AnswerPdfOptions, deps: { now?: () => Date } = {}): Promise<AnswerPdfResult> {
  const now = (deps.now ?? (() => new Date()))();
  const { key, transcripts } = await loadSet(setDir);
  const pages = await listPages(setDir);
  if (!pages.length) throw new DataError('세트에 올린 답안지가 없어 PDF를 만들 수 없습니다');
  if (o.표시 && ![...key.정량, ...key.정성].some(u => key.답영역?.[u.id])) throw new DataError('답 칸을 잡은 단위가 없어 채점 표시를 넣을 수 없습니다. 문항별 검토에서 답 칸을 잡아 주세요');
  const byPage = new Map<number, Transcript>(transcripts.map(t => [t.page, t]));
  const plan = planAnswerPdf(key, transcripts, pages, o, now);

  let dir = outDir;
  if (plan.폴더) {
    dir = path.join(outDir, uniqueName(plan.폴더, n => existsSync(path.join(outDir, n))));
    try { await mkdir(dir, { recursive: true }); } catch (e) { throw friendlyFsError(e, `폴더 ${path.basename(dir)}`); }
  }
  const 파일: string[] = [];
  let 표시장수 = 0;
  for (const f of plan.files) {
    const target = path.join(dir, uniqueName(f.이름, n => existsSync(path.join(dir, n))));
    const tmp = `${target}.part`;
    let fh: FileHandle | null = null;
    try {
      fh = await open(tmp, 'w');
      const sink = fileSink(fh), pdf = new PdfWriter(sink);
      for (const p of f.pages) {
        const name = pageImageName(p);
        let jpeg: Buffer;
        try { jpeg = await readFile(path.join(setDir, 'pages', name)); } catch { throw new DataError(`${name}: 답안지 그림을 읽지 못했습니다`); }
        const info = readJpegInfo(jpeg, `${pageTag(p)} 그림`);
        const t = byPage.get(p) ?? null;
        await pdf.addPage({ jpeg, info, shapes: pageShapes(key, t, info, o) });
        if (drawsMarks(t, o)) 표시장수++;
      }
      await pdf.finish();
      await sink.flush();
      await fh.close(); fh = null;
      await rename(tmp, target);
    } catch (e) {
      await fh?.close().catch(() => undefined);
      await rm(tmp, { force: true }).catch(() => undefined);
      throw friendlyFsError(e, `PDF 파일 ${path.basename(target)}`);
    }
    파일.push(target);
  }
  return { 폴더: dir, 파일, 장수: pages.length, 표시장수 };
}
