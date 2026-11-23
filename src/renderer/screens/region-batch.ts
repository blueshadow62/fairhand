import { identityMask } from '../../core/key.js';
import type { AnswerKey, MaskRect } from '../../core/types.js';
import type { SetData } from '../../shared/ipc.js';
import { api, imageUrl } from '../lib/api.js';
import { MASK_FILL, toPixels } from '../lib/answer-crop.js';
import { el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { anonOrder } from '../lib/item-review.js';
import { attachRectDrag } from '../lib/rect-drag.js';
import { nextUnit, regionAt, regionChanges, regionCount, setRegion, startDraft, stepUnit, undoRegion, unitOrder, type Regions } from '../lib/region-batch.js';
import { makeLeaveGuard } from '../lib/screen-utils.js';

/** 실행마다 새로 정한다. 겹쳐 볼 다른 장과 그 '답안 n' 번호가 장 번호를 따르지 않게 */
const SALT = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
/** 겹쳐 볼 다른 장 수(지금 '답 칸 지정' 창의 미리보기와 같다) */
const OTHER_SHEETS = 4;
const ZOOM_MIN = 1, ZOOM_MAX = 4;
const KEY_SHORT = 40;

export interface RegionBatchOpts {
  data: Pick<SetData, '폴더' | 'key' | 'transcripts'>;
  /** 저장이 된 뒤. 새 정답표와 바꾼 단위 수 */
  onSaved(key: AnswerKey, n: number): void;
}

/**
 * '답 칸 한꺼번에 잡기' 창: 전사된 첫 장을 크게 펴 놓고, 왼쪽 단위 목록의 차례대로 끌어서 답 칸을 잡는다.
 * 하나를 잡으면 답 칸이 없는 다음 단위로 넘어가고, 저장을 누를 때 한 번에 쓴다. 신원 영역은 어느 장을 보든 늘 칠한다
 */
export function openRegionBatch(o: RegionBatchOpts): void {
  const d = o.data, order = unitOrder(d.key), pages = d.transcripts.map(x => x.page);
  if (!order.length || !pages.length) return;
  const identity = identityMask(d.key);
  const info = new Map<string, { 설명: string; 정답: string | null }>([
    ...d.key.정량.map(u => [u.id, { 설명: u.설명, 정답: u.정답 }] as const),
    ...d.key.정성.map(u => [u.id, { 설명: u.설명, 정답: null }] as const)]);
  let initial: Regions = { ...d.key.답영역 };
  let draft = startDraft(initial);
  let sel = order.find(id => !initial[id]) ?? order[0]!;
  let dragging: MaskRect | null = null;
  let busy = false, allowClose = false, asking = false;

  // 영역을 잡는 기준 장은 지금 창과 같은 전사된 첫 장. 겹쳐 볼 다른 장은 익명 순서로 몇 장
  const first = Math.min(...pages);
  const sheets = [{ page: first, label: t('region.batch.base') },
    ...anonOrder(SALT, '답칸', pages).filter(p => p !== first).slice(0, OTHER_SHEETS).map((page, i) => ({ page, label: t('item.answerN', { n: i + 1 }) }))];
  let sheet = 0;
  const imgs = new Map<number, HTMLImageElement>(), failed = new Set<number>();
  let zoom = ZOOM_MIN;

  // ── 틀 ──
  const rows = new Map<string, { btn: HTMLButtonElement; mark: HTMLElement }>();
  const list = el('div', { class: 'rb-units', role: 'group', 'aria-label': t('region.batch.units') }, ...order.map(id => {
    const u = info.get(id)!, key = u.정답 === null ? t('unit.응답형') : u.정답.length > KEY_SHORT ? `${u.정답.slice(0, KEY_SHORT)}…` : u.정답;
    const mark = el('span', { class: 'rb-mark' });
    const btn = el('button', { class: 'rb-unit', 'data-unit': id, onclick: () => pick(id) },
      el('span', { class: 'line' }, el('strong', {}, id), el('span', { class: 'desc', title: u.설명 }, u.설명), mark),
      el('span', { class: 'key', title: u.정답 ?? '' }, key));
    rows.set(id, { btn, mark });
    return btn;
  }));
  const count = el('strong', { class: 'rb-count' });
  const current = el('div', { class: 'rb-current' });
  const clearBtn = el('button', { class: 'small', onclick: () => edit(null) }, t('region.batch.clear'));
  const undoBtn = el('button', { class: 'small', onclick: () => undo() }, t('region.batch.undo'));
  const sheetButtons = sheets.map((s, i) => el('button', { class: 'small', 'aria-pressed': 'false', onclick: () => showSheet(i) }, s.label));
  const zoomText = el('span', { class: 'zoom' });
  const canvas = el('canvas', { class: 'page' });
  const loading = el('div', { class: 'rb-loading' }, t('region.batch.loading'));
  const wrap = el('div', { class: 'page-wrap' }, canvas, loading);
  const status = el('div', { class: 'rb-status', role: 'status' });
  const saveBtn = el('button', { class: 'primary', onclick: () => void saveAndClose() }, t('common.save'));
  const closeBtn = el('button', { onclick: () => void requestClose() }, t('region.batch.close'));
  const dlg = el('dialog', { class: 'region-batch', 'aria-labelledby': 'region-batch-title' },
    el('div', { class: 'rb-head' }, el('h3', { id: 'region-batch-title' }, t('region.batch.title')), count, el('span', { class: 'muted' }, t('region.batch.keys'))),
    el('div', { class: 'muted' }, t('region.batch.help')),
    el('div', { class: 'rb-body' }, list,
      el('div', { class: 'rb-view' },
        el('div', { class: 'rb-bar' }, current, clearBtn, undoBtn),
        el('div', { class: 'rb-bar' },
          el('span', { class: 'muted', title: t('region.batch.sheetsHelp') }, t('region.batch.sheets')), el('div', { class: 'seg rb-sheets', role: 'group', 'aria-label': t('region.batch.sheets') }, ...sheetButtons),
          el('span', { class: 'rb-gap' }),
          el('button', { class: 'small', 'aria-label': t('item.zoomOut'), title: t('item.zoomOut'), onclick: () => setZoom(zoom / 1.25) }, '−'), zoomText,
          el('button', { class: 'small', 'aria-label': t('item.zoomIn'), title: t('item.zoomIn'), onclick: () => setZoom(zoom * 1.25) }, '+'),
          el('button', { class: 'small', onclick: () => setZoom(ZOOM_MIN) }, t('review.fit')),
          el('button', { class: 'small', onclick: () => setZoom(2) }, t('region.batch.large'))),
        wrap)),
    el('div', { class: 'row actions' }, status, saveBtn, closeBtn));

  const changes = () => regionChanges(initial, draft.regions);
  const dirty = () => Object.keys(changes()).length > 0;

  // ── 그리기: 그림, 신원 영역(늘 칠함), 잡은 답 칸 모두(고른 단위는 색·굵기를 달리 해 맨 위에) ──
  function draw(): void {
    const img = imgs.get(sheets[sheet]!.page);
    loading.textContent = failed.has(sheets[sheet]!.page) ? t('item.imageFailed') : t('region.batch.loading');
    loading.hidden = !!img;
    if (!img) { canvas.width = canvas.height = 0; return; }
    const W = img.naturalWidth, H = img.naturalHeight;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const id = toPixels(identity, W, H);
    g.fillStyle = MASK_FILL; g.fillRect(id.x, id.y, id.w, id.h);
    const shown: Regions = { ...draft.regions };
    if (dragging) shown[sel] = dragging;
    const fs = Math.max(16, Math.round(W / 48)); // 맞춤(폭 맞춤)으로 줄여 보여도 단위 id가 읽히게
    g.font = `700 ${fs}px Pretendard, sans-serif`; g.textBaseline = 'top'; g.textAlign = 'left';
    for (const u of [...order.filter(x => x !== sel), sel]) {
      const r0 = shown[u];
      if (!r0) continue;
      const on = u === sel, r = toPixels(r0, W, H), color = on ? '#e65100' : '#0277bd';
      if (on) { g.fillStyle = 'rgba(230, 81, 0, .12)'; g.fillRect(r.x, r.y, r.w, r.h); }
      g.setLineDash(on && dragging ? [Math.round(W / 160), Math.round(W / 260)] : []);
      g.strokeStyle = color; g.lineWidth = on ? Math.max(3, Math.round(W / 320)) : Math.max(2, Math.round(W / 700));
      g.strokeRect(r.x, r.y, r.w, r.h);
      g.setLineDash([]);
      // 단위 id는 칸 왼쪽 위 바깥에(칸 안의 손글씨를 가리지 않게). 위에 자리가 없으면 칸 안쪽 위에
      const tw = g.measureText(u).width + fs * 0.6, th = fs * 1.3, ty = r.y - th >= 0 ? r.y - th : r.y;
      g.fillStyle = color; g.fillRect(r.x, ty, tw, th);
      g.fillStyle = '#fff'; g.fillText(u, r.x + fs * 0.3, ty + fs * 0.15);
    }
  }

  function render(): void {
    const regions = draft.regions;
    for (const [id, r] of rows) {
      const on = id === sel, has = !!regions[id];
      r.btn.classList.toggle('active', on); r.btn.classList.toggle('has', has);
      if (on) r.btn.setAttribute('aria-current', 'true'); else r.btn.removeAttribute('aria-current');
      r.mark.textContent = has ? `✓ ${t('region.batch.has')}` : t('region.batch.missing');
    }
    count.textContent = t('region.batch.count', { n: regionCount(order, regions), total: order.length });
    const u = info.get(sel)!;
    current.replaceChildren(el('span', { class: 'muted' }, t('region.batch.current')), el('strong', {}, sel), el('span', { class: 'desc', title: u.설명 }, u.설명));
    clearBtn.disabled = busy || !regions[sel];
    undoBtn.disabled = busy || !draft.edits.length;
    const n = Object.keys(changes()).length;
    saveBtn.disabled = busy || !n;
    closeBtn.disabled = busy;
    if (!busy && !status.classList.contains('error')) status.textContent = n ? t('region.batch.changes', { n }) : t('region.batch.noChanges');
    sheetButtons.forEach((b, i) => { b.classList.toggle('active', i === sheet); b.setAttribute('aria-pressed', String(i === sheet)); });
    draw();
  }

  /** 단위를 고르고 목록에서 보이게 한다. 목록에 초점이 있으면 초점도 옮긴다(위·아래 키로 목록을 훑을 때) */
  function pick(id: string): void {
    sel = id;
    render();
    const btn = rows.get(id)!.btn;
    btn.scrollIntoView({ block: 'nearest' });
    if (list.contains(document.activeElement)) btn.focus({ preventScroll: true });
  }

  function edit(rect: MaskRect | null): void {
    if (busy) return;
    clearError();
    const next = setRegion(draft, sel, rect);
    if (next === draft) { render(); return; }
    draft = next;
    if (rect) pick(nextUnit(order, draft.regions, sel)); else render();
  }

  function undo(): void {
    if (busy) return;
    const u = undoRegion(draft);
    if (!u) return;
    clearError();
    draft = u.draft;
    pick(u.단위);
  }

  attachRectDrag(canvas, {
    enabled: () => !busy && !!imgs.get(sheets[sheet]!.page),
    onMove: r => { dragging = r; draw(); },
    onDone: r => { dragging = null; if (r) edit(r); else draw(); },
    onTap: p => { const id = regionAt(order, draft.regions, p); if (id) pick(id); },
  });

  // ── 다른 장으로 보기·확대 ──
  function load(page: number): void {
    if (imgs.has(page) || failed.has(page)) return;
    // 문서에 붙이지 않는 그림이라 칠하기 전 모습은 화면에 나가지 않는다
    const img = new Image();
    img.src = imageUrl(d.폴더, page);
    img.decode().then(() => { if (!dlg.open) return; imgs.set(page, img); if (sheets[sheet]!.page === page) draw(); })
      .catch(() => { failed.add(page); if (dlg.open && sheets[sheet]!.page === page) draw(); });
  }
  function showSheet(i: number): void { sheet = i; load(sheets[i]!.page); render(); }

  /** 확대를 바꿔도 보던 곳이 가운데에 머물게 */
  function setZoom(z: number): void {
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / (wrap.scrollWidth || 1), cy = (wrap.scrollTop + wrap.clientHeight / 2) / (wrap.scrollHeight || 1);
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
    canvas.style.width = `${zoom * 100}%`;
    zoomText.textContent = `${Math.round(zoom * 100)}%`;
    wrap.scrollLeft = cx * wrap.scrollWidth - wrap.clientWidth / 2;
    wrap.scrollTop = cy * wrap.scrollHeight - wrap.clientHeight / 2;
  }
  wrap.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });

  // ── 저장·닫기 ──
  function clearError(): void { status.classList.remove('error'); status.setAttribute('role', 'status'); }
  function showError(msg: string): void { status.classList.add('error'); status.setAttribute('role', 'alert'); status.textContent = msg; }
  async function save(): Promise<void> {
    const c = changes(), n = Object.keys(c).length;
    if (!n || busy) return;
    busy = true; clearError(); status.textContent = t('region.batch.saving'); render();
    try {
      const key = await api.setAnswerRegions(d.폴더, c);
      initial = { ...key.답영역 };
      draft = { regions: { ...initial }, edits: [] };
      o.onSaved(key, n);
    } catch (e) {
      showError((e as Error).message);
    } finally { busy = false; render(); }
  }
  const leaveOk = makeLeaveGuard(api, { isDirty: dirty, save, discard: () => undefined });
  function finish(): void { allowClose = true; dlg.close(); }
  async function saveAndClose(): Promise<void> { await save(); if (!dirty()) finish(); }
  /** 저장하지 않은 변경이 있으면 묻고 닫는다. 저장하는 중이면 닫지 않는다 */
  async function requestClose(): Promise<void> {
    if (busy || asking) return;
    asking = true;
    try { if (await leaveOk()) finish(); } catch (e) { showError((e as Error).message); } finally { asking = false; }
  }

  // 글자 입력 칸이 없는 창이라 키를 창 전체에서 받는다. 목록 줄을 다시 그리지 않아 초점이 창 밖으로 빠지지 않는다
  const onKey = (e: KeyboardEvent): void => {
    if (!dlg.open || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); void requestClose(); return; }
    if (busy || asking) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (mod) return;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pick(stepUnit(order, sel, 1)); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); pick(stepUnit(order, sel, -1)); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); edit(null); }
  };
  document.addEventListener('keydown', onKey);
  dlg.addEventListener('cancel', e => { e.preventDefault(); void requestClose(); });
  dlg.addEventListener('close', () => {
    // 브라우저가 Esc를 거듭 누른 것을 막지 않고 창을 닫는 경우가 있다. 묻지 않고 닫혔으면 다시 열고 묻는다
    if (!allowClose) { dlg.showModal(); void requestClose(); return; }
    document.removeEventListener('keydown', onKey);
    for (const img of imgs.values()) img.src = '';
    imgs.clear();
    dlg.remove();
  });

  document.body.append(dlg);
  dlg.showModal();
  setZoom(ZOOM_MIN);
  render();
  rows.get(sel)!.btn.focus(); // 처음부터 위·아래 키로 목록을 훑게
  rows.get(sel)!.btn.scrollIntoView({ block: 'nearest' });
  for (const s of sheets) load(s.page);
}
