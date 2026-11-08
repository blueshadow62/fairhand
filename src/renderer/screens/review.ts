import { roundScore, unitPoints } from '../../core/key.js';
import type { Hwaksin, Panjeong, Transcript } from '../../core/types.js';
import type { SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { applyFilter, missingStudents, toItems, type Filter } from '../lib/review-filter.js';
import { makeGuard, makeLeaveGuard, tag } from '../lib/screen-utils.js';

const sid = (t: { 학년: number | null; 반: number | null; 번호: number | null }) => `${t.학년 ?? '?'}-${t.반 ?? '?'}-${t.번호 ?? '?'}`;
const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const MAC = /Mac/.test(navigator.platform);
/** 맥에서 Option+←/→는 입력란에서 낱말 단위로 커서를 옮기는 기본 동작이라, 글을 고치는 중에는 쪽 넘기기로 가로채지 않는다 */
const editingText = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(t.type)));
/** 비고 문장에 단위 id가 들어 있는지('1-1'이 '1-10'에 걸리지 않게) */
const mentions = (notes: string[], id: string) => notes.some(n => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(n));

// 접힌 칸의 너비가 바뀌면(창·나눔선) 넘침 표시를 다시 잰다. 편집 칸을 새로 그릴 때 disconnect
const clipFits = new WeakMap<Element, () => void>();
const clipWatch = new ResizeObserver(es => { for (const e of es) if (document.activeElement !== e.target) clipFits.get(e.target)?.(); });

/**
 * 평소에는 rows줄로 접혀 있다가, 누르면(포커스) 쓴 답이 다 보이게 넓고 길게 펼쳐지는 입력란.
 * 한 줄 칸에서는 긴 답(논술형 등)이 잘려 보이지 않았다. 접힌 채 넘치면 끝에 '…'를 보인다.
 */
