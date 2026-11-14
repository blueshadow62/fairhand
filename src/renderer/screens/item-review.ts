import { identityMask, unitPoints } from '../../core/key.js';
import { essayMarks, essayTextMarks } from '../../core/rejudge.js';
import type { MaskRect, Panjeong, QtyUnit, QualUnit, Transcript } from '../../core/types.js';
import { unitChecked, type UnitResultItem } from '../../core/unit-results.js';
import type { SetData, UnitResultsResult } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl } from '../lib/api.js';
import { collapseToggle } from '../lib/collapse.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { MASK_FILL, cropAspect, cropRect, gridColumns, identityInCrop, toPixels } from '../lib/answer-crop.js';
import { answerSpot, spotScrollLeft, spotScrollTop } from '../lib/answer-spot.js';
import { cachedCrop, clearCrops, cropKey, loadCrop } from '../lib/crop-cache.js';
import { essayNodes, essaySpanViews, essayTextOf } from '../lib/essay-view.js';
import { anonLabels, anonOrder, groupAnswers, keyLine, progress, sortGroups, unitDone, unitSummaries, type AnswerGroup } from '../lib/item-review.js';
import { attachRectDrag } from '../lib/rect-drag.js';
import { openRegionEditor } from './region-editor.js';

/** 실행마다 새로 정한다. 익명 줄 순서가 실행마다 달라 지난번 순서로 학생을 짐작하지 못한다 */
const SALT = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
const VERDICTS: Panjeong[] = ['O', 'X', '빈칸'];

export interface ItemPane { root: HTMLElement; render(d: SetData | null): void }
export interface ItemPaneDeps {
  notice: HTMLElement;
  /** 세트를 다시 읽어 두 탭을 다시 그린다(알림 칸도 비운다) */
  refresh(): Promise<void>;
  recordCases(): boolean;
  setRecordCases(on: boolean): void;
}

/**
 * 문항별 검토(신원 숨김): 왼쪽은 단위 목록, 가운데는 고른 단위의 답 묶음, 오른쪽은 필요할 때만 여는 그림.
 * 학년·반·번호·이름·식별 확신·장 번호·비고는 그리지 않는다. 동작마다 바로 저장해 저장하지 않은 상태가 없다
 */
