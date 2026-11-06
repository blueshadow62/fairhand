import { api } from './api.js';
import { canvasToJpeg, openPdf } from '../pdf-pages.js';
import { t } from './i18n.js';

/** 정답 초안에 올린 파일 묶음: 그림(JPEG)과 글, 그리고 사용자에게 알릴 말 */
export interface DraftFiles { images: ArrayBuffer[]; text: string; notes: string[] }

const MAX_SIDE = 2000;          // 사진은 긴 변 2000px로 줄여 보낸다(문항지는 글자가 크다)
const MAX_PDF_PAGES = 20;       // 문항지·지문 PDF는 앞 20쪽까지
const PDF_SCALE = 150 / 72;

async function imageToJpeg(file: File): Promise<ArrayBuffer> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const jpeg = await canvasToJpeg(c);
  c.width = c.height = 0;
  return jpeg;
}

/** 형식 제한 없이 받되, 그림·PDF는 그림으로, 그 밖은 메인이 글을 뽑는다(못 뽑는 형식은 메인의 안내 오류를 notes로) */
export async function filesToDraft(files: File[], onProgress?: (msg: string) => void): Promise<DraftFiles> {
  const out: DraftFiles = { images: [], text: '', notes: [] };
  for (const f of files) {
    onProgress?.(f.name);
    try {
      if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
        out.images.push(await imageToJpeg(f));
        out.notes.push(t('key.uploaded', { name: f.name, n: 1 }));
      } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const pdf = await openPdf(f);
        try {
          const n = Math.min(pdf.pageCount, MAX_PDF_PAGES);
          for (let p = 1; p <= n; p++) out.images.push(await canvasToJpeg(await pdf.renderPage(p, { rotation: 0, scale: PDF_SCALE })));
          out.notes.push(pdf.pageCount > n ? t('key.pdfTruncated', { name: f.name, n }) : t('key.uploaded', { name: f.name, n }));
        } finally { pdf.close(); }
      } else {
        const text = await api.extractText(f.name, await f.arrayBuffer());
        out.text += (out.text ? '\n\n' : '') + text;
        out.notes.push(t('key.uploadedText', { name: f.name, n: text.length }));
      }
    } catch (e) { out.notes.push(`${f.name}: ${(e as Error).message}`); }
  }
  return out;
}
