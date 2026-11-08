import { identityMask, unitPoints } from '../../core/key.js';
import type { MaskRect, Panjeong, QtyUnit, QualUnit, Transcript } from '../../core/types.js';
import { unitChecked, type UnitResultItem } from '../../core/unit-results.js';
import type { SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { anonLabels, groupAnswers, keyLine, progress, sortGroups, unitDone, unitSummaries, type AnswerGroup } from '../lib/item-review.js';
import { attachRectDrag } from '../lib/rect-drag.js';

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
  let data: SetData | null = null;
  let unitId: string | null = null;
  let onlyUnchecked = false;
  let busy = false; // 저장과 엑셀 생성이 두 벌 돌지 않게 기다리는 동안 단추를 잠근다
  const open = new Set<string>(); // 펼친 묶음: 단위 + 정규 답

  function render(d: SetData | null): void {
    if (d?.폴더 !== data?.폴더) { open.clear(); unitId = null; closeViewer(false); }
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
  const sheetWrap = el('div', { class: 'sheet-wrap' }, canvas);
  const viewer = el('div', { class: 'item-viewer hidden' }, viewBar, viewHelp, sheetWrap);
  root.append(viewer);
  let view: { page: number; n: number; img: HTMLImageElement | null } | null = null;
  let zoom = 1, editing = false;
  let dragging: MaskRect | null = null; // 끄는 중인 새 영역

  const setZoom = (z: number) => { zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100)); canvas.style.width = `${zoom * 100}%`; zoomText.textContent = `${Math.round(zoom * 100)}%`; };
  sheetWrap.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  setZoom(1);

  function renderViewBar(): void {
    clear(viewBar);
    canvas.classList.toggle('editing', editing);
    if (!view) return;
    put(viewBar, el('strong', {}, t('item.answerN', { n: view.n })),
      el('button', { class: 'small', 'aria-label': t('item.zoomOut'), title: t('item.zoomOut'), onclick: () => setZoom(zoom - 0.25) }, '−'), zoomText,
      el('button', { class: 'small', 'aria-label': t('item.zoomIn'), title: t('item.zoomIn'), onclick: () => setZoom(zoom + 0.25) }, '+'),
      el('button', { class: 'small', onclick: () => setZoom(1) }, t('review.fit')),
      el('button', { class: `small${editing ? ' active' : ''}`, 'aria-pressed': String(editing), onclick: () => { editing = !editing; dragging = null; renderViewBar(); draw(); } }, t('item.maskEdit')),
      editing ? el('button', { class: 'small', onclick: () => void saveMask(null) }, t('item.maskDefault')) : null,
      el('button', { class: 'small close', 'aria-label': t('item.viewClose'), title: t('item.viewClose'), onclick: () => closeViewer() }, '×'));
    viewHelp.textContent = t(editing ? 'item.maskEditHelp' : 'item.maskHelp');
  }

  function openViewer(page: number, n: number): void {
    if (!data) return;
    view = { page, n, img: null }; editing = false; dragging = null;
    canvas.width = canvas.height = 0; // 앞서 본 답안이 새 그림을 받기 전까지 남지 않게
    root.classList.add('viewing'); viewer.classList.remove('hidden');
    renderViewBar(); renderGroups();
    const img = new Image(); // 문서에 붙이지 않는 그림이라 가리기 전 모습은 화면에 나가지 않는다
    img.onload = () => { if (view?.page === page) { view.img = img; draw(); } };
    img.onerror = () => { if (view?.page === page) showError(t('item.imageFailed')); };
    img.src = imageUrl(data.폴더, page);
  }

  function closeViewer(rerender = true): void {
    if (!view) return;
    view = null; editing = false; dragging = null;
    canvas.width = canvas.height = 0;
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
      const x = Math.floor(r.x * W), y = Math.floor(r.y * H), w = Math.ceil((r.x + r.w) * W) - x, h = Math.ceil((r.y + r.h) * H) - y;
      g.fillStyle = '#7d8696'; g.fillRect(x, y, w, h);
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
    if (e.key !== 'Escape' || !view || root.offsetParent === null) return; // 문항별 화면이 보일 때만
    if (editing) { editing = false; dragging = null; renderViewBar(); draw(); } else closeViewer();
  });

  function renderUnits(): void {
    clear(units);
    if (!data) return;
    const d = data, sums = unitSummaries(d.key, d.transcripts), p = progress(d.key, d.transcripts);
    const only = el('input', { type: 'checkbox', checked: onlyUnchecked, onchange: () => { onlyUnchecked = only.checked; renderUnits(); } });
    units.append(el('div', { class: 'filters' },
      el('div', {}, t('item.progress', { units: p.단위, unitsTotal: p.단위전체, pages: p.장, pagesTotal: p.장전체 })),
      el('label', {}, only, t('item.onlyUnchecked'))));
    const shown = sums.filter(s => !onlyUnchecked || !unitDone(s));
    if (!shown.length) { units.append(el('div', { class: 'unit-empty muted' }, t(sums.length ? 'item.allDone' : 'item.noUnits'))); return; }
    for (const s of shown) {
      const on = s.id === unitId, done = unitDone(s);
      units.append(el('button', { class: `unit${on ? ' active' : ''}${done ? ' done' : ''}`, 'aria-current': on ? 'true' : null, onclick: () => pick(s.id) },
        el('span', { class: 'line' }, el('strong', {}, s.id), el('span', { class: 'desc', title: s.설명 }, s.설명)),
        el('span', { class: 'meta' }, t('item.unitChecked', { done: s.확인, total: s.전체 }), done ? ' ✓' : null,
          s.갈림 ? el('span', { class: 'tag-warn', title: t('item.splitCountTitle') }, t('item.splitCount', { n: s.갈림 })) : null)));
    }
  }

  function renderGroups(): void {
    const scroll = groups.scrollTop; // 판정을 넣은 뒤 다시 그려도 보던 자리에 머문다
    clear(groups);
    if (!data) return;
    const d = data;
    if (!d.transcripts.length) { groups.append(el('div', { class: 'muted' }, t('item.noTranscripts'))); return; }
    const qty = d.key.정량.find(u => u.id === unitId), qual = d.key.정성.find(u => u.id === unitId);
    if (!qty && !qual) { groups.append(el('div', { class: 'muted' }, t('item.noUnits'))); return; }
    const u = (qty ?? qual)!;
    const labels = anonLabels(SALT, u.id, d.transcripts.map(x => x.page));
    const byPage = new Map(d.transcripts.map(x => [x.page, x]));
    groups.append(el('div', { class: 'muted' }, t('item.notice')), head(u, !!qty, d.transcripts.every(x => unitChecked(x, u.id))));
    if (qty) for (const g of sortGroups(groupAnswers(d.transcripts, qty.id))) groups.append(groupBox(qty, g, labels, byPage));
    else groups.append(el('div', { class: 'qual-list' }, ...[...labels].sort(([, a], [, b]) => a - b).map(([page, n]) => qualRow(qual!, byPage.get(page)!, n))));
    groups.scrollTop = scroll;
  }

  function head(u: QtyUnit | QualUnit, isQty: boolean, allChecked: boolean): HTMLElement {
    const 유형 = isQty ? (u as QtyUnit).유형 : '응답형';
    const cases = el('input', { type: 'checkbox', checked: deps.recordCases(), onchange: () => deps.setRecordCases(cases.checked) });
    return el('div', { class: 'ir-head' },
      el('div', { class: 'row' }, el('strong', { class: 'unit-id' }, u.id), 유형 ? el('span', { class: 'muted' }, t(`unit.${유형}`)) : null,
        unitPoints(u) === 1 ? null : el('span', { class: 'muted' }, t('review.points', { n: unitPoints(u) })),
        el('button', { class: 'primary', disabled: busy || allChecked, title: t('item.confirmAllTitle'), onclick: () => void send(u.id, data!.transcripts.map(x => ({ page: x.page }))) }, t('item.confirmAll')),
        isQty ? el('label', { title: t('item.recordCasesTitle') }, cases, t('item.recordCases')) : null),
      el('div', { class: 'ir-desc' }, u.설명),
      isQty ? el('div', { class: 'muted' }, keyLine(u as QtyUnit)) : null);
  }

  const verdictButtons = (current: Panjeong | null, title: 'item.groupVerdict' | 'item.rowVerdict', onPick: (v: Panjeong) => void): HTMLElement =>
    el('div', { class: 'verdicts', role: 'group' }, ...VERDICTS.map(v => el('button', { class: `v-${v}${v === current ? ' on' : ''}`, 'aria-pressed': String(v === current),
      disabled: busy, title: t(title), onclick: () => onPick(v) }, t(`verdict.${v}`))));

  const checkMark = (tr: Transcript, 단위: string): HTMLElement =>
    unitChecked(tr, 단위) ? el('span', { class: 'ok-text', title: t('item.checked') }, '✓') : el('span', { class: 'muted' }, t('item.unchecked'));

  function groupBox(u: QtyUnit, g: AnswerGroup, labels: Map<number, number>, byPage: Map<number, Transcript>): HTMLElement {
    const k = `${u.id}\u0000${g.정규}`, isOpen = open.has(k);
    const same = VERDICTS.find(v => g.판정[v] === g.장.length) ?? null;
    const status = g.확인 === g.장.length ? el('span', { class: 'ok-text' }, `✓ ${t('item.checked')}`)
      : g.확인 ? el('span', {}, t('item.unitChecked', { done: g.확인, total: g.장.length })) : el('span', { class: 'muted' }, t('item.unchecked'));
    const box = el('div', { class: `group${g.갈림 ? ' mixed' : ''}` },
      el('div', { class: 'group-head' },
        el('button', { class: 'twisty', 'aria-expanded': String(isOpen), title: t(isOpen ? 'item.collapse' : 'item.expand'), 'aria-label': t(isOpen ? 'item.collapse' : 'item.expand'),
          onclick: () => { if (isOpen) open.delete(k); else open.add(k); renderGroups(); } }, isOpen ? '▼' : '▶'),
        el('div', { class: 'answer' }, g.정규 ? g.대표 : el('span', { class: 'muted' }, t('item.emptyAnswer'))),
        el('div', { class: 'group-meta' }, el('span', {}, t('item.sheets', { n: g.장.length })),
          el('span', {}, VERDICTS.filter(v => g.판정[v]).map(v => `${t(`verdict.${v}`)} ${g.판정[v]}`).join(' · ')),
          g.갈림 ? el('span', { class: 'tag-warn', title: t('item.splitTitle') }, t('item.split')) : null, status),
        verdictButtons(same, 'item.groupVerdict', v => void send(u.id, g.장.map(page => ({ page, 판정: v }))))));
    if (!isOpen) return box;
    // 줄 순서와 번호는 장 번호가 아니라 익명 번호(단위마다 다른 해시 순)
    box.append(el('div', { class: 'group-rows' }, ...[...g.장].sort((a, b) => labels.get(a)! - labels.get(b)!).map(page => {
      const tr = byPage.get(page)!, v = tr.정량[u.id] ?? { 답: '', 판정: '빈칸' as Panjeong }, own = v.답.trim();
      return el('div', { class: `answer-row${view?.page === page ? ' viewing' : ''}` },
        el('span', { class: 'anon' }, t('item.answerN', { n: labels.get(page)! })),
        el('div', { class: 'answer' }, own === g.대표 ? '' : own), // 대표 답과 글자가 다를 때만 원래 글을 보인다
        checkMark(tr, u.id),
        verdictButtons(v.판정, 'item.rowVerdict', p => void send(u.id, [{ page, 판정: p }])),
        el('button', { class: 'small view', onclick: () => openViewer(page, labels.get(page)!) }, t('item.viewImage')));
    })));
    return box;
  }

  function qualRow(u: QualUnit, tr: Transcript, n: number): HTMLElement {
    const v = tr.정성[u.id] ?? { 응답: false, 답: '' };
    const cb = el('input', { type: 'checkbox', checked: v.응답, disabled: busy, onchange: () => void send(u.id, [{ page: tr.page, 응답: cb.checked }]) });
    return el('div', { class: `answer-row${view?.page === tr.page ? ' viewing' : ''}` },
      el('span', { class: 'anon' }, t('item.answerN', { n })),
      el('div', { class: 'answer' }, v.답.trim() || el('span', { class: 'muted' }, t('item.emptyAnswer'))),
      el('label', {}, cb, t('review.responded')),
      checkMark(tr, u.id),
      el('button', { class: 'small view', onclick: () => openViewer(tr.page, n) }, t('item.viewImage')));
  }

  async function send(단위: string, 항목: UnitResultItem[]): Promise<void> {
    if (busy || !data) return;
    busy = true; renderGroups();
    try {
      const r = await api.setUnitResults(data.폴더, { 단위, 항목, 사례기록: deps.recordCases() });
      await deps.refresh(); // 다시 읽어 그린다. 알림 칸을 비우므로 안내는 그 뒤에
      if (r.엑셀오류) deps.notice.append(el('div', { class: 'band warn' }, t('review.savedExcelFailed', { error: r.엑셀오류 })));
      if (r.사례오류) deps.notice.append(el('div', { class: 'band warn' }, t('item.caseFailed', { error: r.사례오류 })));
      // 신원을 숨기는 화면이라 알림에도 장 번호 없이 수만 적는다
      if (!r.엑셀오류) showInfo(r.바뀐장수 ? [t('item.changed', { n: r.바뀐장수 }), r.사례수 ? t('item.casesRecorded', { n: r.사례수 }) : ''].join(' ').trim()
        : r.확인장수 ? t('item.confirmed', { n: r.확인장수 }) : t('item.nothingNew'));
    } catch (e) {
      showError((e as Error).message);
      await deps.refresh().catch(() => undefined); // 일부만 저장됐을 수 있어 디스크의 상태로 다시 그린다
    } finally { busy = false; renderGroups(); }
  }

  return { root, render };
}