export function createItemPane(ctx: Ctx, deps: ItemPaneDeps): ItemPane {
  const { showError, showInfo } = ctx;
  const units = el('div', { class: 'units' });
  const groups = el('div', { class: 'groups' });
  const root = el('div', { class: 'item-review hidden' }, units, groups);
  // 좁은 창에서 답 묶음·그림 칸을 넓히려고 단위 목록을 접는다. renderUnits가 목록을 다시 그릴 때마다 맨 위에 다시 붙인다
  const unitsToggle = collapseToggle({ target: root, cls: 'units-collapsed', pref: 'geulnun.review.unitsCollapsed', label: t('item.units.title'),
    collapse: t('item.units.collapse'), expand: t('item.units.expand'), focusKey: 'units-toggle' });
  let data: SetData | null = null;
  let unitId: string | null = null;
  let onlyUnchecked = false;
  let busy = false; // 저장과 엑셀 생성이 두 벌 돌지 않게 기다리는 동안 단추를 잠근다
  const open = new Set<string>(); // 펼친 묶음: 단위 + 정규 답
  const essayShown = new Set<string>(); // 연 글 전체: 단위 + 장(판정마다 다시 그려도 연 채로)
  let textEdit: string | null = null; // 글을 고치는 중인 답: 단위 + 장

  // 판정마다 다시 그려도 키보드 초점이 같은 묶음·같은 줄의 같은 단추로 돌아오게, 단추마다 바뀌지 않는 data-focus를 단다(장 번호 대신 익명 번호).
  // 기다리는 동안 단추가 잠겨 초점이 빠져도 기억해 두었다가 잠금이 풀린 뒤 돌려준다
  let keepFocus: string | null = null;
  const holdFocus = (): void => { const a = document.activeElement; if (a instanceof HTMLElement && root.contains(a) && a.dataset.focus) keepFocus = a.dataset.focus; };
  function restoreFocus(): void {
    if (!keepFocus || busy) return;
    const k = keepFocus; keepFocus = null;
    [...root.querySelectorAll<HTMLElement>('[data-focus]')].find(x => x.dataset.focus === k)?.focus({ preventScroll: true });
  }

  // ── 손글씨 격자: 답 칸이 있는 단위는 펼친 묶음의 답마다 같은 자리를 잘라 보인다. 원본이 무거워 화면에 들어온 칸만 읽는다 ──
  const lazy = new WeakMap<Element, () => Promise<HTMLCanvasElement>>();
  const seen = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const c = e.target as HTMLCanvasElement;
      lazy.get(c)?.().then(src => { if (c.isConnected) paintCrop(c, src); }).catch(() => { c.classList.add('failed'); c.title = t('item.imageFailed'); });
    }
  }, { root: groups, rootMargin: '300px 0px' });
  function paintCrop(c: HTMLCanvasElement, src: HTMLCanvasElement): void {
    c.width = src.width; c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    c.style.setProperty('--ar', String(src.width / src.height)); // 그림을 받기 전에는 A4로 어림한 모양이었다
  }
  /** 격자 열 수는 칸 모양과 지금 너비로 정한다(그림 칸을 열고 닫거나 창 크기를 바꾸면 다시) */
  const fitGrids = (): void => { for (const g of groups.querySelectorAll<HTMLElement>('.hw-grid')) g.style.gridTemplateColumns = `repeat(${gridColumns(g.clientWidth, Number(g.dataset.aspect))}, minmax(0, 1fr))`; };
  new ResizeObserver(fitGrids).observe(groups);

  function render(d: SetData | null): void {
    if (d?.폴더 !== data?.폴더) { open.clear(); essayShown.clear(); textEdit = null; unitId = null; closeViewer(false); clearCrops(); }
    data = d;
    if (!d) { clear(units); clear(groups); return; }
    if (view && !d.transcripts.some(x => x.page === view!.page)) closeViewer(false);
    else draw(); // 다시 읽은 정답표의 신원 영역으로 다시 칠한다
    const sums = unitSummaries(d.key, d.transcripts);
    if (!unitId || !sums.some(s => s.id === unitId)) unitId = (sums.find(s => !unitDone(s)) ?? sums[0])?.id ?? null;
    renderUnits(); renderGroups();
  }

  function pick(id: string): void {
    if (id !== unitId) closeViewer(false); // 익명 번호는 단위마다 달라 열어 둔 그림의 '답안 n'이 새 단위와 맞지 않는다
    unitId = id;
    renderUnits(); renderGroups(); groups.scrollTop = 0;
  }

  // ── 그림 보기: 신원 영역을 칠한 그림만 그린다 ──
  const canvas = el('canvas', { class: 'sheet' });
  const zoomText = el('span', { class: 'zoom' });
  const viewBar = el('div', { class: 'viewer-bar' });
  const viewHelp = el('div', { class: 'view-help' });
  const spotBox = el('div', { class: 'answer-spot', 'aria-hidden': 'true' }); // 이 단위의 답 자리를 잠깐 보이는 띠
  const sheetWrap = el('div', { class: 'sheet-wrap' }, canvas, spotBox);
  const viewer = el('div', { class: 'item-viewer hidden' }, viewBar, viewHelp, sheetWrap);
  root.append(viewer);
  let view: { page: number; n: number; img: HTMLImageElement | null } | null = null;
  let zoom = 1, editing = false;
  let dragging: MaskRect | null = null; // 끄는 중인 새 영역

  const setZoom = (z: number) => { zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100)); canvas.style.width = `${zoom * 100}%`; zoomText.textContent = `${Math.round(zoom * 100)}%`; spotBox.classList.remove('flash'); };
  sheetWrap.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  setZoom(1);

  function renderViewBar(): void {
    holdFocus();
    clear(viewBar);
    canvas.classList.toggle('editing', editing);
    if (!view) return;
    put(viewBar, el('strong', {}, t('item.answerN', { n: view.n })),
      el('button', { class: 'small', 'data-focus': 'vb:out', 'aria-label': t('item.zoomOut'), title: t('item.zoomOut'), onclick: () => setZoom(zoom - 0.25) }, '−'), zoomText,
      el('button', { class: 'small', 'data-focus': 'vb:in', 'aria-label': t('item.zoomIn'), title: t('item.zoomIn'), onclick: () => setZoom(zoom + 0.25) }, '+'),
      el('button', { class: 'small', 'data-focus': 'vb:fit', onclick: () => setZoom(1) }, t('review.fit')),
      el('button', { class: `small${editing ? ' active' : ''}`, 'data-focus': 'vb:edit', 'aria-pressed': String(editing), onclick: () => { editing = !editing; dragging = null; renderViewBar(); draw(); } }, t('item.maskEdit')),
      editing ? el('button', { class: 'small', 'data-focus': 'vb:default', onclick: () => void saveMask(null) }, t('item.maskDefault')) : null,
      el('button', { class: 'small close', 'data-focus': 'vb:close', 'aria-label': t('item.viewClose'), title: t('item.viewClose'), onclick: () => closeViewer() }, '×'));
    viewHelp.textContent = t(editing ? 'item.maskEditHelp' : 'item.maskHelp');
    restoreFocus();
  }

  /** 연 그림을 이 단위의 답 자리로(교사가 잡은 답 칸이 먼저, 없으면 AI가 전사 때 돌려준 위치). 그림을 받아 처음 그린 뒤 한 번 */
  function showSpot(): void {
    const tr = view && data ? data.transcripts.find(x => x.page === view!.page) : undefined;
    const s = tr && unitId ? answerSpot(data!.key, tr, unitId) : null;
    if (!s || !canvas.offsetHeight) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight, top = canvas.offsetTop + s.y * H, left = canvas.offsetLeft + s.x * W;
    const toLeft = s.출처 === '답칸' ? spotScrollLeft({ left, scroll: sheetWrap.scrollLeft, view: sheetWrap.clientWidth }) : null;
    sheetWrap.scrollTo({ top: spotScrollTop({ top, view: sheetWrap.clientHeight, max: sheetWrap.scrollHeight - sheetWrap.clientHeight }), ...(toLeft === null ? {} : { left: toLeft }) });
    Object.assign(spotBox.style, { top: `${top}px`, left: `${left}px`, width: `${s.w * W}px`, height: `${s.h * H}px` });
    spotBox.classList.remove('flash'); void spotBox.offsetWidth; spotBox.classList.add('flash');
  }

  function openViewer(page: number, n: number): void {
    if (!data) return;
    view = { page, n, img: null }; editing = false; dragging = null;
    canvas.width = canvas.height = 0; // 앞서 본 답안이 새 그림을 받기 전까지 남지 않게
    spotBox.classList.remove('flash');
    root.classList.add('viewing'); viewer.classList.remove('hidden');
    renderViewBar(); renderGroups();
    const img = new Image(); // 문서에 붙이지 않는 그림이라 가리기 전 모습은 화면에 나가지 않는다
    img.onload = () => { if (view?.page === page) { view.img = img; draw(); showSpot(); } };
    img.onerror = () => { if (view?.page === page) showError(t('item.imageFailed')); };
    img.src = imageUrl(data.폴더, page);
  }

  function closeViewer(rerender = true): void {
    if (!view) return;
    view = null; editing = false; dragging = null;
    canvas.width = canvas.height = 0;
    spotBox.classList.remove('flash');
    root.classList.remove('viewing'); viewer.classList.add('hidden');
    if (rerender) renderGroups();
  }

  /** 그림과 가림을 한 함수 안에서 그린다. 화면은 함수가 끝난 뒤에 바뀌므로 가리기 전 모습이 나갈 틈이 없다 */
  function draw(): void {
    const img = view?.img;
    if (!img?.naturalWidth || !data) return;
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
    const g = canvas.getContext('2d')!, W = canvas.width, H = canvas.height;
    g.drawImage(img, 0, 0);
    // 끄는 동안에도 저장된 영역을 함께 칠해 머리 줄이 드러나지 않게 한다. 경계는 바깥쪽으로 올려 한 줄도 새지 않게
    for (const r of [identityMask(data.key), ...(dragging ? [dragging] : [])]) {
      const { x, y, w, h } = toPixels(r, W, H);
      g.fillStyle = MASK_FILL; g.fillRect(x, y, w, h);
      if (w > W * 0.2 && h > H * 0.02) {
        g.fillStyle = '#fff'; g.font = `600 ${Math.round(Math.min(h * 0.45, W * 0.03))}px Pretendard, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(t('item.maskLabel'), x + w / 2, y + h / 2, w * 0.9);
      }
    }
    if (dragging) { g.strokeStyle = '#d33'; g.lineWidth = Math.max(3, Math.round(W / 300)); g.strokeRect(dragging.x * W, dragging.y * H, dragging.w * W, dragging.h * H); }
  }

  async function saveMask(r: MaskRect | null): Promise<void> {
    if (!data) return;
    const d = data;
    try { d.key = await api.setIdentityMask(d.폴더, r); showInfo(t(r ? 'item.maskSaved' : 'item.maskReset')); }
    catch (e) { showError((e as Error).message); }
    editing = false; dragging = null; renderViewBar(); draw();
  }
  attachRectDrag(canvas, { enabled: () => editing && !!view?.img, onMove: r => { dragging = r; draw(); }, onDone: r => { if (r) void saveMask(r); else { dragging = null; draw(); } } });

  document.addEventListener('keydown', e => {
    // 문항별 화면이 보일 때만. 답 칸 지정 창이 열려 있으면 Esc는 그 창을 닫는 데 쓴다
    if (e.key !== 'Escape' || !view || root.offsetParent === null || document.querySelector('dialog[open]')) return;
    if (editing) { editing = false; dragging = null; renderViewBar(); draw(); } else closeViewer();
  });

  function renderUnits(): void {
    holdFocus();
    units.replaceChildren(unitsToggle);
    if (!data) return;
    const d = data, sums = unitSummaries(d.key, d.transcripts), p = progress(d.key, d.transcripts);
    const only = el('input', { type: 'checkbox', 'data-focus': 'only', checked: onlyUnchecked, onchange: () => { onlyUnchecked = only.checked; renderUnits(); } });
    units.append(el('div', { class: 'filters' },
      el('div', {}, t('item.progress', { units: p.단위, unitsTotal: p.단위전체, pages: p.장, pagesTotal: p.장전체 })),
      el('label', {}, only, t('item.onlyUnchecked'))));
    const shown = sums.filter(s => !onlyUnchecked || !unitDone(s));
    if (!shown.length) { units.append(el('div', { class: 'unit-empty muted' }, t(sums.length ? 'item.allDone' : 'item.noUnits'))); restoreFocus(); return; }
    for (const s of shown) {
      const on = s.id === unitId, done = unitDone(s);
      units.append(el('button', { class: `unit${on ? ' active' : ''}${done ? ' done' : ''}`, 'data-focus': `unit:${s.id}`, 'aria-current': on ? 'true' : null, onclick: () => pick(s.id) },
        el('span', { class: 'line' }, el('strong', {}, s.id), el('span', { class: 'desc', title: s.설명 }, s.설명)),
        el('span', { class: 'meta' }, t('item.unitChecked', { done: s.확인, total: s.전체 }), done ? ' ✓' : null,
          s.갈림 ? el('span', { class: 'tag-warn', title: t('item.splitCountTitle') }, t('item.splitCount', { n: s.갈림 })) : null)));
    }
    restoreFocus();
  }

  function renderGroups(): void {
    holdFocus();
    const scroll = groups.scrollTop; // 판정을 넣은 뒤 다시 그려도 보던 자리에 머문다
    seen.disconnect(); // 지난번 칸은 지운다
    clear(groups);
    if (!data) return;
    const d = data;
    if (!d.transcripts.length) { groups.append(el('div', { class: 'muted' }, t('item.noTranscripts'))); return; }
    const qty = d.key.정량.find(u => u.id === unitId), qual = d.key.정성.find(u => u.id === unitId);
    if (!qty && !qual) { groups.append(el('div', { class: 'muted' }, t('item.noUnits'))); return; }
    const u = (qty ?? qual)!;
    const labels = anonLabels(SALT, u.id, d.transcripts.map(x => x.page));
    const byPage = new Map(d.transcripts.map(x => [x.page, x]));
    const region = d.key.답영역?.[u.id];
    const grid = region ? gridOf(region, d) : null;
    const qtyGroups = qty ? sortGroups(groupAnswers(d.transcripts, qty.id)) : [];
    groups.append(el('div', { class: 'muted' }, t('item.notice')), head(u, !!qty, d.transcripts.every(x => unitChecked(x, u.id)), !!region, qtyGroups));
    if (!region) groups.append(el('div', { class: 'region-hint band info' }, el('span', {}, t('item.region.hint')),
      el('button', { class: 'small', 'data-focus': 'region-hint', onclick: () => editRegion(u) }, t('item.region.set'))));
    const anon = [...labels].sort(([, a], [, b]) => a - b);
    if (qty) for (const g of qtyGroups) groups.append(groupBox(qty, g, labels, byPage, grid));
    else if (grid) groups.append(gridBox(grid, anon.map(([page, n]) => qualCell(qual!, byPage.get(page)!, n, grid)), 'qual-list'));
    else groups.append(el('div', { class: 'qual-list' }, ...anon.map(([page, n]) => qualRow(qual!, byPage.get(page)!, n))));
    fitGrids();
    groups.scrollTop = scroll;
    restoreFocus();
  }

  function head(u: QtyUnit | QualUnit, isQty: boolean, allChecked: boolean, hasRegion: boolean, qtyGroups: AnswerGroup[]): HTMLElement {
    const 유형 = isQty ? (u as QtyUnit).유형 : '응답형';
    const cases = el('input', { type: 'checkbox', 'data-focus': 'cases', checked: deps.recordCases(), onchange: () => deps.setRecordCases(cases.checked) });
    const keys = qtyGroups.map(g => `${u.id}\u0000${g.정규}`), allOpen = keys.length > 0 && keys.every(k => open.has(k));
    return el('div', { class: 'ir-head' },
      el('div', { class: 'row' }, el('strong', { class: 'unit-id' }, u.id), 유형 ? el('span', { class: 'muted' }, t(`unit.${유형}`)) : null,
        unitPoints(u) === 1 ? null : el('span', { class: 'muted' }, t('review.points', { n: unitPoints(u) })),
        el('button', { class: 'primary', 'data-focus': 'all', disabled: busy || allChecked, title: t('item.confirmAllTitle'), onclick: () => void send(u.id, data!.transcripts.map(x => ({ page: x.page }))) }, t('item.confirmAll')),
        el('button', { 'data-focus': 'region', onclick: () => editRegion(u) }, t(hasRegion ? 'item.region.edit' : 'item.region.set')),
        hasRegion && isQty ? el('button', { 'data-focus': 'hw-all', onclick: () => { for (const k of keys) if (allOpen) open.delete(k); else open.add(k); renderGroups(); } },
          t(allOpen ? 'item.grid.collapseAll' : 'item.grid.showAll')) : null),
      el('div', { class: 'ir-desc' }, u.설명),
      isQty ? el('div', { class: 'muted' }, keyLine(u as QtyUnit)) : null,
      유형 === '논술형' ? el('div', { class: 'muted essay-help' }, el('mark', { class: 'key-hit' }, t('item.essay.markKey')),
        (u as QtyUnit).허용?.length ? el('mark', { class: 'key-hit allow' }, t('item.essay.markAllow')) : null, el('span', {}, t('item.essay.help'))) : null,
      // 글 전체를 받은 장이 있을 때만 밑줄 뜻을 알린다(옛 전사뿐이면 글 전체 칸이 없다)
      유형 === '논술형' && data?.transcripts.some(x => essayTextOf(x, u as QtyUnit) !== undefined)
        ? el('div', { class: 'muted essay-help' }, el('span', { class: 'found' }, t('item.essay.markFound')), el('span', {}, t('item.essay.helpFull'))) : null,
      isQty ? el('label', { class: 'cases', title: t('item.recordCasesTitle') }, cases, t('item.recordCases')) : null);
  }

  /** 논술형 답은 정답·허용 표기가 그대로 들어 있는 곳에 색을 입힌다(decide와 같은 기준). 다른 유형은 글 그대로 */
  const answerText = (u: QtyUnit, text: string): (string | HTMLElement)[] => essayMarks(u, text).map(p => p.근거
    ? el('mark', { class: `key-hit${p.근거 === '허용' ? ' allow' : ''}`, title: t(p.근거 === '허용' ? 'item.essay.markAllow' : 'item.essay.markKey') }, p.text) : p.text);

  /**
   * 논술형 단위의 펼친 답 아래 '글 전체'(접어 둠). 이 단위의 정답·허용 표기에 색, AI가 이 단위의 답으로 옮긴 부분에 밑줄.
   * 글을 받기 전에 전사한 장은 그리지 않는다
   */
  function essayFull(u: QtyUnit, tr: Transcript, n: number): HTMLElement | null {
    const text = essayTextOf(tr, u);
    if (text === undefined) return null;
    const k = `${u.id}\u0000${tr.page}`;
    const box = el('details', { class: 'essay-full', open: essayShown.has(k), ontoggle: () => { if (box.open) essayShown.add(k); else essayShown.delete(k); } },
      el('summary', { 'data-focus': `essay:${n}` }, t('item.essay.full')),
      el('div', { class: 'essay-text' }, text.trim() ? essayNodes(essaySpanViews(essayTextMarks([u], text, { [u.id]: tr.정량[u.id]?.답 ?? '' }), false))
        : el('span', { class: 'muted' }, t('review.essay.emptyText'))));
    return box;
  }

  /** 잘라 볼 영역(답 칸에 사방 2% 여유), 그 안에서 신원 영역과 겹쳐 칠할 곳, 칸 모양 */
  interface Grid { crop: MaskRect; hide: MaskRect | null; aspect: number }
  function gridOf(region: MaskRect, d: SetData): Grid {
    const crop = cropRect(region);
    return { crop, hide: identityInCrop(crop, identityMask(d.key)), aspect: cropAspect(crop) };
  }
  const gridBox = (grid: Grid, cells: HTMLElement[], cls = ''): HTMLElement => el('div', { class: `hw-grid${cls ? ` ${cls}` : ''}`, 'data-aspect': String(grid.aspect) }, ...cells);
  function hwCanvas(page: number, n: number, grid: Grid): HTMLCanvasElement {
    const c = el('canvas', { class: 'hw', 'aria-label': t('item.grid.cell', { n }) });
    c.style.setProperty('--ar', String(grid.aspect));
    const url = imageUrl(data!.폴더, page), hit = cachedCrop(cropKey(url, grid.crop, grid.hide));
    if (hit) paintCrop(c, hit);
    else { lazy.set(c, () => loadCrop(url, grid.crop, grid.hide)); seen.observe(c); }
    return c;
  }

  /** 답 칸 지정 창. 영역은 전사된 첫 장에서 잡고, 미리보기는 익명 순서로 다른 장 넷까지 */
  function editRegion(u: QtyUnit | QualUnit): void {
    if (!data) return;
    const d = data, pages = d.transcripts.map(x => x.page);
    if (!pages.length) return;
    const first = Math.min(...pages), labels = anonLabels(SALT, u.id, pages);
    openRegionEditor({ 폴더: d.폴더, 단위: u.id, current: d.key.답영역?.[u.id] ?? null, identity: identityMask(d.key), page: first,
      previews: anonOrder(SALT, u.id, pages).filter(p => p !== first).slice(0, 4).map(p => ({ page: p, n: labels.get(p)! })),
      save: async rect => {
        try {
          d.key = await api.setAnswerRegion(d.폴더, u.id, rect);
          clearCrops(); // 옛 영역으로 자른 그림은 다시 쓰지 않는다
          showInfo(t(rect ? 'item.region.saved' : 'item.region.cleared'));
          if (data === d) renderGroups();
          return true;
        } catch (e) { showError((e as Error).message); return false; }
      } });
  }

  const verdictButtons = (current: Panjeong | null, title: 'item.groupVerdict' | 'item.rowVerdict', focus: string, onPick: (v: Panjeong) => void): HTMLElement =>
    el('div', { class: 'verdicts', role: 'group' }, ...VERDICTS.map(v => el('button', { class: `v-${v}${v === current ? ' on' : ''}`, 'data-focus': `${focus}:${v}`, 'aria-pressed': String(v === current),
      disabled: busy, title: t(title), onclick: () => onPick(v) }, t(`verdict.${v}`))));

  const checkMark = (tr: Transcript, 단위: string): HTMLElement =>
    unitChecked(tr, 단위) ? el('span', { class: 'ok-text', title: t('item.checked') }, '✓') : el('span', { class: 'muted' }, t('item.unchecked'));

  // ── 글 고치기: AI가 옮긴 글을 손글씨와 견주어 고친다. 판정은 메인이 정한다(글자로 정해지면 맞추고, 아니면 확인을 풀어 선생님이 고르게) ──
  const isEditing = (단위: string, page: number): boolean => textEdit === `${단위}\u0000${page}`;
  const longText = (u: QtyUnit | QualUnit, s: string): boolean => ('유형' in u && u.유형 === '논술형') || s.includes('\n') || s.length > 40;
  const editButton = (단위: string, page: number, n: number): HTMLElement =>
    el('button', { class: 'small', 'data-focus': `edit:${n}`, disabled: busy, title: t('item.edit.title'),
      onclick: () => { textEdit = `${단위}\u0000${page}`; keepFocus = `edit-in:${n}`; renderGroups(); } }, t('item.edit.button'));
  /** 고치는 칸: Enter(여러 줄 칸은 Ctrl+Enter)로 저장, Esc로 그만둔다. 한글 조합 중의 Enter는 저장하지 않는다. 앞뒤 공백만 다르면 저장하지 않는다 */
  function textEditor(단위: string, page: number, n: number, current: string, long: boolean): HTMLElement {
    const attrs = { class: 'answer-edit', 'data-focus': `edit-in:${n}`, 'aria-label': t('item.edit.label', { n }) };
    const box: HTMLInputElement | HTMLTextAreaElement = long ? el('textarea', { ...attrs, rows: 4 }) : el('input', attrs);
    box.value = current;
    const cancel = (): void => { textEdit = null; keepFocus = `edit:${n}`; renderGroups(); };
    const save = (): void => {
      const text = box.value.trim();
      if (text === current.trim()) { cancel(); return; }
      textEdit = null; keepFocus = `edit:${n}`;
      void send(단위, [{ page, 답: text }], 'text');
    };
    box.addEventListener('keydown', ev => {
      const e = ev as KeyboardEvent; // input·textarea 둘 중 하나라 형이 Event로 잡힌다
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && !e.isComposing && (!long || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });
    return el('div', { class: 'answer-editor' }, box,
      el('div', { class: 'row' }, el('button', { class: 'small primary', onclick: save }, t('common.save')), el('button', { class: 'small', onclick: cancel }, t('item.edit.cancel')),
        el('span', { class: 'muted' }, long ? t('item.edit.hintLong', { key: /Mac/.test(navigator.platform) ? '⌘Enter' : 'Ctrl+Enter' }) : t('item.edit.hint'))));
  }

  function groupBox(u: QtyUnit, g: AnswerGroup, labels: Map<number, number>, byPage: Map<number, Transcript>, grid: Grid | null): HTMLElement {
    const k = `${u.id}\u0000${g.정규}`, isOpen = open.has(k);
    const same = VERDICTS.find(v => g.판정[v] === g.장.length) ?? null;
    const status = g.확인 === g.장.length ? el('span', { class: 'ok-text' }, `✓ ${t('item.checked')}`)
      : g.확인 ? el('span', {}, t('item.unitChecked', { done: g.확인, total: g.장.length })) : el('span', { class: 'muted' }, t('item.unchecked'));
    const box = el('div', { class: `group${g.갈림 ? ' mixed' : ''}` },
      el('div', { class: 'group-head' },
        el('button', { class: 'twisty', 'data-focus': `tw:${g.정규}`, 'aria-expanded': String(isOpen), title: t(isOpen ? 'item.collapse' : 'item.expand'), 'aria-label': t(isOpen ? 'item.collapse' : 'item.expand'),
          onclick: () => { if (isOpen) open.delete(k); else open.add(k); renderGroups(); } }, isOpen ? '▼' : '▶'),
        el('div', { class: 'answer' }, g.정규 ? answerText(u, g.대표) : el('span', { class: 'muted' }, t('item.emptyAnswer'))),
        el('div', { class: 'group-meta' }, el('span', {}, t('item.sheets', { n: g.장.length })),
          el('span', {}, VERDICTS.filter(v => g.판정[v]).map(v => `${t(`verdict.${v}`)} ${g.판정[v]}`).join(' · ')),
          g.갈림 ? el('span', { class: 'tag-warn', title: t('item.splitTitle') }, t('item.split')) : null, status),
        verdictButtons(same, 'item.groupVerdict', `gv:${g.정규}`, v => void send(u.id, g.장.map(page => ({ page, 판정: v }))))));
    if (!isOpen) return box;
    // 줄 순서와 번호는 장 번호가 아니라 익명 번호(단위마다 다른 해시 순)
    const pages = [...g.장].sort((a, b) => labels.get(a)! - labels.get(b)!);
    if (grid) { box.append(gridBox(grid, pages.map(page => qtyCell(u, g, page, labels.get(page)!, byPage.get(page)!, grid)))); return box; }
    box.append(el('div', { class: 'group-rows' }, ...pages.map(page => {
      const tr = byPage.get(page)!, v = tr.정량[u.id] ?? { 답: '', 판정: '빈칸' as Panjeong }, own = v.답.trim(), n = labels.get(page)!;
      const editingThis = isEditing(u.id, page);
      return el('div', { class: `answer-row${view?.page === page ? ' viewing' : ''}${editingThis ? ' text-editing' : ''}` },
        el('span', { class: 'anon' }, t('item.answerN', { n })),
        editingThis ? textEditor(u.id, page, n, v.답, longText(u, v.답))
          : el('div', { class: 'answer' }, own === g.대표 ? '' : answerText(u, own)), // 대표 답과 글자가 다를 때만 원래 글을 보인다
        checkMark(tr, u.id),
        verdictButtons(v.판정, 'item.rowVerdict', `rv:${n}`, p => void send(u.id, [{ page, 판정: p }])),
        editingThis ? null : editButton(u.id, page, n),
        el('button', { class: 'small view', 'data-focus': `view:${n}`, onclick: () => openViewer(page, n) }, t('item.viewImage')),
        essayFull(u, tr, n));
    })));
    return box;
  }

  /** 손글씨 칸: 잘라낸 손글씨, 익명 번호와 확인 표시, 대표 답과 다른 전사 글, 판정 단추 */
  function qtyCell(u: QtyUnit, g: AnswerGroup, page: number, n: number, tr: Transcript, grid: Grid): HTMLElement {
    const v = tr.정량[u.id] ?? { 답: '', 판정: '빈칸' as Panjeong }, own = v.답.trim(), editingThis = isEditing(u.id, page);
    return el('div', { class: `hw-cell${view?.page === page ? ' viewing' : ''}${editingThis ? ' text-editing' : ''}` }, hwCanvas(page, n, grid),
      el('div', { class: 'hw-meta' }, el('span', { class: 'anon' }, t('item.answerN', { n })), checkMark(tr, u.id)),
      editingThis ? textEditor(u.id, page, n, v.답, longText(u, v.답)) : own === g.대표 ? null : el('div', { class: 'answer' }, answerText(u, own)),
      el('div', { class: 'hw-actions' }, verdictButtons(v.판정, 'item.rowVerdict', `rv:${n}`, p => void send(u.id, [{ page, 판정: p }])),
        editingThis ? null : editButton(u.id, page, n),
        el('button', { class: 'small view', 'data-focus': `view:${n}`, onclick: () => openViewer(page, n) }, t('item.viewImage'))),
      essayFull(u, tr, n));
  }

  function qualCell(u: QualUnit, tr: Transcript, n: number, grid: Grid): HTMLElement {
    const v = tr.정성[u.id] ?? { 응답: false, 답: '' };
    const cb = el('input', { type: 'checkbox', 'data-focus': `qr:${n}`, checked: v.응답, disabled: busy, onchange: () => void send(u.id, [{ page: tr.page, 응답: cb.checked }]) });
    const editingThis = isEditing(u.id, tr.page);
    return el('div', { class: `hw-cell${view?.page === tr.page ? ' viewing' : ''}${editingThis ? ' text-editing' : ''}` }, hwCanvas(tr.page, n, grid),
      el('div', { class: 'hw-meta' }, el('span', { class: 'anon' }, t('item.answerN', { n })), checkMark(tr, u.id)),
      editingThis ? textEditor(u.id, tr.page, n, v.답, longText(u, v.답)) : el('div', { class: 'answer' }, v.답.trim() || el('span', { class: 'muted' }, t('item.emptyAnswer'))),
      el('div', { class: 'hw-actions' }, el('label', {}, cb, t('review.responded')),
        editingThis ? null : editButton(u.id, tr.page, n),
        el('button', { class: 'small view', 'data-focus': `view:${n}`, onclick: () => openViewer(tr.page, n) }, t('item.viewImage'))));
  }

  function qualRow(u: QualUnit, tr: Transcript, n: number): HTMLElement {
    const v = tr.정성[u.id] ?? { 응답: false, 답: '' };
    const cb = el('input', { type: 'checkbox', 'data-focus': `qr:${n}`, checked: v.응답, disabled: busy, onchange: () => void send(u.id, [{ page: tr.page, 응답: cb.checked }]) });
    const editingThis = isEditing(u.id, tr.page);
    return el('div', { class: `answer-row${view?.page === tr.page ? ' viewing' : ''}${editingThis ? ' text-editing' : ''}` },
      el('span', { class: 'anon' }, t('item.answerN', { n })),
      editingThis ? textEditor(u.id, tr.page, n, v.답, longText(u, v.답)) : el('div', { class: 'answer' }, v.답.trim() || el('span', { class: 'muted' }, t('item.emptyAnswer'))),
      el('label', {}, cb, t('review.responded')),
      checkMark(tr, u.id),
      editingThis ? null : editButton(u.id, tr.page, n),
      el('button', { class: 'small view', 'data-focus': `view:${n}`, onclick: () => openViewer(tr.page, n) }, t('item.viewImage')));
  }

  /** 글 고치기 저장 뒤 알림. O·X를 다시 골라야 하는지를 먼저 알린다 */
  const textNotice = (단위: string, r: UnitResultsResult): string => !r.글고침 ? t('item.nothingNew')
    : r.판정필요 ? t('item.edit.judge') : data?.key.정성.some(u => u.id === 단위) ? t('item.edit.saved') : t('item.edit.decided');

  async function send(단위: string, 항목: UnitResultItem[], kind: 'verdict' | 'text' = 'verdict'): Promise<void> {
    if (busy || !data) return;
    busy = true; renderGroups();
    try {
      const r = await api.setUnitResults(data.폴더, { 단위, 항목, 사례기록: deps.recordCases() });
      await deps.refresh(); // 다시 읽어 그린다. 알림 칸을 비우므로 안내는 그 뒤에
      if (r.엑셀오류) deps.notice.append(el('div', { class: 'band warn' }, t('review.savedExcelFailed', { error: r.엑셀오류 })));
      if (r.사례오류) deps.notice.append(el('div', { class: 'band warn' }, t('item.caseFailed', { error: r.사례오류 })));
      // 신원을 숨기는 화면이라 알림에도 장 번호 없이 수만 적는다
      if (!r.엑셀오류) showInfo(kind === 'text' ? textNotice(단위, r) : r.바뀐장수 ? [t('item.changed', { n: r.바뀐장수 }), r.사례수 ? t('item.casesRecorded', { n: r.사례수 }) : ''].join(' ').trim()
        : r.확인장수 ? t('item.confirmed', { n: r.확인장수 }) : t('item.nothingNew'));
    } catch (e) {
      showError((e as Error).message);
      await deps.refresh().catch(() => undefined); // 일부만 저장됐을 수 있어 디스크의 상태로 다시 그린다
    } finally { busy = false; renderGroups(); }
  }

  return { root, render };
}