function growArea(value: string, onInput: (v: string) => void, opts: { rows: number; singleLine?: boolean; label?: string }): HTMLElement {
  const area = el('textarea', { rows: opts.rows, 'aria-label': opts.label, oninput: () => { onInput(area.value); fit(); } });
  area.value = value;
  const wrap = el('div', { class: 'grow' }, area);
  function fit(): void {
    const on = document.activeElement === area, scroll = area.scrollTop;
    wrap.classList.remove('open');
    for (const p of ['height', 'width']) area.style.removeProperty(p);
    wrap.style.removeProperty('height');
    if (on) {
      // 답 칸은 좁아서(표의 자동 너비) 높이만 늘리면 두세 글자씩 끊긴다. 왼쪽 설명 칸 위로 넓히고, 판정 칸은 그대로 보이게 둔다.
      // 펼친 입력란은 띄워서(absolute) 표가 칸 너비를 다시 재지 않게 하고, 감싼 칸이 높이를 차지해 아래 줄을 밀어낸다
      const box = wrap.getBoundingClientRect(); // 접힌 모양: 표가 정한 칸 너비와 접힌 높이
      const cells = wrap.closest('tr')?.children;
      const extra = cells && cells.length > 2 ? Math.max(0, Math.round(box.left - (cells[1] as HTMLElement).getBoundingClientRect().left - 6)) : 0;
      wrap.classList.add('open');
      wrap.style.height = `${box.height}px`;
      area.style.width = `${Math.round(box.width) + extra}px`;
      // 화면 배율 150%에서는 1px 테두리가 0.67px로 그려진다. offsetHeight - clientHeight(정수)로 재면 1px 남짓 모자라 다 보이는데도 스크롤 막대가 생겼다
      const cs = getComputedStyle(area), border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const h = Math.max(box.height, Math.min(Math.ceil(area.scrollHeight + border), Math.round(window.innerHeight * 0.45))); // 접힌 높이보다 줄이지는 않는다
      area.style.height = wrap.style.height = `${h}px`;
      area.scrollTop = scroll; // 잠깐 접었다 펼치는 사이 글 위치가 맨 위로 튀지 않게
    }
    wrap.classList.toggle('clipped', !on && area.scrollHeight > area.clientHeight + 1);
  }
  area.addEventListener('focus', fit);
  area.addEventListener('blur', () => { fit(); area.scrollTop = 0; });
  // 예전 한 줄 칸처럼 Enter로는 줄을 바꾸지 않는다(Shift+Enter는 줄바꿈). 한글 조합 중 Enter는 글자 확정이라 막지 않는다
  if (opts.singleLine) area.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault(); });
  clipFits.set(area, fit); clipWatch.observe(area);
  return wrap;
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  root.classList.add('review-screen');
  let data: SetData | null = null;
  let shownFor: string | null | undefined;
  let T: Transcript | null = null;  // 편집 중인 전사(사본)
  let dirty = false;
  let zoom = 1;
  const CASE_PREF = 'geulnun.review.recordCases';
  let recordCases = (() => { try { return localStorage.getItem(CASE_PREF) !== '0'; } catch { return true; } })();
  const remember = (on: boolean) => { try { localStorage.setItem(CASE_PREF, on ? '1' : '0'); } catch { /* 저장 못 해도 기본값(켬)으로 */ } };
  const filter: Filter = { 비고만: false, 문제먼저: true, 반: null, 검색: '', 미확인만: false };

  const guard = makeGuard(showError);

  const top = el('div', { class: 'row' });
  const notice = el('div');
  const listItems = el('div');
  const filters = el('div', { class: 'filters' });
  const list = el('div', { class: 'list' }, filters, listItems);
  const img = el('img', { alt: t('review.imageAlt') });
  const zoomText = el('span');
  const viewer = el('div', { class: 'viewer' });
  const editor = el('div', { class: 'editor' });
  const splitter = el('div', { class: 'splitter', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': t('review.splitter'), title: t('review.splitterHelp') });
  const grid = el('div', { class: 'review' }, list, viewer, splitter, editor);
  root.append(top, notice, grid);

  // ── 그림 칸과 전사 칸 사이를 끌어 너비 바꾸기. 두 칸의 최소 너비는 CSS(minmax)가 지킨다 ──
  const EDITOR_PREF = 'geulnun.review.editorWidth';
  const editorWidth = () => editor.getBoundingClientRect().width;
  const setEditorWidth = (px: number | null) => { if (px === null) grid.style.removeProperty('--editor-w'); else grid.style.setProperty('--editor-w', `${Math.round(px)}px`); };
  const keepEditorWidth = () => {
    if (grid.style.getPropertyValue('--editor-w')) setEditorWidth(editorWidth()); // 최소·최대에 걸린 값이면 실제 너비로 맞춰 둔다
    try { const v = grid.style.getPropertyValue('--editor-w'); if (v) localStorage.setItem(EDITOR_PREF, v); else localStorage.removeItem(EDITOR_PREF); } catch { /* 못 저장하면 다음에 기본 너비 */ }
  };
  try { const v = localStorage.getItem(EDITOR_PREF); if (v && /^\d+px$/.test(v)) grid.style.setProperty('--editor-w', v); } catch { /* 기본 너비 */ }
  let split: { x: number; w: number } | null = null;
  splitter.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); // 끄는 동안 글자가 선택되지 않게
    splitter.setPointerCapture(e.pointerId);
    split = { x: e.clientX, w: editorWidth() }; splitter.classList.add('dragging');
  });
  splitter.addEventListener('pointermove', e => { if (split) setEditorWidth(split.w - (e.clientX - split.x)); });
  const endSplit = () => { if (!split) return; split = null; splitter.classList.remove('dragging'); keepEditorWidth(); };
  splitter.addEventListener('pointerup', endSplit);
  splitter.addEventListener('pointercancel', endSplit);
  splitter.addEventListener('dblclick', () => { setEditorWidth(null); keepEditorWidth(); });
  splitter.addEventListener('keydown', e => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    setEditorWidth(editorWidth() + (e.key === 'ArrowLeft' ? 24 : -24)); keepEditorWidth();
  });

  // ── 그림: 확대·축소, Ctrl+휠, 끌어서 옮기기 ──
  const setZoom = (z: number) => { zoom = Math.min(3, Math.max(0.5, Math.round(z * 10) / 10)); img.style.width = `${zoom * 100}%`; zoomText.textContent = `${Math.round(zoom * 100)}%`; };
  viewer.append(el('div', { class: 'viewer-bar' },
    el('button', { onclick: () => setZoom(zoom - 0.25) }, '−'), zoomText, el('button', { onclick: () => setZoom(zoom + 0.25) }, '+'),
    el('button', { onclick: () => setZoom(1) }, t('review.fit')), el('span', { class: 'muted' }, t('review.zoomHelp'))), img);
  viewer.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  let drag: { x: number; y: number; l: number; t: number } | null = null;
  viewer.addEventListener('mousedown', e => { if (e.target !== img) return; e.preventDefault(); drag = { x: e.clientX, y: e.clientY, l: viewer.scrollLeft, t: viewer.scrollTop }; });
  window.addEventListener('mousemove', e => { if (drag) { viewer.scrollLeft = drag.l - (e.clientX - drag.x); viewer.scrollTop = drag.t - (e.clientY - drag.y); } });
  window.addEventListener('mouseup', () => { drag = null; });
  setZoom(1);

  const visibleItems = () => (data ? applyFilter(toItems(data.transcripts), filter) : []);
  const untranscribed = () => (data ? data.pages.filter(p => !data!.transcripts.some(t => t.page === p)) : []);
  const order = () => [...visibleItems().map(i => i.page), ...untranscribed()];

  async function reload(keepPage?: number): Promise<void> {
    const 폴더 = store.state.current;
    shownFor = 폴더;
    clear(top); clear(notice);
    if (!폴더) { data = null; T = null; notice.append(el('div', { class: 'muted' }, t('common.chooseSet'))); grid.classList.add('hidden'); return; }
    grid.classList.remove('hidden');
    let d: SetData;
    try { d = await api.readSet(폴더); } catch (e) { showError((e as Error).message); return; }
    if (shownFor !== 폴더) return; // 기다리는 사이 다른 세트로 바뀌었으면 늦게 온 응답은 버린다
    data = d;
    put(top, el('h2', {}, t('review.title', { name: 폴더 })),
      el('button', { onclick: () => guard(async () => { const r = await api.buildResult(폴더); showInfo(t('review.excelRebuilt', { path: r.엑셀 })); }) }, t('review.rebuildExcel')),
      el('button', { onclick: () => guard(async () => {
        const r = await api.buildCumulative();
        clear(notice);
        notice.append(el('div', { class: 'band info' }, t('review.cumulativeMade'), ...r.파일.map(f => el('div', { class: 'row' }, el('span', { class: 'path' }, f), el('button', { onclick: () => api.revealPath(f).catch(e => showError(e.message)) }, t('common.reveal'))))));
      }) }, t('review.makeCumulative')));
    renderFilters();
    const pages = order();
    const target = keepPage !== undefined && pages.includes(keepPage) ? keepPage : T && pages.includes(T.page) ? T.page : pages[0];
    if (target !== undefined) openPage(target); else { T = null; renderEditor(); renderList(); }
  }

  function renderFilters(): void {
    clear(filters);
    if (!data) return;
    const chk = (label: string, k: '비고만' | '문제먼저' | '미확인만') => el('label', {}, el('input', { type: 'checkbox', checked: filter[k], onchange: (e: Event) => { filter[k] = (e.target as HTMLInputElement).checked; renderList(); } }), label);
    const cls = el('select', { onchange: () => { filter.반 = cls.value ? Number(cls.value) : null; renderList(); } },
      el('option', { value: '' }, t('review.allClasses')), ...data.key.대상.반.map(b => el('option', { value: String(b), selected: filter.반 === b }, t('review.classN', { n: b }))));
    const search = el('input', { type: 'search', placeholder: t('review.searchPlaceholder'), value: filter.검색, oninput: () => { filter.검색 = search.value; renderList(); } });
    filters.append(chk(t('review.onlyNotes'), '비고만'), chk(t('review.problemsFirst'), '문제먼저'), chk(t('review.onlyUnchecked'), '미확인만'), cls, search);
  }

  function renderList(): void {
    clear(listItems);
    if (!data) return;
    const items = visibleItems();
    const done = data.transcripts.filter(t => t.확인완료).length;
    listItems.append(el('div', { class: 'item muted' }, t('review.checked', { done, total: data.transcripts.length })));
    for (const i of items) {
      const 학생 = i.학년 === null && i.반 === null && i.번호 === null ? t('review.unidentified') : sid(i);
      listItems.append(el('button', { class: `item${T?.page === i.page ? ' active' : ''}${i.중복 || i.식별확신 === '불명' ? ' bad' : ''}`, onclick: () => go(i.page) },
        [tag(i.page), 학생, i.이름, i.식별확신 !== '확실' ? t(`hwaksin.${i.식별확신}`) : null, i.중복 ? t('review.duplicate') : null, i.비고수 ? t('review.notesCount', { n: i.비고수 }) : null, i.확인완료 ? '✓' : null].filter(Boolean).join(' · ')));
    }
    for (const p of untranscribed()) listItems.append(el('div', { class: `item bad${T?.page === p ? ' active' : ''}`, onclick: () => go(p) }, t('review.noTranscript', { page: tag(p) })));
    const missing = missingStudents(data.key, data.transcripts, data.명단);
    if (missing.length) listItems.append(el('div', { class: 'item muted' }, t('review.missing', { list: missing.map(s => `${sid(s)}${s.이름 ? ` ${s.이름}` : ''}`).join(', ') })));
  }

  function blankTranscript(page: number): Transcript {
    const k = data!.key;
    return { page, 학년: null, 반: null, 번호: null, 이름: null, 식별확신: '불명',
      정량: Object.fromEntries(k.정량.map(u => [u.id, { 답: '', 판정: '빈칸' as Panjeong }])),
      정성: Object.fromEntries(k.정성.map(u => [u.id, { 응답: false, 답: '' }])), 비고: [], 확인완료: false };
  }

  const leaveOk = makeLeaveGuard(api, { isDirty: () => dirty, save: async () => { await save(); }, discard: () => { dirty = false; } });
  ctx.setLeaveGuard(leaveOk);

  function go(page: number): void {
    if (T?.page === page) return;
    void leaveOk().then(ok => { if (ok) openPage(page); });
  }

  function openPage(page: number): void {
    if (!data) return;
    const saved = data.transcripts.find(x => x.page === page);
    T = saved ? structuredClone(saved) : blankTranscript(page);
    dirty = false;
    img.src = imageUrl(data.폴더, page);
    renderEditor(); renderList();
  }

  /** 지금 목록 순서에서 d칸 옆 장. 이 장이 목록에 없으면(필터로 빠짐) 목록의 첫 장 */
  function neighbor(d: number): number | undefined {
    if (!T) return undefined;
    const pages = order(), i = pages.indexOf(T.page);
    return pages[i < 0 ? 0 : i + d];
  }

  function step(d: number): void {
    const next = neighbor(d);
    if (next !== undefined) go(next);
  }

  // 머리 줄을 다시 그리지 않고 표시만 켠다. 다시 그리면 방금 누른 '확인 완료' 체크에서 초점이 빠진다
  const unsavedTag = el('span', { class: 'band warn hidden' }, t('review.unsaved'));
  const touch = () => { if (!dirty) { dirty = true; unsavedTag.classList.remove('hidden'); } updateScore(); };
  const headerBox = el('div');
  const scoreText = el('span');
  let doneBox: HTMLInputElement | null = null;
  const updateScore = () => {
    if (!T || !data) return;
    const cur = T, k = data.key; // 배점(없으면 1점)만큼 더한다
    scoreText.textContent = t('review.score', { n: roundScore(k.정량.reduce((s, u) => s + (cur.정량[u.id]?.판정 === 'O' ? unitPoints(u) : 0), 0)
      + k.정성.reduce((s, u) => s + (cur.정성[u.id]?.응답 ? unitPoints(u) : 0), 0)) });
  };

  function renderHeader(): void {
    clear(headerBox);
    if (!T) return;
    const tr = T;
    updateScore();
    unsavedTag.classList.toggle('hidden', !dirty);
    const done = el('input', { type: 'checkbox', checked: tr.확인완료 === true, onchange: () => { tr.확인완료 = done.checked; touch(); } });
    doneBox = done;
    // 저장하지 않은 변경 표시는 사례 기록 앞에 둔다. 뒤에 두면 고치기 시작할 때 줄이 하나 늘어 아래가 밀린다
    put(headerBox, el('div', { class: 'row' },
      el('button', { onclick: () => step(-1), title: MAC ? '⌥←' : 'Alt+←' }, t('review.prev')), el('button', { onclick: () => step(1), title: MAC ? '⌥→' : 'Alt+→' }, t('review.next')),
      el('strong', {}, tag(tr.page)), scoreText,
      el('button', { class: 'primary', onclick: () => void save(), title: MAC ? '⌘S' : 'Ctrl+S' }, t('common.save')),
      el('button', { onclick: () => void saveAndNext(), title: MAC ? '⌘Enter' : 'Ctrl+Enter' }, t('review.saveNext')),
      el('label', {}, done, t('review.done')),
      unsavedTag,
      el('label', { title: t('review.recordCasesTitle') }, el('input', { type: 'checkbox', checked: recordCases, onchange: (e: Event) => { recordCases = (e.target as HTMLInputElement).checked; remember(recordCases); } }), t('review.recordCases'))));
  }

  /** '저장하고 다음'(Ctrl+Enter): 이 장을 확인 완료로 저장하고 목록의 다음 장을 연다. 저장이 안 되면 머물고, 마지막 장이면 머물며 알린다 */
  async function saveAndNext(): Promise<void> {
    if (!T || !data || saving) return;
    const page = T.page, 폴더 = data.폴더;
    // 다음 장은 누른 때의 목록 순서로 정한다. 저장하면 목록이 다시 정렬되거나(문제 먼저) 이 장이 빠진다(미확인만)
    const next = neighbor(1);
    // 전사 없는 장을 손대지 않은 채 저장하면 빈 전사가 생겨 다음 전사 때 그 장을 건너뛴다. 이미 확인한 깨끗한 장은 다시 저장할 것이 없다
    const blank = !data.transcripts.some(x => x.page === page);
    const needSave = dirty || (!blank && !T.확인완료);
    if (needSave) {
      if (!T.확인완료) { T.확인완료 = true; if (doneBox) doneBox.checked = true; touch(); }
      if (!(await save()) || data?.폴더 !== 폴더) return;
    }
    const target = next ?? page;
    if (T?.page !== target) openPage(target); // 저장 뒤 다시 읽으면 '미확인만'에서는 이 장이 목록에서 빠져 다른 장이 열려 있다
    if (next === undefined) showInfo(t(needSave ? 'review.savedLast' : 'review.lastPage'));
  }

  let saving = false; // Ctrl+S 연타·버튼 연타로 저장과 엑셀 생성이 두 벌 도는 것을 막는다
  /** 전사가 저장되고 사례 기록도 탈 없이 끝나면 true. '저장하고 다음'은 그때만 다음 장으로 간다 */
  async function save(): Promise<boolean> {
    if (!T || !data || saving) return false;
    saving = true;
    const tr = T, 폴더 = data.폴더;
    // 판정이 O·X로 바뀐 단위(답이 있을 때만)는 사례 후보. 빈칸으로 바꾼 것은 사례로 남기지 않는다
    const before = data.transcripts.find(x => x.page === tr.page);
    const cases = data.key.정량.map(u => ({ 단위: u.id, v: tr.정량[u.id] })).filter(({ 단위, v }) => v && v.답.trim() && (v.판정 === 'O' || v.판정 === 'X') && before?.정량[단위]?.판정 !== v.판정);
    try {
      let r = await api.saveTranscript(폴더, tr);
      dirty = false;
      const others = new Map<number, string[]>();
      let caseError: string | null = null; // 전사는 이미 저장됐으니 사례 기록이 실패해도 화면은 저장된 상태로 다시 읽는다
      if (recordCases) for (const c of cases) {
        try {
          const res = await api.applyCase(폴더, { 단위: c.단위, 답: c.v!.답, 판정: c.v!.판정 as 'O' | 'X', page: tr.page });
          for (const b of res.바뀐장) if (b.page !== tr.page) others.set(b.page, [...(others.get(b.page) ?? []), ...b.변경]);
          r = res;
        } catch (e) { caseError = (e as Error).message; break; }
      }
      await reload(store.state.current === 폴더 ? tr.page : undefined); // reload가 notice를 비우므로 안내는 그 뒤에
      if (recordCases && cases.length) {
        const others텍스트 = others.size ? t('review.othersChanged', { list: [...others].map(([p, ch]) => `${tag(p)}(${ch.join(', ')})`).join(', ') }) : t('review.noOthers');
        notice.append(el('div', { class: 'band info' }, t('review.casesRecorded', { n: cases.length, others: others텍스트 })));
      }
      if (r.엑셀오류) notice.append(el('div', { class: 'band warn' }, t('review.savedExcelFailed', { error: r.엑셀오류 })));
      else if (!caseError) showInfo(t('review.saved'));
      // 알림은 하나만 보이므로 사례 기록 오류는 '저장했습니다'에 덮이지 않게 맨 뒤에
      if (caseError) showError(caseError);
      return caseError === null;
    } catch (e) { showError((e as Error).message); return false; }
    finally { saving = false; }
  }

  /** 명단에서 학생을 고르면 학년·반·번호·이름을 채운다(불명이면 추정으로) */
  function rosterPick(tr: Transcript): HTMLElement {
    const list = data!.명단!;
    const pick = el('select', { onchange: () => {
      const st = list.find(x => `${x.반}-${x.번호}` === pick.value);
      if (!st) return;
      Object.assign(tr, { 학년: st.학년, 반: st.반, 번호: st.번호, 이름: st.이름 });
      if (tr.식별확신 === '불명') tr.식별확신 = '추정';
      touch(); renderEditor();
    } }, el('option', { value: '' }, t('review.rosterPick')), ...list.map(st => el('option', { value: `${st.반}-${st.번호}`, selected: st.반 === tr.반 && st.번호 === tr.번호 && st.학년 === tr.학년 }, `${sid(st)} ${st.이름 ?? ''}`)));
    return el('div', { class: 'row' }, t('review.roster'), pick);
  }

  function renderEditor(): void {
    clipWatch.disconnect(); clear(editor);
    if (!T || !data) { editor.append(el('div', { class: 'muted' }, t('review.noTranscriptEditor'))); return; }
    const tr = T, key = data.key;
    const numIn = (k: '학년' | '반' | '번호') => { const i = el('input', { type: 'number', min: '1', 'aria-label': t(k === '학년' ? 'review.grade' : k === '반' ? 'review.class' : 'review.number'), value: tr[k] === null ? '' : String(tr[k]), oninput: () => { tr[k] = numOrNull(i.value); touch(); } }); return i; };
    const nameIn = el('input', { 'aria-label': t('review.name'), value: tr.이름 ?? '', oninput: () => { tr.이름 = nameIn.value.trim() || null; touch(); } });
    const conf = el('select', { onchange: () => { tr.식별확신 = conf.value as Hwaksin; touch(); } }, ...(['확실', '추정', '불명'] as Hwaksin[]).map(v => el('option', { value: v, selected: v === tr.식별확신 }, t(`hwaksin.${v}`))));
    // 비고는 평소 한 줄로 접어 정량 표를 위로 올린다. 누르면 쓴 줄이 다 보이게 펼친다(Enter는 줄바꿈 그대로: 줄마다 하나)
    const notes = growArea(tr.비고.join('\n'), v => { tr.비고 = v.split(/\r?\n/).map(s => s.trim()).filter(Boolean); touch(); markNotes(); }, { rows: 1, label: t('review.notes') });

    // 1점이 아닌 단위만 배점을 보인다(대부분의 세트는 모두 1점이라 표가 그대로)
    const pointsTag = (u: { 배점?: number }) => (unitPoints(u) === 1 ? null : el('div', { class: 'muted' }, t('review.points', { n: unitPoints(u) })));
    const qtyRows = key.정량.map(u => {
      const v = tr.정량[u.id] ??= { 답: '', 판정: '빈칸' };
      const ans = growArea(v.답, s => { v.답 = s; touch(); }, { rows: 1, singleLine: true, label: t('review.col.student') });
      const sel = el('select', { class: `v-${v.판정}`, onchange: () => { v.판정 = sel.value as Panjeong; sel.className = `v-${v.판정}`; touch(); } },
        ...(['O', 'X', '빈칸'] as Panjeong[]).map(p => el('option', { value: p, selected: p === v.판정 }, t(`verdict.${p}`))));
      const keyLine = t('review.keyLine', { answer: u.정답, allow: u.허용?.length ? t('review.allowPart', { list: u.허용.join(', ') }) : '', keywords: u.핵심?.length ? t('review.keywordsPart', { list: u.핵심.join(', ') }) : '' });
      return el('tr', { 'data-unit': u.id }, el('td', {}, u.id, pointsTag(u)), el('td', {}, u.설명, el('div', { class: 'muted' }, keyLine)), el('td', {}, ans), el('td', {}, sel));
    });
    const qualRows = key.정성.map(u => {
      const v = tr.정성[u.id] ??= { 응답: false, 답: '' };
      const cb = el('input', { type: 'checkbox', checked: v.응답, onchange: () => { v.응답 = cb.checked; touch(); } });
      const ta = growArea(v.답, s => { v.답 = s; touch(); }, { rows: 3, label: t('review.col.answer') });
      return el('tr', { 'data-unit': u.id }, el('td', {}, u.id, pointsTag(u)), el('td', {}, u.설명), el('td', {}, el('label', {}, cb, t('review.responded'))), el('td', {}, ta));
    });
    const qtyTable = el('table', {}, el('tr', {}, el('th', {}, t('review.col.id')), el('th', {}, t('review.col.descKey')), el('th', {}, t('review.col.student')), el('th', {}, t('review.col.verdict'))), ...qtyRows);
    const qualTable = el('table', {}, el('tr', {}, el('th', {}, t('review.col.id')), el('th', {}, t('review.col.question')), el('th', {}, t('review.col.response')), el('th', {}, t('review.col.answer'))), ...qualRows);
    function markNotes(): void { for (const row of [...qtyRows, ...qualRows]) row.classList.toggle('note', mentions(tr.비고, row.dataset.unit!)); }
    markNotes();

    renderHeader();
    editor.append(headerBox,
      // 이름표와 칸을 label로 묶어, 전사 칸을 좁혀 줄이 바뀌어도 이름표만 떨어지지 않게
      el('h3', {}, t('review.student')), el('div', { class: 'row student' }, el('label', {}, t('review.grade'), numIn('학년')), el('label', {}, t('review.class'), numIn('반')),
        el('label', {}, t('review.number'), numIn('번호')), el('label', { class: 'name' }, t('review.name'), nameIn), conf),
      data.명단 ? rosterPick(tr) : '',
      el('h3', {}, t('review.notes')), notes,
      el('h3', {}, t('review.qty')), qtyTable,
      el('h3', {}, t('review.qual')), qualTable);
  }

  document.addEventListener('keydown', e => {
    if (root.classList.contains('hidden') || !T) return;
    if ((e.ctrlKey || (MAC && e.metaKey)) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } // 맥은 ⌘S
    // 한글 조합 중의 Enter는 글자 확정이다. 그때 넘기면 마지막 글자가 빠진 채 저장된다
    else if ((e.ctrlKey || (MAC && e.metaKey)) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void saveAndNext(); } // 맥은 ⌘Enter
    else if (MAC && e.altKey && editingText(e.target)) return;
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  store.subscribe(s => {
    if (s.current === shownFor) return;
    if (!dirty) { void reload(); return; }
    if (!notice.querySelector('.set-changed')) notice.append(el('div', { class: 'band warn set-changed' }, t('review.setChanged', { name: s.current ?? '' }))); // 고치던 것이 있으면 바꾸지 않고 알린다
  });
  // 다른 탭에서 전사가 바뀌었을 수 있어 탭이 다시 보일 때 새로 읽는다(고치던 것이 있으면 그대로)
  new MutationObserver(() => { if (!root.classList.contains('hidden') && !dirty) void reload(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  void reload();
}
