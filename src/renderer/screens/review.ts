import type { Hwaksin, Panjeong, Transcript } from '../../core/types.js';
import type { SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { applyFilter, missingStudents, toItems, type Filter } from '../lib/review-filter.js';

const tag = (p: number) => `p${String(p).padStart(2, '0')}`;
const sid = (t: { 학년: number | null; 반: number | null; 번호: number | null }) => `${t.학년 ?? '?'}-${t.반 ?? '?'}-${t.번호 ?? '?'}`;
const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** 비고 문장에 단위 id가 들어 있는지('1-1'이 '1-10'에 걸리지 않게) */
const mentions = (notes: string[], id: string) => notes.some(n => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(n));

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

  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { showError((e as Error).message); } };

  const top = el('div', { class: 'row' });
  const notice = el('div');
  const listItems = el('div');
  const filters = el('div', { class: 'filters' });
  const list = el('div', { class: 'list' }, filters, listItems);
  const img = el('img', { alt: t('review.imageAlt') });
  const zoomText = el('span');
  const viewer = el('div', { class: 'viewer' });
  const editor = el('div', { class: 'editor' });
  const grid = el('div', { class: 'review' }, list, viewer, editor);
  root.append(top, notice, grid);

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
    if (target !== undefined) openPage(target, true); else { T = null; renderEditor(); renderList(); }
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
      listItems.append(el('div', { class: `item${T?.page === i.page ? ' active' : ''}${i.중복 || i.식별확신 === '불명' ? ' bad' : ''}`, onclick: () => go(i.page) },
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

  /** 저장하지 않은 변경이 있으면 운영체제 대화상자로 묻는다(저장 후 나가기/저장하지 않고 나가기/나가지 않기). */
  async function leaveOk(): Promise<boolean> {
    if (!dirty) return true;
    const c = await api.askLeave();
    if (c === 'stay') return false;
    if (c === 'save') { await save(); return !dirty; }
    dirty = false; return true;
  }
  ctx.setLeaveGuard(leaveOk);

  function go(page: number): void {
    if (T?.page === page) return;
    void leaveOk().then(ok => { if (ok) openPage(page, true); });
  }

  function openPage(page: number, force = false): void {
    if (!data) return;
    if (!force && dirty && !confirm(t('review.discardConfirm'))) return;
    const saved = data.transcripts.find(x => x.page === page);
    T = saved ? structuredClone(saved) : blankTranscript(page);
    dirty = false;
    img.src = imageUrl(data.폴더, page);
    renderEditor(); renderList();
  }

  function step(d: number): void {
    const pages = order();
    if (!T) return;
    const i = pages.indexOf(T.page);
    const next = pages[i < 0 ? 0 : i + d];
    if (next !== undefined) go(next);
  }

  const touch = () => { if (!dirty) { dirty = true; renderHeader(); } else updateScore(); };
  const headerBox = el('div');
  const scoreText = el('span');
  const updateScore = () => { if (T) scoreText.textContent = t('review.score', { n: Object.values(T.정량).filter(v => v.판정 === 'O').length + Object.values(T.정성).filter(v => v.응답).length }); };

  function renderHeader(): void {
    clear(headerBox);
    if (!T) return;
    updateScore();
    put(headerBox, el('div', { class: 'row' },
      el('button', { onclick: () => step(-1), title: 'Alt+←' }, t('review.prev')), el('button', { onclick: () => step(1), title: 'Alt+→' }, t('review.next')),
      el('strong', {}, tag(T.page)), scoreText,
      el('button', { class: 'primary', onclick: () => void save(), title: 'Ctrl+S' }, t('common.save')),
      el('label', { title: t('review.recordCasesTitle') }, el('input', { type: 'checkbox', checked: recordCases, onchange: (e: Event) => { recordCases = (e.target as HTMLInputElement).checked; remember(recordCases); } }), t('review.recordCases')),
      dirty ? el('span', { class: 'band warn' }, t('review.unsaved')) : null));
  }

  let saving = false; // Ctrl+S 연타·버튼 연타로 저장과 엑셀 생성이 두 벌 도는 것을 막는다
  async function save(): Promise<void> {
    if (!T || !data || saving) return;
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
      await reload(tr.page); // reload가 notice를 비우므로 안내는 그 뒤에
      if (caseError) showError(caseError);
      if (recordCases && cases.length) {
        const others텍스트 = others.size ? t('review.othersChanged', { list: [...others].map(([p, ch]) => `${tag(p)}(${ch.join(', ')})`).join(', ') }) : t('review.noOthers');
        notice.append(el('div', { class: 'band info' }, t('review.casesRecorded', { n: cases.length, others: others텍스트 })));
      }
      if (r.엑셀오류) notice.append(el('div', { class: 'band warn' }, t('review.savedExcelFailed', { error: r.엑셀오류 })));
      else showInfo(t('review.saved'));
    } catch (e) { showError((e as Error).message); }
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
    clear(editor);
    if (!T || !data) { editor.append(el('div', { class: 'muted' }, t('review.noTranscriptEditor'))); return; }
    const tr = T, key = data.key;
    const numIn = (k: '학년' | '반' | '번호') => { const i = el('input', { type: 'number', min: '1', value: tr[k] === null ? '' : String(tr[k]), oninput: () => { tr[k] = numOrNull(i.value); touch(); } }); i.style.width = '64px'; return i; };
    const nameIn = el('input', { value: tr.이름 ?? '', oninput: () => { tr.이름 = nameIn.value.trim() || null; touch(); } });
    const conf = el('select', { onchange: () => { tr.식별확신 = conf.value as Hwaksin; touch(); } }, ...(['확실', '추정', '불명'] as Hwaksin[]).map(v => el('option', { value: v, selected: v === tr.식별확신 }, t(`hwaksin.${v}`))));
    const notes = el('textarea', { rows: 3, oninput: () => { tr.비고 = notes.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); touch(); markNotes(); } });
    notes.value = tr.비고.join('\n');
    const done = el('input', { type: 'checkbox', checked: tr.확인완료 === true, onchange: () => { tr.확인완료 = done.checked; touch(); } });

    const qtyRows = key.정량.map(u => {
      const v = tr.정량[u.id] ??= { 답: '', 판정: '빈칸' };
      const ans = el('input', { value: v.답, oninput: () => { v.답 = ans.value; touch(); } });
      const sel = el('select', { class: `v-${v.판정}`, onchange: () => { v.판정 = sel.value as Panjeong; sel.className = `v-${v.판정}`; touch(); } },
        ...(['O', 'X', '빈칸'] as Panjeong[]).map(p => el('option', { value: p, selected: p === v.판정 }, t(`verdict.${p}`))));
      const keyLine = t('review.keyLine', { answer: u.정답, allow: u.허용?.length ? t('review.allowPart', { list: u.허용.join(', ') }) : '', keywords: u.핵심?.length ? t('review.keywordsPart', { list: u.핵심.join(', ') }) : '' });
      return el('tr', { 'data-unit': u.id }, el('td', {}, u.id), el('td', {}, u.설명, el('div', { class: 'muted' }, keyLine)), el('td', {}, ans), el('td', {}, sel));
    });
    const qualRows = key.정성.map(u => {
      const v = tr.정성[u.id] ??= { 응답: false, 답: '' };
      const cb = el('input', { type: 'checkbox', checked: v.응답, onchange: () => { v.응답 = cb.checked; touch(); } });
      const ta = el('textarea', { rows: 3, oninput: () => { v.답 = ta.value; touch(); } }); ta.value = v.답;
      return el('tr', { 'data-unit': u.id }, el('td', {}, u.id), el('td', {}, u.설명), el('td', {}, el('label', {}, cb, t('review.responded'))), el('td', {}, ta));
    });
    const qtyTable = el('table', {}, el('tr', {}, el('th', {}, t('review.col.id')), el('th', {}, t('review.col.descKey')), el('th', {}, t('review.col.student')), el('th', {}, t('review.col.verdict'))), ...qtyRows);
    const qualTable = el('table', {}, el('tr', {}, el('th', {}, t('review.col.id')), el('th', {}, t('review.col.question')), el('th', {}, t('review.col.response')), el('th', {}, t('review.col.answer'))), ...qualRows);
    function markNotes(): void { for (const row of [...qtyRows, ...qualRows]) row.classList.toggle('note', mentions(tr.비고, row.dataset.unit!)); }
    markNotes();

    renderHeader();
    editor.append(headerBox,
      el('h3', {}, t('review.student')), el('div', { class: 'row' }, t('review.grade'), numIn('학년'), t('review.class'), numIn('반'), t('review.number'), numIn('번호'), t('review.name'), nameIn, conf),
      data.명단 ? rosterPick(tr) : '',
      el('h3', {}, t('review.notes')), notes,
      el('h3', {}, t('review.qty')), qtyTable,
      el('h3', {}, t('review.qual')), qualTable,
      el('div', { class: 'row' }, el('label', {}, done, t('review.done'))));
  }

  document.addEventListener('keydown', e => {
    if (root.classList.contains('hidden') || !T) return;
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  store.subscribe(s => { if (s.current !== shownFor && !dirty) void reload(); });
  // 다른 탭에서 전사가 바뀌었을 수 있어 탭이 다시 보일 때 새로 읽는다(고치던 것이 있으면 그대로)
  new MutationObserver(() => { if (!root.classList.contains('hidden') && !dirty) void reload(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  void reload();
}
