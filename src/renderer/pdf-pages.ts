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

export async function openPdf(file: File): Promise<OpenedPdf> {
  const m = await pdfjs();
  const doc = await m.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
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
    close() { void doc.destroy(); },
  };
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.85): Promise<ArrayBuffer> {
  return new Promise((res, rej) => c.toBlob(b => (b ? b.arrayBuffer().then(res, rej) : rej(new Error('그림을 JPEG로 바꾸지 못했습니다'))), 'image/jpeg', quality));
}

/** PDF 한 파일의 지정한 쪽을 JPEG로(한 장 시험용) */
export async function pdfPageJpeg(file: File, n: number, rotation: Rotation): Promise<ArrayBuffer> {
  const pdf = await openPdf(file);
  try { return await canvasToJpeg(await pdf.renderPage(n, { rotation, scale: DPI_SCALE })); } finally { pdf.close(); }
}
