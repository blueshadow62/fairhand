import type { AnswerKey, Case, GradingRules } from '../../core/types.js';
import type { RejudgeResult } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { locale, t } from '../lib/i18n.js';
import { makeGuard, makeLeaveGuard, parsePageSpec, tag } from '../lib/screen-utils.js';
import { hideTip, tip } from '../lib/tip.js';
import { filesToDraft } from '../lib/draft-files.js';
import { answerChangeNotice, cleanupNotice, draftToRows, emptyRow, formatHeadcount, keyToRows, parseClasses, parseHeadcount, rejudgeQuestion, rowsHaveContent, rowsToKey, UNIT_TYPES, validateRows, type KeyMeta, type UnitRow, type UnitType } from '../lib/key-form.js';
import { caseConflict } from '../../core/cases.js';
import { changedUnitIds } from '../../core/unit-map.js';

function defaultSemester(d = new Date()): string {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 8) return `${d.getFullYear()} 1학기`;
  return `${m <= 2 ? d.getFullYear() - 1 : d.getFullYear()} 2학기`; // 1·2월은 앞 해 2학기
}

const newMeta = (): KeyMeta => ({ 글: '', 학기: defaultSemester(), 학년: 1, 반: [], 인원: {} });

/**
 * 다른 화면이 세트를 열 때 보내는 window 사건. 세트를 읽어 store.current로 정하는 일은 문항 설정 화면이 한다.
 * 그 화면이 그려진 뒤에만 들으므로 보낸 쪽은 heard로 들었는지 안다. then은 세트를 연 뒤에 부른다(시작 화면이 세트를 연 다음 채점 실행·검토로 간다)
 */
export const OPEN_SET_EVENT = 'geulnun:open-set';
export interface OpenSetRequest { 폴더: string; then?: () => void; heard?: boolean }
/** 문항 설정 화면이 들었으면 true. false면 아직 그려지지 않은 것이라 그 화면으로 가서 그린 뒤 다시 보낸다 */
export function requestOpenSet(req: OpenSetRequest): boolean {
  window.dispatchEvent(new CustomEvent(OPEN_SET_EVENT, { detail: req }));
  return req.heard === true;
}

/**
 * 글 칸(설명·정답·허용·핵심)은 1280 창에서 80px 남짓이라 쓴 글이 잘린다. 누르고 있는 동안 글 길이만큼 오른쪽 칸 위로 넓혀 다 보이게 한다.
 * 오른쪽 칸도 입력란이라 글이 칸에 들면 넓히지 않는다(덮인 칸을 누르면 넓힌 입력란이 눌린다). 표는 고정 배치라 칸 너비는 그대로이고,
 * 표 오른쪽 끝은 넘지 않는다(넘으면 화면에 가로 막대가 생긴다)
 */
function widen(input: HTMLInputElement): HTMLInputElement {
  const fit = () => {
    input.style.removeProperty('width');
    const table = input.closest('table');
    const wide = !!table && document.activeElement === input && input.scrollWidth > input.clientWidth;
    input.classList.toggle('wide', wide);
    if (!wide) return;
    const room = table.getBoundingClientRect().right - input.getBoundingClientRect().left - 6;
    input.style.width = `${Math.min(input.scrollWidth + 14, room)}px`; // scrollWidth에는 오른쪽 안쪽 여백·테두리와 커서 자리가 들지 않는다
  };
  for (const type of ['focus', 'input', 'blur']) input.addEventListener(type, fit);
  return input;
}

/**
 * 요소 칸(줄마다 하나)은 누르면 쓴 줄이 다 보이게 길어진다. 요소 칸을 쓰는 요소형에서는 정답·허용·핵심이 꺼져 있으므로
 * 그 위로 넓혀 요소 하나가 한 줄에 들게 한다. 띄워서(absolute) 늘리므로 아래 행이 밀리지 않아, 칸을 떠나며 누른 단추가 자리를 옮기지 않는다
 */
