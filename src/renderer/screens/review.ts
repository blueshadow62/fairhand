import type { Hwaksin, Panjeong, Transcript } from '../../core/types.js';
import type { SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
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
  const filter: Filter = { 비고만: false, 문제먼저: true, 반: null, 검색: '', 미확인만: false };

  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { showError((e as Error).message); } };

  const top = el('div', { class: 'row' });
  const notice = el('div');
  const listItems = el('div');
  const filters = el('div', { class: 'filters' });
  const list = el('div', { class: 'list' }, filters, listItems);
  const img = el('img', { alt: '답안지 그림' });
  const zoomText = el('span');
  const viewer = el('div', { class: 'viewer' });
  const editor = el('div', { class: 'editor' });
  const grid = el('div', { class: 'review' }, list, viewer, editor);
  root.append(top, notice, grid);

  // ── 그림: 확대·축소, Ctrl+휠, 끌어서 옮기기 ──
  const setZoom = (z: number) => { zoom = Math.min(3, Math.max(0.5, Math.round(z * 10) / 10)); img.style.width = `${zoom * 100}%`; zoomText.textContent = `${Math.round(zoom * 100)}%`; };
  viewer.append(el('div', { class: 'viewer-bar' },
    el('button', { onclick: () => setZoom(zoom - 0.25) }, '−'), zoomText, el('button', { onclick: () => setZoom(zoom + 0.25) }, '+'),
    el('button', { onclick: () => setZoom(1) }, '맞춤'), el('span', { class: 'muted' }, 'Ctrl+휠로 확대, 끌어서 이동')), img);
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
    if (!폴더) { data = null; T = null; notice.append(el('div', { class: 'muted' }, '문항 설정에서 세트를 고르세요.')); grid.classList.add('hidden'); return; }
    grid.classList.remove('hidden');
    try { data = await api.readSet(폴더); } catch (e) { showError((e as Error).message); return; }
    put(top, el('h2', {}, `검토: ${폴더}`),
      el('button', { onclick: () => guard(async () => { const r = await api.buildResult(폴더); showInfo(`엑셀을 다시 만들었습니다: ${r.엑셀}`); }) }, '엑셀 다시 만들기'),
      el('button', { onclick: () => guard(async () => {
        const r = await api.buildCumulative();
        clear(notice);
        notice.append(el('div', { class: 'band info' }, '누가기록을 만들었습니다:', ...r.파일.map(f => el('div', { class: 'row' }, el('span', { class: 'path' }, f), el('button', { onclick: () => api.revealPath(f).catch(e => showError(e.message)) }, '폴더에서 보기')))));
      }) }, '누가기록 만들기'));
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
      el('option', { value: '' }, '전체 반'), ...data.key.대상.반.map(b => el('option', { value: String(b), selected: filter.반 === b }, `${b}반`)));
    const search = el('input', { type: 'search', placeholder: '번호 또는 이름', value: filter.검색, oninput: () => { filter.검색 = search.value; renderList(); } });
    filters.append(chk('비고 있는 장만', '비고만'), chk('문제(중복·불명·추정) 먼저', '문제먼저'), chk('미확인만', '미확인만'), cls, search);
  }

  function renderList(): void {
    clear(listItems);
    if (!data) return;
    const items = visibleItems();
    const done = data.transcripts.filter(t => t.확인완료).length;
    listItems.append(el('div', { class: 'item muted' }, `확인 ${done}/${data.transcripts.length}`));
    for (const i of items) {
      const 학생 = i.학년 === null && i.반 === null && i.번호 === null ? '미확인' : sid(i);
      listItems.append(el('div', { class: `item${T?.page === i.page ? ' active' : ''}${i.중복 || i.식별확신 === '불명' ? ' bad' : ''}`, onclick: () => go(i.page) },
        [tag(i.page), 학생, i.이름, i.식별확신 !== '확실' ? i.식별확신 : null, i.중복 ? '중복' : null, i.비고수 ? `비고 ${i.비고수}` : null, i.확인완료 ? '✓' : null].filter(Boolean).join(' · ')));
    }
    for (const p of untranscribed()) listItems.append(el('div', { class: `item bad${T?.page === p ? ' active' : ''}`, onclick: () => go(p) }, `${tag(p)} · 전사 없음`));
    const missing = missingStudents(data.key, data.transcripts, data.명단);
    if (missing.length) listItems.append(el('div', { class: 'item muted' }, `미제출/미확인: ${missing.map(s => `${sid(s)}${s.이름 ? ` ${s.이름}` : ''}`).join(', ')}`));
  }

  function blankTranscript(page: number): Transcript {
    const k = data!.key;
    return { page, 학년: null, 반: null, 번호: null, 이름: null, 식별확신: '불명',
      정량: Object.fromEntries(k.정량.map(u => [u.id, { 답: '', 판정: '빈칸' as Panjeong }])),
      정성: Object.fromEntries(k.정성.map(u => [u.id, { 응답: false, 답: '' }])), 비고: [], 확인완료: false };
  }

  function go(page: number): void {
    if (T?.page === page) return;
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버릴까요?')) return;
    openPage(page);
  }

  function openPage(page: number, force = false): void {
    if (!data) return;
    if (!force && dirty && !confirm('저장하지 않은 변경이 있습니다. 버릴까요?')) return;
    const t = data.transcripts.find(x => x.page === page);
    T = t ? structuredClone(t) : blankTranscript(page);
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
  const updateScore = () => { if (T) scoreText.textContent = `합계 ${Object.values(T.정량).filter(v => v.판정 === 'O').length + Object.values(T.정성).filter(v => v.응답).length}점`; };

  function renderHeader(): void {
    clear(headerBox);
    if (!T) return;
    updateScore();
    put(headerBox, el('div', { class: 'row' },
      el('button', { onclick: () => step(-1), title: 'Alt+←' }, '이전'), el('button', { onclick: () => step(1), title: 'Alt+→' }, '다음'),
      el('strong', {}, tag(T.page)), scoreText,
      el('button', { class: 'primary', onclick: () => void save(), title: 'Ctrl+S' }, '저장'),
      dirty ? el('span', { class: 'band warn' }, '저장하지 않은 변경') : null));
  }

  async function save(): Promise<void> {
    if (!T || !data) return;
    const t = T;
    try {
      const r = await api.saveTranscript(data.폴더, t);
      dirty = false;
      await reload(t.page); // reload가 notice를 비우므로 안내는 그 뒤에
      if (r.엑셀오류) notice.append(el('div', { class: 'band warn' }, `전사는 저장했지만 엑셀을 못 만들었습니다: ${r.엑셀오류}`));
      else showInfo('저장했습니다(엑셀 갱신)');
    } catch (e) { showError((e as Error).message); }
  }

  function renderEditor(): void {
    clear(editor);
    if (!T || !data) { editor.append(el('div', { class: 'muted' }, '전사가 없습니다.')); return; }
    const t = T, key = data.key;
    const numIn = (k: '학년' | '반' | '번호') => { const i = el('input', { type: 'number', min: '1', value: t[k] === null ? '' : String(t[k]), oninput: () => { t[k] = numOrNull(i.value); touch(); } }); i.style.width = '64px'; return i; };
    const nameIn = el('input', { value: t.이름 ?? '', oninput: () => { t.이름 = nameIn.value.trim() || null; touch(); } });
    const conf = el('select', { onchange: () => { t.식별확신 = conf.value as Hwaksin; touch(); } }, ...(['확실', '추정', '불명'] as Hwaksin[]).map(v => el('option', { value: v, selected: v === t.식별확신 }, v)));
    const notes = el('textarea', { rows: 3, oninput: () => { t.비고 = notes.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); touch(); markNotes(); } });
    notes.value = t.비고.join('\n');
    const done = el('input', { type: 'checkbox', checked: t.확인완료 === true, onchange: () => { t.확인완료 = done.checked; touch(); } });

    const qtyRows = key.정량.map(u => {
      const v = t.정량[u.id] ??= { 답: '', 판정: '빈칸' };
      const ans = el('input', { value: v.답, oninput: () => { v.답 = ans.value; touch(); } });
      const sel = el('select', { class: `v-${v.판정}`, onchange: () => { v.판정 = sel.value as Panjeong; sel.className = `v-${v.판정}`; touch(); } },
        ...(['O', 'X', '빈칸'] as Panjeong[]).map(p => el('option', { value: p, selected: p === v.판정 }, p)));
      return el('tr', { 'data-unit': u.id }, el('td', {}, u.id), el('td', {}, u.설명, el('div', { class: 'muted' }, `정답: ${u.정답}${u.허용?.length ? ` (허용: ${u.허용.join(', ')})` : ''}${u.핵심?.length ? ` [핵심: ${u.핵심.join(', ')}]` : ''}`)), el('td', {}, ans), el('td', {}, sel));
    });
    const qualRows = key.정성.map(u => {
      const v = t.정성[u.id] ??= { 응답: false, 답: '' };
      const cb = el('input', { type: 'checkbox', checked: v.응답, onchange: () => { v.응답 = cb.checked; touch(); } });
      const ta = el('textarea', { rows: 3, oninput: () => { v.답 = ta.value; touch(); } }); ta.value = v.답;
      return el('tr', { 'data-unit': u.id }, el('td', {}, u.id), el('td', {}, u.설명), el('td', {}, el('label', {}, cb, '응답')), el('td', {}, ta));
    });
    const qtyTable = el('table', {}, el('tr', {}, el('th', {}, 'id'), el('th', {}, '설명·정답'), el('th', {}, '학생 답'), el('th', {}, '판정')), ...qtyRows);
    const qualTable = el('table', {}, el('tr', {}, el('th', {}, 'id'), el('th', {}, '질문'), el('th', {}, '응답'), el('th', {}, '답')), ...qualRows);
    function markNotes(): void { for (const tr of [...qtyRows, ...qualRows]) tr.classList.toggle('note', mentions(t.비고, tr.dataset.unit!)); }
    markNotes();

    renderHeader();
    editor.append(headerBox,
      el('h3', {}, '학생'), el('div', { class: 'row' }, '학년', numIn('학년'), '반', numIn('반'), '번호', numIn('번호'), '이름', nameIn, conf),
      data.명단있음 ? el('div', { class: 'muted' }, '명단과의 이름 맞춤은 저장 뒤 엑셀에서 합니다.') : '',
      el('h3', {}, '비고(줄마다 하나)'), notes,
      el('h3', {}, '정량'), qtyTable,
      el('h3', {}, '정성'), qualTable,
      el('div', { class: 'row' }, el('label', {}, done, '확인 완료')));
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


