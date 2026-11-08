import type { MaskRect } from '../../core/types.js';
import { imageUrl } from '../lib/api.js';
import { MASK_FILL, cropRect, identityInCrop, toPixels } from '../lib/answer-crop.js';
import { el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { attachRectDrag } from '../lib/rect-drag.js';

export interface RegionEditorOpts {
  폴더: string;
  단위: string;
  current: MaskRect | null;
  identity: MaskRect;
  /** 영역을 잡을 장(전사된 첫 장) */
  page: number;
  /** 같은 영역으로 잘라 미리 볼 다른 장과 그 익명 번호 */
  previews: { page: number; n: number }[];
  /** 저장(null이면 영역 지우기). 되면 true를 돌려주고 창을 닫는다 */
  save(rect: MaskRect | null): Promise<boolean>;
}

const PREVIEW_W = 420;

/**
 * 답 칸 지정 창: 한 장의 쪽 그림을 폭 맞춤으로 보이고(신원 영역은 늘 칠함) 위를 끌어 답 칸을 잡는다.
 * 아래 줄에서 다른 장을 같은 영역으로 잘라 보여 스캔 위치가 어긋나 답이 잘리는지 바로 보게 한다
 */
export function openRegionEditor(o: RegionEditorOpts): void {
  let committed = o.current; // 저장할 영역(끌기를 놓을 때 정해진다)
  let shown = o.current;     // 그리는 영역(끄는 동안에는 끄는 영역)
  let page: HTMLImageElement | null = null;
  const shots = new Map<number, HTMLImageElement>(); // 미리보기 원본. 창을 닫으면 놓는다
  const previewCanvases = new Map<number, HTMLCanvasElement>();

  const canvas = el('canvas', { class: 'page', 'aria-label': t('item.region.title', { id: o.단위 }) });
  const saveBtn = el('button', { class: 'primary', disabled: !committed, onclick: () => void finish(committed) }, t('common.save'));
  const dlg = el('dialog', { class: 'region-editor', 'aria-labelledby': 'region-editor-title' },
    el('h3', { id: 'region-editor-title' }, t('item.region.title', { id: o.단위 })),
    el('div', { class: 'muted' }, t('item.region.help')),
    el('div', { class: 'page-wrap' }, canvas),
    el('div', { class: 'preview-head' }, el('strong', {}, t('item.region.preview')), el('span', { class: 'muted' }, t('item.region.previewHelp'))),
    el('div', { class: 'previews' }, ...o.previews.map(p => {
      const c = el('canvas', { 'aria-label': t('item.grid.cell', { n: p.n }) });
      previewCanvases.set(p.page, c);
      return el('figure', { class: 'preview' }, c, el('figcaption', {}, t('item.answerN', { n: p.n })));
    })),
    el('div', { class: 'row actions' }, saveBtn, el('button', { onclick: () => dlg.close() }, t('item.region.cancel')),
      o.current ? el('button', { class: 'danger', onclick: () => void finish(null) }, t('item.region.clear')) : null));

  /** 쪽 그림, 신원 영역(늘 칠함), 답 칸(실선)과 실제로 자를 영역(점선, 사방 2% 여유) */
  function drawPage(): void {
    if (!page?.naturalWidth) return;
    const W = page.naturalWidth, H = page.naturalHeight;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const g = canvas.getContext('2d')!;
    g.drawImage(page, 0, 0);
    const id = toPixels(o.identity, W, H);
    g.fillStyle = MASK_FILL; g.fillRect(id.x, id.y, id.w, id.h);
    if (!shown) return;
    const c = toPixels(cropRect(shown), W, H), r = toPixels(shown, W, H);
    g.strokeStyle = '#0277bd';
    g.setLineDash([Math.round(W / 100), Math.round(W / 160)]); g.lineWidth = Math.max(2, Math.round(W / 700)); g.strokeRect(c.x, c.y, c.w, c.h);
    g.setLineDash([]); g.lineWidth = Math.max(3, Math.round(W / 400)); g.strokeRect(r.x, r.y, r.w, r.h);
  }

  /** 다른 장을 같은 영역(여유 포함)으로 잘라 그리고, 신원 영역과 겹친 곳은 칠한다 */
  function drawPreviews(): void {
    for (const p of o.previews) {
      const img = shots.get(p.page), c = previewCanvases.get(p.page)!;
      if (!img?.naturalWidth || !shown) { c.width = c.height = 0; continue; }
      const crop = cropRect(shown), src = toPixels(crop, img.naturalWidth, img.naturalHeight), scale = Math.min(1, PREVIEW_W / src.w);
      c.width = Math.max(1, Math.round(src.w * scale)); c.height = Math.max(1, Math.round(src.h * scale));
      const g = c.getContext('2d')!;
      g.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, c.width, c.height);
      const hide = identityInCrop(crop, o.identity);
      if (hide) { const h = toPixels(hide, c.width, c.height); g.fillStyle = MASK_FILL; g.fillRect(h.x, h.y, h.w, h.h); }
    }
  }

  attachRectDrag(canvas, {
    enabled: () => !!page,
    onMove: r => { shown = r; drawPage(); drawPreviews(); },
    onDone: r => { if (r) committed = r; shown = committed; saveBtn.disabled = !committed; drawPage(); drawPreviews(); },
  });

  async function finish(rect: MaskRect | null): Promise<void> {
    saveBtn.disabled = true;
    if (await o.save(rect)) dlg.close(); else saveBtn.disabled = !committed;
  }

  // 문서에 붙이지 않는 그림이라 칠하기 전 모습은 화면에 나가지 않는다
  const load = (n: number): Promise<HTMLImageElement> => { const img = new Image(); img.src = imageUrl(o.폴더, n); return img.decode().then(() => img); };
  void load(o.page).then(img => { if (dlg.open) { page = img; drawPage(); } }).catch(() => undefined);
  for (const p of o.previews) void load(p.page).then(img => { if (dlg.open) { shots.set(p.page, img); drawPreviews(); } }).catch(() => undefined);

  dlg.addEventListener('close', () => {
    for (const img of [page, ...shots.values()]) if (img) img.src = '';
    page = null; shots.clear();
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
}
