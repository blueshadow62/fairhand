import type { AnswerKey, Case, GradingRules, Transcript } from '../../core/types.js';
import type { RejudgeResult } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { locale, t } from '../lib/i18n.js';
import { filesToDraft } from '../lib/draft-files.js';
import { pdfPageJpeg, type Rotation } from '../pdf-pages.js';
import { draftToRows, emptyRow, formatHeadcount, keyToRows, parseClasses, parseHeadcount, rowsToKey, UNIT_TYPES, validateRows, type KeyMeta, type UnitRow, type UnitType } from '../lib/key-form.js';

function defaultSemester(d = new Date()): string {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 8) return `${d.getFullYear()} 1학기`;
  return `${m <= 2 ? d.getFullYear() - 1 : d.getFullYear()} 2학기`; // 1·2월은 앞 해 2학기
}

const newMeta = (): KeyMeta => ({ 글: '', 학기: defaultSemester(), 학년: 1, 반: [], 인원: {} });

/** 한 장 시험 결과 표(저장하지 않음) */
export function transcriptTable(key: AnswerKey, tr: Transcript): HTMLElement {
  const box = el('div', { class: 'card' }, el('h3', {}, t('key.trialTitle')),
    el('div', {}, t('key.trialStudent', { grade: tr.학년 ?? '?', cls: tr.반 ?? '?', no: tr.번호 ?? '?', name: tr.이름 ?? '-', conf: t(`hwaksin.${tr.식별확신}`) })));
  box.append(el('table', {}, el('tr', {}, el('th', {}, t('key.col.unit')), el('th', {}, t('key.col.answer')), el('th', {}, t('key.col.student')), el('th', {}, t('key.col.verdict'))),
    ...key.정량.map(u => { const v = tr.정량[u.id]; const p = v?.판정 ?? '빈칸'; return el('tr', {}, el('td', {}, u.id), el('td', {}, u.정답), el('td', {}, v?.답 ?? ''), el('td', { class: `v-${p}` }, t(`verdict.${p}`))); }),
    ...key.정성.map(u => { const v = tr.정성[u.id]; return el('tr', {}, el('td', {}, u.id), el('td', {}, u.설명), el('td', {}, v?.답 ?? ''), el('td', {}, v?.응답 ? t('key.responded') : t('key.noResponse'))); })));
  if (tr.비고.length) box.append(el('div', { class: 'band warn' }, t('key.remarks', { notes: tr.비고.join(' / ') })));
  return box;
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  let 폴더: string | null = null;   // null이면 새 세트
  let meta = newMeta();
  let rows: UnitRow[] = [];
  let 확인: AnswerKey['확인'] | undefined;
  let 사례: Case[] = [];          // 정답표에서 그대로 보존(폼으로 고치지 않음)
  let dirty = false;
  let editing = false;
  let 전사수 = 0;              // 편집 화면이 열려 있는지(새 세트 또는 고른 세트)

  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { showError((e as Error).message); } };
  const touch = () => { if (!dirty) { dirty = true; renderStatus(); } };

  const listBox = el('div', { class: 'setlist' });
  const editor = el('div');
  const statusBox = el('div');
  const tableBox = el('div');
  const cautionBox = el('div');
  const tryBox = el('div');
  root.append(el('h2', {}, t('key.title')), el('div', { class: 'split' }, el('div', {}, listBox), editor));

  /** 저장하지 않은 변경이 있으면 운영체제 대화상자로 묻는다. 저장을 골랐는데 저장이 안 되면(검증 오류) 머문다. */
  async function leaveOk(): Promise<boolean> {
    if (!dirty) return true;
    const c = await api.askLeave();
    if (c === 'stay') return false;
    if (c === 'save') { await save(); return !dirty; }
    dirty = false; return true;
  }
  ctx.setLeaveGuard(leaveOk);

  function renderList(): void {
    clear(listBox);
    listBox.append(el('button', { class: 'primary', onclick: () => void leaveOk().then(ok => { if (ok) openNew(); }) }, t('key.newSet')));
    if (!store.state.settings.학기폴더) { listBox.append(el('div', { class: 'muted' }, t('key.needSemester'))); return; }
    if (!store.state.sets.length) listBox.append(el('div', { class: 'muted' }, t('key.noSets')));
    for (const s of store.state.sets) {
      listBox.append(el('button', { class: s.폴더 === 폴더 ? 'active' : '', onclick: () => { if (s.폴더 !== 폴더) void leaveOk().then(ok => { if (ok) void openSet(s.폴더); }); } },
        el('div', {}, s.key.글), el('div', { class: 'muted' }, t('key.setLine', { grade: s.key.대상.학년, classes: s.key.대상.반.join('·'), pages: s.쪽수, transcripts: s.전사수, status: s.key.확인?.완료 ? t('key.confirmedMark') : t('key.unconfirmedMark') }))));
    }
  }

  function openNew(): void {
    폴더 = null; meta = newMeta(); rows = [emptyRow()]; 확인 = undefined; 사례 = []; 전사수 = 0; dirty = false; editing = true;
    store.update({ current: null });
    renderEditor();
  }

  async function openSet(name: string): Promise<void> {
    await guard(async () => {
      const d = await api.readSet(name);
      const r = keyToRows(d.key);
      폴더 = name; meta = r.meta; rows = r.rows; 확인 = d.key.확인; 사례 = d.key.사례 ?? []; 전사수 = d.transcripts.length; dirty = false; editing = true;
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
  // 초안 수정 채팅: 현재 표 + 지시를 보내 고친 표를 받는다
  const chatLog = el('div', { class: 'chat-log' });
  const chatInput = el('input', { placeholder: t('key.chatPlaceholder'), class: 'chat-input' });
  const chatBtn = el('button', { onclick: () => void sendChat() }, t('key.chatSend'));
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void sendChat(); } });
  const chatHistory: string[] = [];
  function chatLine(who: 'me' | 'ai', text: string): void { chatLog.append(el('div', { class: `chat-msg ${who}` }, el('b', {}, who === 'me' ? t('key.chatMe') : t('key.chatAi')), ' ', text)); chatLog.scrollTop = chatLog.scrollHeight; }
  async function sendChat(): Promise<void> {
    const 지시 = chatInput.value.trim();
    if (!지시) return;
    if (!rows.some(r => r.정답 || r.요소 || r.설명)) { showError(t('key.chatNoRows')); return; }
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
    if (rows.some(r => r.정답 || r.요소 || r.설명) && !confirm(t('key.replaceTableConfirm'))) return;
    draftBtn.disabled = true; draftBtn.textContent = t('key.drafting');
    try {
      const d = await api.draftKey({ 글: meta.글, 문제: problemArea.value, 지문: sourceArea.value.trim() || undefined, 문제그림: uploaded.문제, 지문그림: uploaded.지문 });
      rows = draftToRows(d); touch(); renderTable();
      clear(cautionBox);
      if (d.주의.length) cautionBox.append(el('div', { class: 'band warn' }, t('key.draftCaution', { notes: d.주의.join(' / ') })));
      showInfo(t('key.draftDone'));
    } catch (e) { showError((e as Error).message); }
    finally { draftBtn.disabled = false; draftBtn.textContent = t('key.makeDraft'); }
  }

  function renderTable(): void {
    clear(tableBox);
    const head = el('tr', {}, ...[t('key.col.question'), t('key.col.type'), t('key.col.desc'), t('key.col.answer'), t('key.col.allow'), t('key.col.keywords'), t('key.col.elements'), ''].map(h => el('th', {}, h)));
    const body = rows.map((r, i) => {
      const off = { ans: r.유형 === '요소형' || r.유형 === '확장', allow: r.유형 === '요소형' || r.유형 === '확장', kw: r.유형 !== '문장형', el: r.유형 !== '요소형' };
      const bind = <T extends HTMLInputElement | HTMLTextAreaElement>(node: T, key: '설명' | '정답' | '허용' | '핵심' | '요소') => { node.value = r[key]; node.addEventListener('input', () => { r[key] = node.value; touch(); }); return node; };
      const num = el('input', { type: 'number', min: '1', value: String(r.문항), oninput: () => { r.문항 = Number(num.value); touch(); } });
      const type = el('select', { onchange: () => { r.유형 = type.value as UnitType; touch(); renderTable(); } }, ...UNIT_TYPES.map(u => el('option', { value: u, selected: u === r.유형 }, t(`unit.${u}`))));
      const move = (d: number) => { const j = i + d; if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j]!, rows[i]!]; touch(); renderTable(); };
      return el('tr', {},
        el('td', {}, num), el('td', {}, type),
        el('td', {}, bind(el('input', {}), '설명')),
        el('td', {}, bind(el('input', { disabled: off.ans }), '정답')),
        el('td', {}, bind(el('input', { disabled: off.allow }), '허용')),
        el('td', {}, bind(el('input', { disabled: off.kw }), '핵심')),
        el('td', {}, bind(el('textarea', { rows: 2, disabled: off.el }), '요소')),
        el('td', {}, el('div', { class: 'row' },
          el('button', { title: t('key.up'), onclick: () => move(-1) }, '↑'), el('button', { title: t('key.down'), onclick: () => move(1) }, '↓'),
          el('button', { class: 'danger', onclick: () => { rows.splice(i, 1); touch(); renderTable(); } }, t('common.delete')))));
    });
    const addRow = () => {
      const last = rows[rows.length - 1];
      rows.push(last?.유형 === '빈칸형' ? emptyRow(last.문항, '빈칸형') : emptyRow(last ? last.문항 + 1 : 1)); touch(); renderTable();
    };
    tableBox.append(el('table', { class: 'keytable' }, head, ...body),
      el('div', { class: 'row' }, el('button', { onclick: addRow }, t('key.addRow')),
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
      ...[...사례].reverse().map(c => el('tr', {}, el('td', {}, c.단위), el('td', {}, c.답), el('td', { class: `v-${c.판정}` }, t(`verdict.${c.판정}`)), el('td', {}, c.출처), el('td', {}, Number.isNaN(Date.parse(c.일시)) ? c.일시 : new Date(c.일시).toLocaleString(locale())),
        el('td', {}, el('button', { class: 'danger', onclick: () => guard(async () => {
          if (!폴더 || !confirm(t('key.deleteCaseConfirm', { unit: c.단위, answer: c.답, verdict: c.판정 }))) return;
          사례 = (await api.removeCase(폴더, c.단위, c.답)).사례 ?? [];
          renderCases();
          clear(judgeBox); judgeBox.append(el('div', { class: 'band info' }, t('key.caseDeleted')));
        }) }, t('common.delete')))))));
  }
  function showJudge(r: RejudgeResult & { failed?: { page: number; error: string }[] }, extra = ''): void {
    clear(judgeBox);
    const tagP = (p: number) => `p${String(p).padStart(2, '0')}`;
    const text = r.바뀐장.length ? t('key.changedPages', { n: r.바뀐장.length, list: r.바뀐장.map(c => `${tagP(c.page)}(${c.변경.join(', ')})`).join(', ') }) : t('key.noChangedPages');
    put(judgeBox, el('div', { class: 'band info' }, [text, extra].filter(Boolean).join('\n')),
      r.failed?.length ? el('div', { class: 'band error' }, t('key.failedPages', { list: r.failed.map(f => `${tagP(f.page)} ${f.error}`).join(' / ') })) : null,
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
    const pages = spec ? parsePages(spec) ?? null : undefined;
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
      const next = on ? { 완료: true, 일시: new Date().toISOString() } : { 완료: false };
      확인 = (await api.saveKey(폴더!, rowsToKey(meta, rows, next, 사례))).확인; await store.refreshSets();
      showInfo(on ? t('key.confirmedOn') : t('key.confirmedOff'));
    });
    renderStatus();
  }

  async function save(): Promise<void> {
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
      const saved = await api.saveKey(폴더, rowsToKey(meta, rows, 확인, 사례));
      확인 = saved.확인; 사례 = saved.사례 ?? []; dirty = false;
      await store.refreshSets(); renderStatus(); renderCases();
      showInfo(확인?.완료 ? t('key.saved') : t('key.savedUnconfirmed'));
      if (전사수 > 0 && confirm(t('key.rejudgeConfirm', { n: 전사수 }))) {
        showJudge(await api.rejudge(폴더), t('key.rejudgeNote'));
      }
    });
  }

  const tryInput = el('input', { type: 'file', accept: '.jpg,.jpeg,.pdf' });
  tryInput.addEventListener('change', () => void tryOne());
  async function tryOne(): Promise<void> {
    const f = tryInput.files?.[0]; tryInput.value = '';
    if (!f || !폴더) return;
    clear(tryBox); tryBox.append(el('div', { class: 'muted' }, t('key.trying')));
    try {
      const jpeg = await fileToJpeg(f, store.state.settings.기본회전);
      const tr = await api.tryPage(폴더, jpeg);
      const d = await api.readSet(폴더);
      clear(tryBox); tryBox.append(transcriptTable(d.key, tr));
    } catch (e) { clear(tryBox); showError((e as Error).message); }
  }

  function renderStatus(): void {
    clear(statusBox);
    const done = 확인?.완료 === true;
    confirmBox.checked = done; confirmBox.disabled = !폴더 || dirty;
    statusBox.append(el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: () => void save() }, 폴더 ? t('common.save') : t('key.createSet')),
      el('label', { title: (!폴더 || dirty) ? t('key.confirmAfterSave') : '' }, confirmBox, t('key.confirmLabel')),
      (!폴더 || dirty) ? el('span', { class: 'muted' }, t('key.confirmAfterSave')) : null,
      dirty ? el('span', { class: 'band warn' }, t('key.unsaved')) : null,
      폴더 ? el('button', { onclick: () => guard(async () => { const p = await api.exportKey(폴더!); if (p) showInfo(t('key.exported', { path: p })); }) }, t('key.export')) : null,
      el('button', { onclick: () => guard(async () => {
        const k = await api.importKey(); if (!k) return;
        if (dirty && !confirm(t('key.importConfirm'))) return;
        const r = keyToRows(k); meta = r.meta; rows = r.rows; 확인 = undefined; 사례 = k.사례 ?? []; dirty = true; renderEditor();
        showInfo(t('key.imported'));
      }) }, t('key.import'))));
    if (!done && 폴더) statusBox.append(el('div', { class: 'band warn' }, t('key.notConfirmedWarn')));
    tryInput.disabled = !폴더 || !done || dirty;
  }

  function renderEditor(): void {
    clear(editor); clear(cautionBox); clear(tryBox); attachName.textContent = '';
    if (!editing) { editor.append(el('div', { class: 'muted' }, t('key.pickSet'))); renderList(); return; }
    글Input.value = meta.글; 학기Input.value = meta.학기; 학년Select.value = String(meta.학년); 반Input.value = meta.반.join(', '); 인원Input.value = formatHeadcount(meta.인원);
    editor.append(
      el('div', { class: 'card' }, el('div', { class: 'row' }, el('h3', {}, 폴더 ? t('common.set', { name: 폴더 }) : t('key.newSet')),
          폴더 ? el('button', { class: 'danger', onclick: () => guard(async () => {
            const info = store.state.sets.find(s => s.폴더 === 폴더);
            if (!confirm(t('key.deleteSetConfirm', { title: meta.글, pages: info?.쪽수 ?? 0, transcripts: info?.전사수 ?? 0 }))) return;
            await api.deleteSet(폴더!); dirty = false; await store.refreshSets(); openNew(); showInfo(t('key.setDeleted'));
          }) }, t('key.deleteSet')) : null),
        el('div', { class: 'row' }, t('key.fieldTitle'), 글Input, t('key.fieldSemester'), 학기Input, 학년Select, t('key.fieldClasses'), 반Input, t('key.fieldHeadcount'), 인원Input)),
      el('div', { class: 'card' }, el('h3', {}, t('key.questions')), tableBox, statusBox),
      el('div', { class: 'card' }, el('h3', {}, t('key.makeDraft')),
        el('div', { class: 'muted' }, t('key.draftHelp')),
        el('div', { class: 'row' }, uploadInput('문제', problemArea), uploadInput('지문', sourceArea), clearUploads),
        el('div', { class: 'muted' }, t('key.uploadHint')), uploadNotes,
        problemArea, sourceArea,
        el('div', { class: 'row' }, draftBtn,
          폴더 ? el('button', { onclick: () => guard(async () => { const n = await api.attachSource(폴더!); if (n) attachName.textContent = t('key.attached', { name: n }); }) }, t('key.attach')) : null, attachName),
        cautionBox,
        el('h3', {}, t('key.chatTitle')), el('div', { class: 'muted' }, t('key.chatHelp')), chatLog, el('div', { class: 'row chat-row' }, chatInput, chatBtn)),
      el('div', { class: 'card' }, el('h3', {}, t('key.rulesTitle')), rulesBox, casesBox, judgeBar, judgeBox),
      el('div', { class: 'card' }, el('h3', {}, t('key.tryTitle')),
        el('div', { class: 'muted' }, t('key.tryHelp')),
        tryInput, tryBox));
    renderTable(); renderStatus(); renderList(); renderRules(); renderCases(); clear(judgeBox);
  }

  store.subscribe(() => renderList());
  window.addEventListener('geulnun:open-set', e => { const name = (e as CustomEvent<string>).detail; if (name !== 폴더) void leaveOk().then(ok => { if (ok) void openSet(name); }); });
  renderEditor();
}

/** "1-3,7" → [1,2,3,7], 형식이 틀리면 null */
function parsePages(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',').map(x => x.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    for (let p = Number(m[1]); p <= Number(m[2] ?? m[1]); p++) out.add(p);
  }
  return out.size ? [...out] : null;
}

/** jpg는 그대로, PDF는 첫 장을 기본 회전으로 그려 JPEG로 */
async function fileToJpeg(f: File, rotation: Rotation): Promise<ArrayBuffer> {
  if (/\.jpe?g$/i.test(f.name)) return f.arrayBuffer();
  return pdfPageJpeg(f, 1, rotation);
}