function growElements(area: HTMLTextAreaElement): HTMLElement {
  const wrap = el('div', { class: 'grow-elements' }, area);
  let base = 0;
  const size = () => {
    const scroll = area.scrollTop;
    area.style.height = `${base}px`; // 지운 줄만큼 줄어들게 접힌 높이에서 다시 잰다
    const cs = getComputedStyle(area), border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    area.style.height = `${Math.max(base, Math.min(Math.ceil(area.scrollHeight + border), Math.round(innerHeight * 0.45)))}px`;
    area.scrollTop = scroll;
  };
  area.addEventListener('focus', () => {
    const box = area.getBoundingClientRect();
    const answer = area.closest('tr')?.children[3]?.querySelector('input'); // 정답 칸
    base = box.height;
    wrap.style.height = `${base}px`;
    wrap.classList.add('open');
    area.style.width = `${Math.round(box.right - Math.min(box.left, answer?.getBoundingClientRect().left ?? box.left))}px`;
    size();
    area.scrollIntoView({ block: 'nearest' }); // 창 아래쪽 칸이면 늘어난 부분이 저장 막대에 가리지 않게
  });
  area.addEventListener('input', () => { if (wrap.classList.contains('open')) size(); });
  area.addEventListener('blur', () => {
    wrap.classList.remove('open'); wrap.style.removeProperty('height');
    for (const p of ['width', 'height']) area.style.removeProperty(p);
    area.scrollTop = 0;
  });
  return wrap;
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  let 폴더: string | null = null;   // null이면 새 세트
  let meta = newMeta();
  let rows: UnitRow[] = [];
  let 확인: AnswerKey['확인'] | undefined;
  let 사례: Case[] = [];          // 정답표에서 그대로 보존(폼으로 고치지 않음)
  let dirty = false;
  let editing = false;           // 편집 화면이 열려 있는지(새 세트 또는 고른 세트)
  let 전사수 = 0;
  let savedKey: AnswerKey | null = null; // 파일에 있는 정답표. 저장 전에 단위 id의 뜻이 바뀌는지 견준다

  const guard = makeGuard(showError);
  // 채점 실행에서 전사한 뒤 돌아왔을 수 있어, 전사 뒤 새로 읽는 세트 목록의 수를 먼저 본다
  const transcribed = (): number => store.state.sets.find(s => s.폴더 === 폴더)?.전사수 ?? 전사수;
  /**
   * 행을 끼우거나 지우면 단위 id가 다시 매겨진다. 전사는 단위 id로 답을 적어 두었고 저장해도 옮기지 않으므로,
   * 이미 전사한 장이 있는데 같은 id의 뜻이 바뀌면 저장 전에 묻는다. 그만두면 false
   */
  function unitChangesOk(next: AnswerKey): boolean {
    const changed = savedKey ? changedUnitIds(savedKey, next) : [];
    const n = transcribed();
    return !changed.length || !n || confirm(t('key.unitMeaningConfirm', { units: changed.join(', '), n }));
  }
  const touch = () => { if (!dirty) { dirty = true; renderStatus(); } renderStart(); };

  const listBox = el('div', { class: 'setlist' });
  const editor = el('div');
  const saveBar = el('div', { class: 'key-savebar' });
  const tableBox = el('div');
  const cautionBox = el('div');
  root.append(el('h2', {}, t('key.title')), el('div', { class: 'split' }, el('div', {}, listBox), editor));

  // 나가기 경로의 저장은 재판정을 묻지 않는다(운영체제 대화상자 → 브라우저 confirm → 긴 재판정이 연달아 뜨지 않게)
  const leaveOk = makeLeaveGuard(api, { isDirty: () => dirty, save: () => save({ askRejudge: false }), discard: () => { dirty = false; } });
  ctx.setLeaveGuard(leaveOk);

  // 휴지통: 세트 목록 아래 버튼, 누르면 목록(되살리기·영구 삭제)
  const trashBox = el('div', { class: 'trash hidden' });
  let trashOpen = false;
  async function renderTrash(): Promise<void> {
    clear(trashBox); trashBox.classList.toggle('hidden', !trashOpen);
    if (!trashOpen) return;
    const items = await api.listTrash();
    trashBox.append(el('div', { class: 'row' }, el('b', {}, t('key.trash')), el('button', { class: 'small', onclick: () => { trashOpen = false; void renderTrash(); } }, t('key.trashClose'))));
    if (!items.length) { trashBox.append(el('div', { class: 'muted' }, t('key.trashEmpty'))); return; }
    for (const it of items) {
      const when = it.삭제일시 ? new Date(it.삭제일시).toLocaleString(locale()) : '-';
      trashBox.append(el('div', { class: 'trash-item' },
        el('div', {}, it.글 ?? it.원래이름), el('div', { class: 'muted' }, t('key.trashLine', { name: it.원래이름, when })),
        el('div', { class: 'row' },
          el('button', { class: 'small', onclick: () => guard(async () => { const name = await api.restoreSet(it.id); await store.refreshSets(); showInfo(t('key.trashRestored', { name })); await renderTrash(); }) }, t('key.trashRestore')),
          el('button', { class: 'small danger', onclick: () => guard(async () => { if (!confirm(t('key.trashPurgeConfirm', { name: it.원래이름 }))) return; await api.purgeSet(it.id); showInfo(t('key.trashPurged')); await renderTrash(); }) }, t('key.trashPurge')))));
    }
  }

  function renderList(): void {
    clear(listBox);
    listBox.append(el('button', { class: 'primary', onclick: () => void leaveOk().then(ok => { if (ok) openNew(); }) }, t('key.newSet')));
    if (!store.state.settings.학기폴더) { listBox.append(el('div', { class: 'muted' }, t('key.needSemester'))); return; }
    if (!store.state.sets.length) listBox.append(el('div', { class: 'muted' }, t('key.noSets')));
    for (const s of store.state.sets) {
      listBox.append(el('button', { class: s.폴더 === 폴더 ? 'active' : '', onclick: () => { if (s.폴더 !== 폴더) void leaveOk().then(ok => { if (ok) void openSet(s.폴더); }); } },
        el('div', {}, s.key.글), el('div', { class: 'muted' }, t('key.setLine', { grade: s.key.대상.학년, classes: s.key.대상.반.join('·'), pages: s.쪽수, transcripts: s.전사수, status: s.key.확인?.완료 ? t('key.confirmedMark') : t('key.unconfirmedMark') }))));
    }
    listBox.append(el('button', { class: 'small', onclick: () => { trashOpen = !trashOpen; void renderTrash(); } }, t('key.trash')), trashBox);
  }

  function openNew(): void {
    resetDraft();
    폴더 = null; meta = newMeta(); rows = [emptyRow()]; 확인 = undefined; 사례 = []; 전사수 = 0; savedKey = null; dirty = false; editing = true; startPicked = false;
    store.update({ current: null });
    renderEditor();
  }

  async function openSet(name: string): Promise<void> {
    await guard(async () => {
      const d = await api.readSet(name);
      const r = keyToRows(d.key);
      resetDraft();
      폴더 = name; meta = r.meta; rows = r.rows; 확인 = d.key.확인; 사례 = d.key.사례 ?? []; 전사수 = d.transcripts.length; savedKey = d.key; dirty = false; editing = true;
      store.update({ current: name });
      renderEditor();
      sourceArea.value = await api.readSourceText(name).catch(() => '');
    });
  }

  // 메타 입력
  const 글Input = el('input', { size: 30, oninput: () => { meta.글 = 글Input.value; touch(); } });
  const 학기Input = el('input', { size: 12, oninput: () => { meta.학기 = 학기Input.value; touch(); } });
  const 학년Select = el('select', { onchange: () => { meta.학년 = Number(학년Select.value); touch(); } }, ...[1, 2, 3, 4, 5, 6].map(n => el('option', { value: String(n) }, t('key.gradeN', { n }))));
  const 반Input = el('input', { size: 10, placeholder: t('key.classesPlaceholder'), oninput: () => { meta.반 = parseClasses(반Input.value); touch(); } });
  const 인원Input = el('input', { size: 16, placeholder: t('key.headcountPlaceholder'), oninput: () => { meta.인원 = parseHeadcount(인원Input.value); touch(); } });

  // AI 초안
  const problemArea = el('textarea', { rows: 8, placeholder: t('key.problemPlaceholder') });
  const sourceArea = el('textarea', { rows: 6, placeholder: t('key.sourcePlaceholder') });
  const attachName = el('span', { class: 'muted' });
  const draftBtn = el('button', { onclick: () => void makeDraft() }, t('key.makeDraft'));
  // 올린 파일: 그림은 모아 두었다가 초안 요청에 붙이고, 글은 해당 칸에 넣는다. 형식은 제한하지 않는다(accept 없음)
  const uploaded = { 문제: [] as ArrayBuffer[], 지문: [] as ArrayBuffer[] };
  const uploadNotes = el('div', { class: 'muted' });
  function uploadInput(kind: '문제' | '지문', area: HTMLTextAreaElement): HTMLElement {
    const input = el('input', { type: 'file', multiple: true });
    input.addEventListener('change', () => void (async () => {
      const files = [...(input.files ?? [])]; input.value = '';
      if (!files.length) return;
      const r = await filesToDraft(files, name => { uploadNotes.textContent = t('key.uploading', { name }); });
      uploaded[kind].push(...r.images);
      if (r.text) area.value = (area.value.trim() ? area.value.trimEnd() + '\n\n' : '') + r.text;
      uploadNotes.textContent = r.notes.join(' · ');
    })());
    return el('label', { class: 'upload' }, kind === '문제' ? t('key.uploadProblem') : t('key.uploadSource'), input);
  }
  const problemUpload = uploadInput('문제', problemArea), sourceUpload = uploadInput('지문', sourceArea);
  // 초안 수정 채팅: 현재 표 + 지시를 보내 고친 표를 받는다
  const chatLog = el('div', { class: 'chat-log' });
  const chatInput = el('input', { placeholder: t('key.chatPlaceholder'), class: 'chat-input' });
  const chatBtn = el('button', { onclick: () => void sendChat() }, t('key.chatSend'));
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void sendChat(); } });
  const chatHistory: string[] = [];
  /** 초안 입력(문항지 글·지문·올린 그림·채팅)은 세트마다 따로다. 남겨 두면 다른 세트 자료로 초안을 만든다 */
  function resetDraft(): void {
    problemArea.value = ''; sourceArea.value = ''; uploaded.문제.length = 0; uploaded.지문.length = 0;
    chatHistory.length = 0; clear(chatLog); uploadNotes.textContent = ''; chatInput.value = '';
  }
  function chatLine(who: 'me' | 'ai', text: string): void { chatLog.append(el('div', { class: `chat-msg ${who}` }, el('b', {}, who === 'me' ? t('key.chatMe') : t('key.chatAi')), ' ', text)); chatLog.scrollTop = chatLog.scrollHeight; }
  async function sendChat(): Promise<void> {
    const 지시 = chatInput.value.trim();
    if (!지시) return;
    if (!rowsHaveContent(rows)) { showError(t('key.chatNoRows')); return; }
    if (!meta.글.trim()) { showError(t('key.titleMissing')); return; }
    chatInput.value = ''; chatLine('me', 지시);
    const thinking = el('div', { class: 'chat-msg ai muted' }, t('key.chatThinking')); chatLog.append(thinking);
    chatBtn.disabled = true; chatInput.disabled = true;
    try {
      const cur = rowsToKey(meta, rows, undefined, 사례);
      const d = await api.reviseKey({ 글: meta.글, 문제: problemArea.value, 지문: sourceArea.value.trim() || undefined, 문제그림: uploaded.문제, 지문그림: uploaded.지문, 현재: { 정량: cur.정량, 정성: cur.정성 }, 지시, 앞선지시: chatHistory.slice(-5) });
      chatHistory.push(지시);
      rows = draftToRows(d); touch(); renderTable();
      thinking.remove(); chatLine('ai', t('key.chatApplied', { summary: d.주의[0] ?? `${d.정량.length + d.정성.length}` }));
      clear(cautionBox);
      if (d.주의.length > 1) cautionBox.append(el('div', { class: 'band warn' }, t('key.draftCaution', { notes: d.주의.slice(1).join(' / ') })));
    } catch (e) { thinking.remove(); chatLine('ai', (e as Error).message); }
    finally { chatBtn.disabled = false; chatInput.disabled = false; chatInput.focus(); }
  }
  const clearUploads = el('button', { onclick: () => { uploaded.문제 = []; uploaded.지문 = []; uploadNotes.textContent = ''; } }, t('key.uploadClear'));

  async function makeDraft(): Promise<void> {
    if (!meta.글.trim()) { showError(t('key.titleMissing')); return; }
    if (!problemArea.value.trim() && !uploaded.문제.length) { showError(t('key.problemOrFileMissing')); return; }
    if (!sourceArea.value.trim() && !uploaded.지문.length && !confirm(t('key.noSourceConfirm'))) return;
    if (rowsHaveContent(rows) && !confirm(t('key.replaceTableConfirm'))) return;
    draftBtn.disabled = true; draftBtn.textContent = t('key.drafting');
    try {
      const d = await api.draftKey({ 글: meta.글, 문제: problemArea.value, 지문: sourceArea.value.trim() || undefined, 문제그림: uploaded.문제, 지문그림: uploaded.지문 });
      rows = draftToRows(d); touch(); renderTable();
      clear(cautionBox);
      if (d.주의.length) cautionBox.append(el('div', { class: 'band warn' }, t('key.draftCaution', { notes: d.주의.join(' / ') })));
      showTab('questions'); // 초안을 넣은 표와 주의를 바로 확인하게
      showInfo(t('key.draftDone'));
    } catch (e) { showError((e as Error).message); }
    finally { draftBtn.disabled = false; draftBtn.textContent = t('key.makeDraft'); }
  }

  // ── 칸 안의 탭: 문항 표·AI 초안·채점 규칙이 한 화면에 이어져 길이가 2,200px를 넘었다('한 장 채점해 보기'는 답안지를 올리는 일이라 채점 실행으로 옮겼다).
  //    같은 실행 안에서는 마지막에 고른 탭을 유지한다(세트를 바꾸거나 언어를 바꿔 다시 불러와도) ──
  type KeyTab = 'questions' | 'draft' | 'rules';
  const KEY_TABS: KeyTab[] = ['questions', 'draft', 'rules'];
  const TAB_PREF = 'geulnun.key.tab';
  let tab: KeyTab = (() => { try { const v = sessionStorage.getItem(TAB_PREF); return KEY_TABS.find(k => k === v) ?? 'questions'; } catch { return 'questions'; } })();
  const tabLabel: Record<KeyTab, string> = { questions: t('key.questions'), draft: t('key.tab.draft'), rules: t('key.tab.rules') };
  const tabButtons = new Map<KeyTab, HTMLButtonElement>();
  const panels = new Map<KeyTab, HTMLElement>();
  const tabBar = el('div', { class: 'seg key-tabs', role: 'tablist', 'aria-label': t('key.tabs') }, ...KEY_TABS.map(k => {
    const b = el('button', { role: 'tab', id: `key-tab-${k}`, 'aria-controls': `key-panel-${k}`, onclick: () => showTab(k) }, tabLabel[k]);
    tabButtons.set(k, b);
    return b;
  }));
  function showTab(next: KeyTab): void {
    tab = next;
    try { sessionStorage.setItem(TAB_PREF, next); } catch { /* 이번 화면에서만 유지 */ }
    for (const [k, b] of tabButtons) { b.classList.toggle('active', k === next); b.setAttribute('aria-selected', String(k === next)); }
    for (const [k, p] of panels) p.classList.toggle('hidden', k !== next);
  }
  function panel(k: KeyTab, ...children: (Node | string | null)[]): HTMLElement {
    const p = el('div', { role: 'tabpanel', id: `key-panel-${k}`, 'aria-labelledby': `key-tab-${k}` }, ...children);
    panels.set(k, p);
    return p;
  }

  // ── 새 세트의 시작 방법: 빈 표가 먼저 보이고 AI 초안 칸은 표 아래에 있어 손으로 입력부터 하기 쉬웠다. 고르거나 표에 글이 생기면 감춘다 ──
  let startPicked = false;
  let firstDesc: HTMLInputElement | null = null; // '직접 입력'을 고르면 초점을 둘 첫 행의 설명 칸
  const startBox = el('div', { class: 'card key-start' });
  function renderStart(): void {
    if (rowsHaveContent(rows)) startPicked = true; // 쓴 글을 다시 지워도 다시 띄우지 않는다
    startBox.classList.toggle('hidden', !!폴더 || startPicked);
  }
  function pickStart(): void { startPicked = true; renderStart(); }
  const startOption = (title: string, help: string, onclick: () => void) =>
    el('button', { onclick }, el('strong', {}, title), el('span', { class: 'muted' }, help));
  startBox.append(el('h3', {}, t('key.start.title')), el('div', { class: 'muted' }, t('key.start.help')),
    el('div', { class: 'key-start-options' },
      startOption(t('key.start.ai'), t('key.start.aiHelp'), () => {
        pickStart(); showTab('draft');
        problemUpload.querySelector('input')?.focus();
      }),
      startOption(t('key.start.manual'), t('key.start.manualHelp'), () => {
        pickStart(); showTab('questions');
        if (!rows.length) { rows = [emptyRow()]; renderTable(); }
        firstDesc?.focus();
      }),
      startOption(t('key.import'), t('key.start.importHelp'), () => void importKey())));

  function renderTable(): void {
    clear(tableBox);
    firstDesc = null;
    hideTip(); // 다시 그리면 설명을 띄운 칸이 사라져 mouseleave가 오지 않는다
    // 칸 이름에 마우스를 올리면 그 칸에 무엇을 쓰는지(유형은 여섯 유형의 뜻) 보인다
    const typeTip = [t('key.tip.type'), ...UNIT_TYPES.map(u => `${t(`unit.${u}`)}: ${t(`unit.tip.${u}`)}`)].join('\n');
    const cols: [string, string][] = [[t('key.col.question'), t('key.tip.question')], [t('key.col.type'), typeTip], [t('key.col.desc'), t('key.tip.desc')],
      [t('key.col.answer'), t('key.tip.answer')], [t('key.col.allow'), t('key.tip.allow')], [t('key.col.keywords'), t('key.tip.keywords')],
      [t('key.col.elements'), t('key.tip.elements')], [t('key.col.points'), t('key.tip.points')], ['', '']];
    const head = el('tr', {}, ...cols.map(([h, text]) => (text ? tip(el('th', {}, h), text) : el('th', {}, h))));
    const body = rows.flatMap((r, i) => {
      // 논술형은 요소에 인용할 문장, 핵심에 써야 할 용어를 담는다(정답·허용은 쓰지 않음)
      const essay = r.유형 === '논술형';
      const off = { ans: r.유형 === '요소형' || r.유형 === '응답형', allow: r.유형 === '요소형' || r.유형 === '응답형', kw: r.유형 !== '문장형', el: r.유형 !== '요소형' };
      const bind = <T extends HTMLInputElement | HTMLTextAreaElement>(node: T, key: '설명' | '정답' | '허용' | '핵심' | '요소' | '배점' | '용어배점') => { node.value = r[key]; node.addEventListener('input', () => { r[key] = node.value; touch(); }); return node; };
      const pointsIn = (key: '배점' | '용어배점', label: string) => bind(el('input', { type: 'number', min: '0.5', step: '0.5', class: 'points', 'aria-label': label }), key);
      const pointsCell = essay
        ? el('div', { class: 'essay-points' }, el('label', {}, t('key.essay.quote'), pointsIn('배점', t('key.essay.quotePoints'))), el('label', {}, t('key.essay.term'), pointsIn('용어배점', t('key.essay.termPoints'))))
        : pointsIn('배점', t('key.col.points'));
      const num = el('input', { type: 'number', min: '1', 'aria-label': t('key.col.question'), value: String(r.문항), oninput: () => { r.문항 = Number(num.value); touch(); } });
      const type = tip(el('select', { 'aria-label': t('key.col.type'), onchange: () => { r.유형 = type.value as UnitType; touch(); renderTable(); } }, ...UNIT_TYPES.map(u => el('option', { value: u, selected: u === r.유형 }, t(`unit.${u}`)))),
        () => `${t(`unit.${r.유형}`)}: ${t(`unit.tip.${r.유형}`)}`);
      const move = (d: number) => { const j = i + d; if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j]!, rows[i]!]; touch(); renderTable(); };
      const descInput = widen(bind(el('input', { 'aria-label': t('key.col.desc') }), '설명'));
      if (i === 0) firstDesc = descInput;
      const desc = el('td', essay ? { colspan: '5' } : {}, descInput);
      const actions = el('td', {}, el('div', { class: 'row' },
        el('button', { title: t('key.up'), onclick: () => move(-1) }, '↑'), el('button', { title: t('key.down'), onclick: () => move(1) }, '↓'),
        el('button', { class: 'danger', onclick: () => { rows.splice(i, 1); touch(); renderTable(); } }, t('key.deleteRow'))));
      // 논술형의 인용 문장·용어는 길어서 표 칸(좁으면 70px 남짓)에 넣으면 한두 글자씩 끊긴다. 바로 아래 줄을 넓게 쓴다
      if (essay) return [
        el('tr', { class: 'essay-main' }, el('td', {}, num), el('td', {}, type), desc, el('td', {}, pointsCell), actions),
        el('tr', { class: 'essay-detail' }, el('td', { colspan: '2' }), el('td', { colspan: '7' }, el('div', { class: 'essay-fields' },
          el('label', {}, tip(el('span', {}, t('key.essay.quotesHint')), t('key.tip.quotes')), bind(el('textarea', { rows: 3 }), '요소')),
          el('label', {}, tip(el('span', {}, t('key.essay.termsHint')), t('key.tip.terms')), bind(el('input', {}), '핵심'))))),
      ];
      return [el('tr', {},
        el('td', {}, num), el('td', {}, type), desc,
        el('td', {}, widen(bind(el('input', { disabled: off.ans, 'aria-label': t('key.col.answer') }), '정답'))),
        el('td', {}, widen(bind(el('input', { disabled: off.allow, 'aria-label': t('key.col.allow') }), '허용'))),
        el('td', {}, widen(bind(el('input', { disabled: off.kw, 'aria-label': t('key.col.keywords') }), '핵심'))),
        el('td', {}, growElements(bind(el('textarea', { rows: 2, disabled: off.el, 'aria-label': t('key.col.elements') }), '요소'))),
        el('td', {}, pointsCell), actions)];
    });
    const clearAll = () => { if (!confirm(t('key.clearAllConfirm'))) return; rows = [emptyRow()]; touch(); renderTable(); };
    const addRow = () => {
      const last = rows[rows.length - 1];
      rows.push(last?.유형 === '빈칸형' ? emptyRow(last.문항, '빈칸형') : emptyRow(last ? last.문항 + 1 : 1)); touch(); renderTable();
    };
    tableBox.append(el('table', { class: 'keytable' }, head, ...body),
      el('div', { class: 'row' }, el('button', { onclick: addRow }, t('key.addRow')),
        el('button', { class: 'danger', disabled: !rows.length, onclick: clearAll }, t('key.clearAll')),
        el('span', { class: 'muted' }, t('key.typesHelp'))));
  }

  // ── 채점 규칙(세트별) ──
  const rulesBox = el('div');
  const RULES: { k: keyof GradingRules; label: string; opts: [string, string][]; help: string }[] = [
    { k: '맞춤법', label: t('key.rule.spelling'), opts: [['인정', t('key.rule.accept')], ['불인정', t('key.rule.reject')]], help: t('key.rule.spellingHelp') },
    { k: '넓은말', label: t('key.rule.broader'), opts: [['인정', t('key.rule.accept')], ['불인정', t('key.rule.reject')]], help: t('key.rule.broaderHelp') },
    { k: '핵심어', label: t('key.rule.keywords'), opts: [['모두', t('key.rule.all')], ['하나라도', t('key.rule.any')]], help: t('key.rule.keywordsHelp') },
  ];
  function renderRules(): void {
    clear(rulesBox);
    const cur = meta.채점규칙 ?? { 맞춤법: '인정', 넓은말: '불인정', 핵심어: '모두' };
    for (const r of RULES) {
      const sel = el('select', { onchange: () => { meta.채점규칙 = { ...cur, [r.k]: sel.value } as GradingRules; touch(); renderRules(); } },
        ...r.opts.map(([v, label]) => el('option', { value: v, selected: cur[r.k] === v }, label)));
      rulesBox.append(el('div', { class: 'row' }, el('span', {}, `${r.label}:`), sel, el('span', { class: 'muted' }, r.help)));
    }
    rulesBox.append(el('div', { class: 'muted' }, t('key.rulesHelp')));
  }

  // ── 판정 사례와 재판정 ──
  const casesBox = el('div');
  const judgeBox = el('div');
  const judgePages = el('input', { size: 8, placeholder: t('common.pagesPlaceholder') });
  function renderCases(): void {
    clear(casesBox);
    if (!사례.length) { casesBox.append(el('div', { class: 'muted' }, t('key.noCases'))); return; }
    casesBox.append(el('table', {}, el('tr', {}, ...[t('key.col.unit'), t('key.col.caseAnswer'), t('key.col.verdict'), t('key.col.caseSource'), t('key.col.caseWhen'), ''].map(h => el('th', {}, h))),
      // 정답·허용과 같은 답을 X로 정한 사례는 다시 판정에서 정답보다 먼저 적용된다. 알고 정한 예외일 수 있어 표시만 한다
      ...[...사례].reverse().map(c => el('tr', {}, el('td', {}, c.단위), el('td', {}, c.답),
        el('td', { class: `v-${c.판정}` }, t(`verdict.${c.판정}`), savedKey && caseConflict(savedKey, c) ? tip(el('span', { class: 'case-conflict' }, t('key.caseConflict')), t('key.caseConflictTip')) : null),
        el('td', {}, c.출처), el('td', {}, Number.isNaN(Date.parse(c.일시)) ? c.일시 : new Date(c.일시).toLocaleString(locale())),
        el('td', {}, el('button', { class: 'danger', onclick: () => guard(async () => {
          if (!폴더 || !confirm(t('key.deleteCaseConfirm', { unit: c.단위, answer: c.답, verdict: c.판정 }))) return;
          사례 = (await api.removeCase(폴더, c.단위, c.답)).사례 ?? [];
          renderCases();
          clear(judgeBox); judgeBox.append(el('div', { class: 'band info' }, t('key.caseDeleted')));
        }) }, t('common.delete')))))));
  }
  function showJudge(r: RejudgeResult & { failed?: { page: number; error: string }[] }, extra = ''): void {
    clear(judgeBox);
    const text = r.바뀐장.length ? t('key.changedPages', { n: r.바뀐장.length, list: r.바뀐장.map(c => `${tag(c.page)}(${c.변경.join(', ')})`).join(', ') }) : t('key.noChangedPages');
    put(judgeBox, el('div', { class: 'band info' }, [text, extra].filter(Boolean).join('\n')),
      r.다시확인?.length ? el('div', { class: 'band warn' }, t('key.recheckPages', { n: r.다시확인.length })) : null,
      r.failed?.length ? el('div', { class: 'band error' }, t('key.failedPages', { list: r.failed.map(f => `${tag(f.page)} ${f.error}`).join(' / ') })) : null,
      r.엑셀오류 ? el('div', { class: 'band warn' }, t('common.excelFailed', { error: r.엑셀오류 })) : null);
  }
  const ruleBtn = el('button', { onclick: () => guard(async () => {
    if (!폴더) return;
    if (dirty) { showError(t('common.saveKeyFirst')); return; }
    showJudge(await api.rejudge(폴더), t('key.rejudgeNote'));
  }) }, t('key.rejudge'));
  const modelBtn = el('button', { onclick: () => guard(async () => {
    if (!폴더) return;
    if (dirty) { showError(t('common.saveKeyFirst')); return; }
    const spec = judgePages.value.trim();
    const pages = spec ? parsePageSpec(spec) ?? null : undefined;
    if (pages === null) { showError(t('common.badPageSpec')); return; }
    if (!confirm(t('key.modelConfirm', { scope: pages ? t('key.nPages', { n: pages.length }) : t('key.allTranscribed') }))) return;
    modelBtn.disabled = true;
    const off = api.onProgress(e => { modelBtn.textContent = t('key.modelJudging', { done: e.done, total: e.total }); });
    try { showJudge(await api.judgeWithModel(폴더, { pages })); }
    finally { off(); modelBtn.disabled = false; modelBtn.textContent = t('key.modelRejudge'); }
  }) }, t('key.modelRejudge'));
  const judgeBar = el('div', { class: 'row' }, ruleBtn, modelBtn, t('key.pagesLabel'), judgePages);

  const confirmBox = el('input', { type: 'checkbox', onchange: () => void setConfirmed(confirmBox.checked) });
  async function setConfirmed(on: boolean): Promise<void> {
    if (!폴더 || dirty) { confirmBox.checked = !on; showError(t('common.saveKeyFirst')); return; }
    await guard(async () => {
      const next = rowsToKey(meta, rows, on ? { 완료: true, 일시: new Date().toISOString() } : { 완료: false }, 사례);
      if (!unitChangesOk(next)) return;
      const r = await api.saveKey(폴더!, next);
      savedKey = r.key; 확인 = r.key.확인; await store.refreshSets();
      showInfo([on ? t('key.confirmedOn') : t('key.confirmedOff'), cleanupNotice(r.정리), answerChangeNotice(r.정답바뀐사례)].filter(Boolean).join('\n'));
    });
    renderStatus();
  }

  async function save(opts: { askRejudge?: boolean } = {}): Promise<void> {
    const errs = validateRows(meta, rows);
    if (errs.length) { showError(errs.join('\n')); return; }
    await guard(async () => {
      if (!폴더) {
        const info = await api.createSet(rowsToKey(meta, rows, undefined, 사례));
        await store.refreshSets();
        dirty = false; await openSet(info.폴더);
        showInfo(t('key.setCreated', { name: info.폴더 }));
        return;
      }
      // 채점 내용(단위·정답·허용·핵심)이 바뀌었으면 메인이 확인을 지운다. 채점규칙만 바꾼 저장은 확인 유지
      const next = rowsToKey(meta, rows, 확인, 사례);
      if (!unitChangesOk(next)) return;
      const r = await api.saveKey(폴더, next);
      savedKey = r.key; 확인 = r.key.확인; 사례 = r.key.사례 ?? []; dirty = false;
      await store.refreshSets(); renderStatus(); renderCases();
      showInfo([확인?.완료 ? t('key.saved') : t('key.savedUnconfirmed'), cleanupNotice(r.정리), answerChangeNotice(r.정답바뀐사례)].filter(Boolean).join('\n'));
      const n = transcribed();
      if (n > 0 && opts.askRejudge !== false && confirm(rejudgeQuestion(n, r.정답바뀐사례))) {
        showJudge(await api.rejudge(폴더), t('key.rejudgeNote'));
      }
    });
  }

  async function importKey(): Promise<void> {
    await guard(async () => {
      const k = await api.importKey(); if (!k) return;
      if (dirty && !confirm(t('key.importConfirm'))) return;
      const r = keyToRows(k); meta = r.meta; rows = r.rows; 확인 = undefined; 사례 = k.사례 ?? []; dirty = true; startPicked = true;
      tab = 'questions'; // 가져온 표를 바로 확인하게
      renderEditor();
      showInfo(t('key.imported'));
    });
  }

  // 저장 막대: 문항이 많으면 표 아래의 저장·확인 완료가 화면 밖으로 밀려났다. 편집 칸 아래쪽에 붙여 늘 보이게 한다
  function renderStatus(): void {
    clear(saveBar);
    const done = 확인?.완료 === true, locked = !폴더 || dirty;
    confirmBox.checked = done; confirmBox.disabled = locked;
    put(saveBar,
      el('button', { class: 'primary', onclick: () => void save() }, 폴더 ? t('common.save') : t('key.createSet')),
      el('label', { title: locked ? t('key.confirmAfterSave') : '' }, confirmBox, t('key.confirmLabel')),
      locked ? el('span', { class: 'muted' }, t('key.confirmAfterSave')) : done ? null : el('span', { class: 'warn-text' }, t('key.notConfirmedWarn')),
      dirty ? el('span', { class: 'band warn' }, t('key.unsaved')) : null);
  }

  function renderEditor(): void {
    clear(editor); clear(cautionBox); attachName.textContent = '';
    if (!editing) { editor.append(el('div', { class: 'muted' }, t('key.pickSet'))); renderList(); return; }
    글Input.value = meta.글; 학기Input.value = meta.학기; 학년Select.value = String(meta.학년); 반Input.value = meta.반.join(', '); 인원Input.value = formatHeadcount(meta.인원);
    editor.append(
      // 정답표 내보내기·가져오기는 표만이 아닌 정답표 전체(세트 정보·채점 규칙·사례)를 다루므로 세트 이름 옆에 둔다
      el('div', { class: 'card' }, el('div', { class: 'row' }, el('h3', {}, 폴더 ? t('common.set', { name: 폴더 }) : t('key.newSet')),
          el('button', { onclick: () => void importKey() }, t('key.import')),
          폴더 ? el('button', { onclick: () => guard(async () => { const p = await api.exportKey(폴더!); if (p) showInfo(t('key.exported', { path: p })); }) }, t('key.export')) : null,
          폴더 ? el('button', { class: 'danger', onclick: () => guard(async () => {
            const info = store.state.sets.find(s => s.폴더 === 폴더);
            if (!confirm(t('key.deleteSetConfirm', { title: meta.글, pages: info?.쪽수 ?? 0, transcripts: info?.전사수 ?? 0 }))) return;
            await api.deleteSet(폴더!); dirty = false; await store.refreshSets(); openNew(); showInfo(t('key.setDeleted'));
          }) }, t('key.deleteSet')) : null),
        // 이름표와 입력란을 label 하나로 묶는다. 따로 두면 줄이 바뀔 때 '반'만 줄 끝에 남고 입력란은 다음 줄로 갔다
        el('div', { class: 'row key-meta' }, el('label', {}, t('key.fieldTitle'), 글Input), el('label', {}, t('key.fieldSemester'), 학기Input), 학년Select,
          el('label', {}, t('key.fieldClasses'), 반Input), el('label', {}, t('key.fieldHeadcount'), 인원Input))),
      startBox,
      // 초안 주의(cautionBox)는 표에 대한 것이라 표 위에 둔다. 저장 막대는 채점 규칙도 같은 저장으로 적용되므로 탭 밖에 둔다
      el('div', { class: 'card key-tabcard' }, tabBar,
        panel('questions', cautionBox, tableBox),
        panel('draft', el('h3', {}, t('key.makeDraft')),
          el('div', { class: 'muted' }, t('key.draftHelp')),
          el('div', { class: 'row' }, problemUpload, sourceUpload, clearUploads),
          el('div', { class: 'muted' }, t('key.uploadHint')), uploadNotes,
          problemArea, sourceArea,
          el('div', { class: 'row' }, draftBtn,
            폴더 ? el('button', { onclick: () => guard(async () => { const n = await api.attachSource(폴더!); if (n) attachName.textContent = t('key.attached', { name: n }); }) }, t('key.attach')) : null, attachName),
          el('h3', {}, t('key.chatTitle')), el('div', { class: 'muted' }, t('key.chatHelp')), chatLog, el('div', { class: 'row chat-row' }, chatInput, chatBtn)),
        panel('rules', rulesBox, casesBox, judgeBar, judgeBox)),
      saveBar);
    showTab(tab);
    renderTable(); renderStatus(); renderList(); renderRules(); renderCases(); renderStart(); clear(judgeBox);
  }

  store.subscribe(() => renderList());
  window.addEventListener(OPEN_SET_EVENT, e => {
    const req = (e as CustomEvent<OpenSetRequest>).detail;
    req.heard = true;
    if (req.폴더 === 폴더 && store.state.current === 폴더) { req.then?.(); return; }
    void leaveOk().then(async ok => { if (!ok) return; await openSet(req.폴더); if (폴더 === req.폴더) req.then?.(); }); // 못 열었으면(오류는 알림으로) 다른 화면으로 가지 않는다
  });
  renderEditor();
}
