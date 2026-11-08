import { t } from './lib/i18n.js';
import { sheetKind } from './lib/sheets.js';

type PdfJs = typeof import('pdfjs-dist');
export type Rotation = 0 | 90 | 180 | 270;

/** 200dpi 상당(파이썬 extract_pages.py와 같은 해상도) */
export const DPI_SCALE = 200 / 72;

let lib: Promise<PdfJs> | null = null;
/** pdf.js는 geulnun://app/pdfjs/(node_modules/pdfjs-dist/build)에서 필요할 때 한 번 불러온다 */
function pdfjs(): Promise<PdfJs> {
  return lib ??= (async () => {
    const m = await import('/pdfjs/pdf.min.mjs' as string) as PdfJs;
    m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    return m;
  })();
}

export interface OpenedPdf {
  pageCount: number;
  renderPage(n: number, opts: { rotation: Rotation; scale: number }): Promise<HTMLCanvasElement>;
  close(): void;
}

export async function openPdf(file: File, bytes?: ArrayBuffer): Promise<OpenedPdf> {
  const m = await pdfjs();
  const task = m.getDocument({ data: new Uint8Array(bytes ?? await file.arrayBuffer()) });
  const doc = await task.promise;
  return {
    pageCount: doc.numPages,
    async renderPage(n, { rotation, scale }) {
      const page = await doc.getPage(n);
      // rotation은 그 쪽의 /Rotate 값을 대신한다(더하지 않는다): 스캐너가 넣은 회전과 겹쳐 두 번 돌지 않게
      const viewport = page.getViewport({ scale, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent 'print'는 requestAnimationFrame을 쓰지 않는다: 창이 가려지거나 최소화되면 화면용 렌더가 멈춘다
      await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
      page.cleanup();
      return canvas;
    },
    close() { void task.destroy(); }, // pdf.js 6: 문서가 아니라 불러오기 작업을 닫는다(워커·메모리 해제)
  };
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.85): Promise<ArrayBuffer> {
  return new Promise((res, rej) => c.toBlob(b => (b ? b.arrayBuffer().then(res, rej) : rej(new Error(t('pdf.jpegFailed')))), 'image/jpeg', quality));
}

/** PDF 한 파일의 지정한 쪽을 JPEG로(한 장 시험용) */
export async function pdfPageJpeg(file: File, n: number, rotation: Rotation): Promise<ArrayBuffer> {
  const pdf = await openPdf(file);
  try { return await canvasToJpeg(await pdf.renderPage(n, { rotation, scale: DPI_SCALE })); } finally { pdf.close(); }
}

/** 스캐너가 낸 사진 파일(jpg·png)을 회전만 해서 캔버스로. 크기는 그대로 */
export async function imageToCanvas(file: File, rotation: Rotation, scale = 1): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  const swap = rotation === 90 || rotation === 270;
  c.width = swap ? h : w; c.height = swap ? w : h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close();
  return c;
}

/** 올린 파일 하나: PDF(여러 쪽) 또는 사진(한 쪽). 이름순(숫자 인식)으로 정렬해 쓴다 */
export interface SheetSource { name: string; pageCount: number; render(n: number, rotation: Rotation, scale: number): Promise<HTMLCanvasElement>; close(): void }

export async function openSheetSource(file: File, bytes?: ArrayBuffer): Promise<SheetSource> {
  const kind = sheetKind(file.name, file.type);
  if (kind === 'pdf') {
    const pdf = await openPdf(file, bytes);
    return { name: file.name, pageCount: pdf.pageCount, render: (n, rotation, scale) => pdf.renderPage(n, { rotation, scale }), close: () => pdf.close() };
  }
  if (kind === 'image') {
    return { name: file.name, pageCount: 1, render: (_n, rotation, scale) => imageToCanvas(file, rotation, scale === DPI_SCALE ? 1 : scale / DPI_SCALE), close: () => undefined };
  }
  throw new Error(t('pdf.onlyPdfOrImage'));
}
