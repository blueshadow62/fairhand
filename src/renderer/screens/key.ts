import type { AnswerKey, Transcript } from '../../core/types.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { draftToRows, emptyRow, formatHeadcount, keyToRows, parseClasses, parseHeadcount, rowsToKey, UNIT_TYPES, validateRows, type KeyMeta, type UnitRow, type UnitType } from '../lib/key-form.js';

function defaultSemester(d = new Date()): string {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 8) return `${d.getFullYear()} 1학기`;
  return `${m <= 2 ? d.getFullYear() - 1 : d.getFullYear()} 2학기`; // 1·2월은 앞 해 2학기
}

const newMeta = (): KeyMeta => ({ 글: '', 학기: defaultSemester(), 학년: 1, 반: [], 인원: {} });

/** 한 장 시험 결과 표(저장하지 않음) */
export function transcriptTable(key: AnswerKey, t: Transcript): HTMLElement {
  const box = el('div', { class: 'card' }, el('h3', {}, '시험 전사 결과(저장하지 않았습니다)'),
    el('div', {}, `학년 ${t.학년 ?? '?'} · 반 ${t.반 ?? '?'} · 번호 ${t.번호 ?? '?'} · 이름 ${t.이름 ?? '-'} · 식별 ${t.식별확신}`));
  box.append(el('table', {}, el('tr', {}, el('th', {}, '단위'), el('th', {}, '정답'), el('th', {}, '학생 답'), el('th', {}, '판정')),
    ...key.정량.map(u => { const v = t.정량[u.id]; return el('tr', {}, el('td', {}, u.id), el('td', {}, u.정답), el('td', {}, v?.답 ?? ''), el('td', { class: `v-${v?.판정 ?? '빈칸'}` }, v?.판정 ?? '빈칸')); }),
    ...key.정성.map(u => { const v = t.정성[u.id]; return el('tr', {}, el('td', {}, u.id), el('td', {}, u.설명), el('td', {}, v?.답 ?? ''), el('td', {}, v?.응답 ? '응답' : '무응답')); })));
  if (t.비고.length) box.append(el('div', { class: 'band warn' }, `비고: ${t.비고.join(' / ')}`));
  return box;
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  let 폴더: string | null = null;   // null이면 새 세트
  let meta = newMeta();
  let rows: UnitRow[] = [];
  let 확인: AnswerKey['확인'] | undefined;
  let dirty = false;
  let editing = false;              // 편집 화면이 열려 있는지(새 세트 또는 고른 세트)

  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { showError((e as Error).message); } };
  const touch = () => { if (!dirty) { dirty = true; renderStatus(); } };

  const listBox = el('div', { class: 'setlist' });
  const editor = el('div');
  const statusBox = el('div');
  const tableBox = el('div');
  const cautionBox = el('div');
  const tryBox = el('div');
  root.append(el('h2', {}, '문항 설정'), el('div', { class: 'split' }, el('div', {}, listBox), editor));

  const confirmLeave = () => !dirty || confirm('저장하지 않은 변경이 있습니다. 버릴까요?');

  function renderList(): void {
    clear(listBox);
    listBox.append(el('button', { class: 'primary', onclick: () => { if (confirmLeave()) openNew(); } }, '새 세트'));
    if (!store.state.settings.학기폴더) { listBox.append(el('div', { class: 'muted' }, '설정에서 학기 폴더를 먼저 고르세요.')); return; }
    if (!store.state.sets.length) listBox.append(el('div', { class: 'muted' }, '아직 세트가 없습니다.'));
    for (const s of store.state.sets) {
      listBox.append(el('button', { class: s.폴더 === 폴더 ? 'active' : '', onclick: () => { if (s.폴더 !== 폴더 && confirmLeave()) void openSet(s.폴더); } },
        el('div', {}, s.key.글), el('div', { class: 'muted' }, `${s.key.대상.학년}학년 ${s.key.대상.반.join('·')}반 · ${s.쪽수}장/전사 ${s.전사수} · ${s.key.확인?.완료 ? '확인 ✓' : '미확인'}`)));
    }
  }

  function openNew(): void {
    폴더 = null; meta = newMeta(); rows = [emptyRow()]; 확인 = undefined; dirty = false; editing = true;
    store.update({ current: null });
    renderEditor();
  }

  async function openSet(name: string): Promise<void> {
    await guard(async () => {
      const d = await api.readSet(name);
      const r = keyToRows(d.key);
      폴더 = name; meta = r.meta; rows = r.rows; 확인 = d.key.확인; dirty = false; editing = true;
      store.update({ current: name });
      renderEditor();
      sourceArea.value = await api.readSourceText(name).catch(() => '');
    });
  }

  // 메타 입력
  const 글Input = el('input', { size: 30, oninput: () => { meta.글 = 글Input.value; touch(); } });
  const 학기Input = el('input', { size: 12, oninput: () => { meta.학기 = 학기Input.value; touch(); } });
  const 학년Select = el('select', { onchange: () => { meta.학년 = Number(학년Select.value); touch(); } }, ...[1, 2, 3, 4, 5, 6].map(n => el('option', { value: String(n) }, `${n}학년`)));
  const 반Input = el('input', { size: 10, placeholder: '예: 1, 3', oninput: () => { meta.반 = parseClasses(반Input.value); touch(); } });
  const 인원Input = el('input', { size: 16, placeholder: '예: 1:28, 3:27', oninput: () => { meta.인원 = parseHeadcount(인원Input.value); touch(); } });

  // AI 초안
  const problemArea = el('textarea', { rows: 8, placeholder: '문항지의 문제 전체를 붙여넣으세요' });
  const sourceArea = el('textarea', { rows: 6, placeholder: '지문(원문)을 붙여넣으세요(선택). 붙여넣은 지문은 초안을 만들 때만 쓰고 저장하지 않습니다.' });
  const attachName = el('span', { class: 'muted' });
  const draftBtn = el('button', { onclick: () => void makeDraft() }, 'AI로 정답 초안 만들기');

  async function makeDraft(): Promise<void> {
    if (!meta.글.trim()) { showError('글 제목을 먼저 적으세요'); return; }
    if (!problemArea.value.trim()) { showError('문항지의 문제를 붙여넣으세요'); return; }
    if (!sourceArea.value.trim() && !confirm('지문 없이 만든 초안은 부정확할 수 있습니다. 계속할까요?')) return;
    if (rows.some(r => r.정답 || r.요소 || r.설명) && !confirm('문항 표를 초안으로 바꿉니다. 계속할까요?')) return;
    draftBtn.disabled = true; draftBtn.textContent = '초안을 만드는 중…';
    try {
      const d = await api.draftKey({ 글: meta.글, 문제: problemArea.value, 지문: sourceArea.value.trim() || undefined });
      rows = draftToRows(d); touch(); renderTable();
      clear(cautionBox);
      if (d.주의.length) cautionBox.append(el('div', { class: 'band warn' }, `초안 주의: ${d.주의.join(' / ')}`));
      showInfo('초안을 표에 넣었습니다. 확인하고 고친 뒤 저장하세요');
    } catch (e) { showError((e as Error).message); }
    finally { draftBtn.disabled = false; draftBtn.textContent = 'AI로 정답 초안 만들기'; }
  }

  function renderTable(): void {
    clear(tableBox);
    const head = el('tr', {}, ...['문항', '유형', '설명', '정답', '허용(쉼표)', '핵심(쉼표)', '요소(줄마다)', ''].map(h => el('th', {}, h)));
    const body = rows.map((r, i) => {
      const off = { ans: r.유형 === '요소형' || r.유형 === '확장', allow: r.유형 === '요소형' || r.유형 === '확장', kw: r.유형 !== '문장형', el: r.유형 !== '요소형' };
      const bind = <T extends HTMLInputElement | HTMLTextAreaElement>(node: T, key: '설명' | '정답' | '허용' | '핵심' | '요소') => { node.value = r[key]; node.addEventListener('input', () => { r[key] = node.value; touch(); }); return node; };
      const num = el('input', { type: 'number', min: '1', value: String(r.문항), oninput: () => { r.문항 = Number(num.value); touch(); } });
      const type = el('select', { onchange: () => { r.유형 = type.value as UnitType; touch(); renderTable(); } }, ...UNIT_TYPES.map(t => el('option', { value: t, selected: t === r.유형 }, t)));
      const move = (d: number) => { const j = i + d; if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j]!, rows[i]!]; touch(); renderTable(); };
      return el('tr', {},
        el('td', {}, num), el('td', {}, type),
        el('td', {}, bind(el('input', {}), '설명')),
        el('td', {}, bind(el('input', { disabled: off.ans }), '정답')),
        el('td', {}, bind(el('input', { disabled: off.allow }), '허용')),
        el('td', {}, bind(el('input', { disabled: off.kw }), '핵심')),
        el('td', {}, bind(el('textarea', { rows: 2, disabled: off.el }), '요소')),
        el('td', {}, el('div', { class: 'row' },
          el('button', { title: '위로', onclick: () => move(-1) }, '↑'), el('button', { title: '아래로', onclick: () => move(1) }, '↓'),
          el('button', { class: 'danger', onclick: () => { rows.splice(i, 1); touch(); renderTable(); } }, '삭제'))));
    });
    const addRow = () => {
      const last = rows[rows.length - 1];
      rows.push(last?.유형 === '빈칸형' ? emptyRow(last.문항, '빈칸형') : emptyRow(last ? last.문항 + 1 : 1)); touch(); renderTable();
    };
    tableBox.append(el('table', { class: 'keytable' }, head, ...body),
      el('div', { class: 'row' }, el('button', { onclick: addRow }, '행 추가'),
        el('span', { class: 'muted' }, '빈칸형: 빈칸마다 한 줄. 단답형: 답 하나. 문장형: 핵심 낱말이 모두 들어 있어야 O. 요소형: 요소마다 1점, 순서 무관. 확장: 응답 여부만 봄.')));
  }

  const confirmBox = el('input', { type: 'checkbox', onchange: () => void setConfirmed(confirmBox.checked) });
  async function setConfirmed(on: boolean): Promise<void> {
    if (!폴더 || dirty) { confirmBox.checked = !on; showError('먼저 정답표를 저장하세요'); return; }
    await guard(async () => {
      const next = on ? { 완료: true, 일시: new Date().toISOString() } : { 완료: false };
      await api.saveKey(폴더!, rowsToKey(meta, rows, next));
      확인 = next; await store.refreshSets();
      showInfo(on ? '정답표를 확인 완료로 표시했습니다' : '확인 표시를 지웠습니다');
    });
    renderStatus();
  }

  async function save(): Promise<void> {
    const errs = validateRows(meta, rows);
    if (errs.length) { showError(errs.join('\n')); return; }
    await guard(async () => {
      if (!폴더) {
        const info = await api.createSet(rowsToKey(meta, rows));
        await store.refreshSets();
        dirty = false; await openSet(info.폴더);
        showInfo(`새 세트를 만들었습니다: ${info.폴더}`);
        return;
      }
      // 정답표 내용이 바뀐 저장은 확인을 지운다(다시 확인해야 채점할 수 있다)
      const next = dirty ? (확인 ? { 완료: false } : undefined) : 확인;
      await api.saveKey(폴더, rowsToKey(meta, rows, next));
      확인 = next; dirty = false;
      await store.refreshSets(); renderStatus();
      showInfo('저장했습니다');
    });
  }

  const tryInput = el('input', { type: 'file', accept: '.jpg,.jpeg,.pdf' });
  tryInput.addEventListener('change', () => void tryOne());
  async function tryOne(): Promise<void> {
    const f = tryInput.files?.[0]; tryInput.value = '';
    if (!f || !폴더) return;
    clear(tryBox); tryBox.append(el('div', { class: 'muted' }, '한 장을 전사하는 중… (1분 안팎)'));
    try {
      const jpeg = await fileToJpeg(f, store.state.settings.기본회전);
      const t = await api.tryPage(폴더, jpeg);
      const d = await api.readSet(폴더);
      clear(tryBox); tryBox.append(transcriptTable(d.key, t));
    } catch (e) { clear(tryBox); showError((e as Error).message); }
  }

  function renderStatus(): void {
    clear(statusBox);
    const done = 확인?.완료 === true;
    confirmBox.checked = done;
    statusBox.append(el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: () => void save() }, 폴더 ? '저장' : '새 세트 만들기'),
      el('label', {}, confirmBox, '확인 완료(이 정답표로 채점합니다)'),
      dirty ? el('span', { class: 'band warn' }, '저장하지 않은 변경이 있습니다') : null,
      폴더 ? el('button', { onclick: () => guard(async () => { const p = await api.exportKey(폴더!); if (p) showInfo(`내보냈습니다: ${p}`); }) }, '정답표 내보내기') : null,
      el('button', { onclick: () => guard(async () => {
        const k = await api.importKey(); if (!k) return;
        if (dirty && !confirm('지금 편집 중인 내용을 가져온 정답표로 바꿉니다. 계속할까요?')) return;
        const r = keyToRows(k); meta = r.meta; rows = r.rows; 확인 = undefined; dirty = true; renderEditor();
        showInfo('가져왔습니다. 확인하고 저장하세요');
      }) }, '정답표 가져오기')));
    if (!done && 폴더) statusBox.append(el('div', { class: 'band warn' }, '정답표가 아직 확인되지 않았습니다. 확인 완료를 표시해야 채점을 시작할 수 있습니다.'));
    tryInput.disabled = !폴더 || !done || dirty;
  }

  function renderEditor(): void {
    clear(editor); clear(cautionBox); clear(tryBox); attachName.textContent = '';
    if (!editing) { editor.append(el('div', { class: 'muted' }, "왼쪽에서 세트를 고르거나 '새 세트'를 누르세요.")); renderList(); return; }
    글Input.value = meta.글; 학기Input.value = meta.학기; 학년Select.value = String(meta.학년); 반Input.value = meta.반.join(', '); 인원Input.value = formatHeadcount(meta.인원);
    editor.append(
      el('div', { class: 'card' }, el('h3', {}, 폴더 ? `세트: ${폴더}` : '새 세트'),
        el('div', { class: 'row' }, '글 제목', 글Input, '학기', 학기Input, 학년Select, '반', 반Input, '반별 인원(선택)', 인원Input)),
      el('div', { class: 'card' }, el('h3', {}, '문항'), tableBox),
      el('div', { class: 'card' }, el('h3', {}, 'AI로 정답 초안 만들기'),
        el('div', { class: 'muted' }, '문제와 지문을 보내 초안을 받습니다. 초안은 반드시 확인하고 고친 뒤 저장하세요.'),
        problemArea, sourceArea,
        el('div', { class: 'row' }, draftBtn,
          폴더 ? el('button', { onclick: () => guard(async () => { const n = await api.attachSource(폴더!); if (n) attachName.textContent = `원본 폴더에 보관함: ${n}`; }) }, '지문 PDF/TXT 첨부(보관용)') : null, attachName),
        cautionBox),
      statusBox,
      el('div', { class: 'card' }, el('h3', {}, '한 장만 채점해 보기'),
        el('div', { class: 'muted' }, '답안지 한 장(jpg 또는 PDF의 첫 장)으로 전사를 시험합니다. 결과는 저장하지 않습니다. 확인 완료된 정답표에서만 됩니다.'),
        tryInput, tryBox));
    renderTable(); renderStatus(); renderList();
  }

  store.subscribe(() => renderList());
  renderEditor();
}

/** jpg는 그대로, PDF는 첫 장을 기본 회전으로 그려 JPEG로 */
async function fileToJpeg(f: File, _rotation: number): Promise<ArrayBuffer> {
  if (/\.jpe?g$/i.test(f.name)) return f.arrayBuffer();
  throw new Error('PDF 시험은 아직 지원하지 않습니다. jpg를 고르세요');
}
