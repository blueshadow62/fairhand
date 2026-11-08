import type { ProgressEvent, RunResult, SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl, thumbUrl } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { toItems } from '../lib/review-filter.js';
import type { AnswerKey, MaskRect, Transcript, UploadRecord } from '../../core/types.js';
import { byNaturalName, canvasToJpeg, DPI_SCALE, openSheetSource, pdfPageJpeg, type Rotation, type SheetSource } from '../pdf-pages.js';
import { attachRectDrag } from '../lib/rect-drag.js';
import { parsePageSpec, tag } from '../lib/screen-utils.js';
import { costUsd, priceOf } from '../../shared/prices.js';
import { badgeLabel, isSubscription, kindKey, modelLabel } from '../lib/badge.js';
import { pendingPages } from '../lib/sheets.js';
import { showSettingsTab } from './settings.js';

// 지금 쓰는 답안지 양식에서 이름 칸이 들어오는 자리(3학년·2학년 스캔으로 확인). 다른 양식은 미리보기에서 다시 잡는다
const DEFAULT_MASK: MaskRect = { x: 0.74, y: 0.07, w: 0.26, h: 0.05 };
const BATCH = 10; // 한 번에 너무 큰 IPC 전송을 피한다
const THUMB_W = 320; // 격자 칸(130~200px)의 두 배면 또렷하다. 원본(1650px)을 그대로 보이면 장당 디코드 60ms가 쌓여 화면이 끊긴다
function shrink(c: HTMLCanvasElement, w: number): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = w; s.height = Math.round(c.height * w / c.width);
  s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
  return s;
}

/** 한 장 시험 결과 표(저장하지 않음) */
function transcriptTable(key: AnswerKey, tr: Transcript): HTMLElement {
  const box = el('div', {}, el('h3', {}, t('run.try.result')),
    el('div', {}, t('run.try.student', { grade: tr.학년 ?? '?', cls: tr.반 ?? '?', no: tr.번호 ?? '?', name: tr.이름 ?? '-', conf: t(`hwaksin.${tr.식별확신}`) })));
  box.append(el('table', {}, el('tr', {}, el('th', {}, t('run.try.col.unit')), el('th', {}, t('run.try.col.answer')), el('th', {}, t('run.try.col.student')), el('th', {}, t('run.try.col.verdict'))),
    ...key.정량.map(u => { const v = tr.정량[u.id]; const p = v?.판정 ?? '빈칸'; return el('tr', {}, el('td', {}, u.id), el('td', {}, u.정답), el('td', {}, v?.답 ?? ''), el('td', { class: `v-${p}` }, t(`verdict.${p}`))); }),
    ...key.정성.map(u => { const v = tr.정성[u.id]; return el('tr', {}, el('td', {}, u.id), el('td', {}, u.설명), el('td', {}, v?.답 ?? ''), el('td', {}, v?.응답 ? t('run.try.responded') : t('run.try.noResponse'))); })));
  if (tr.비고.length) box.append(el('div', { class: 'band warn' }, t('run.try.remarks', { notes: tr.비고.join(' / ') })));
  return box;
}

/** jpg는 그대로, PDF는 첫 장을 기본 회전으로 그려 JPEG로 */
async function fileToJpeg(f: File, rotation: Rotation): Promise<ArrayBuffer> {
  if (/\.jpe?g$/i.test(f.name)) return f.arrayBuffer();
  return pdfPageJpeg(f, 1, rotation);
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  let shownFor: string | null | undefined;
  let data: SetData | null = null;
  interface Picked { src: SheetSource; 지문: string; 크기: number; 이전: UploadRecord | null; 포함: boolean }
  let picked: Picked[] = []; // 올린 파일들(이름순). 한 번에 이어서 쪽으로 나눈다. 이미 올린 파일은 기본으로 빼 둔다
  const included = () => picked.filter(p => p.포함);
  const totalPages = () => included().reduce((n, p) => n + p.src.pageCount, 0);
  let rotation: Rotation = store.state.settings.기본회전;
  let running = false;
  let saving = false; // 장 저장 중에는 회전·포함 체크·저장 버튼을 잠근다(같은 파일 이중 저장, 각도 섞임 방지)
  let selected = new Set<number>(); // 한꺼번에 지우려고 고른 장
  let lastPick: number | null = null; // Shift+클릭 범위의 시작 장
  let deleting = false;

  const body = el('div');
  root.append(el('h2', {}, t('run.title')), el('div', { class: 'band info' }, t('run.notice')), body);

  const countBox = el('div', { class: 'row' });
  const preview = el('canvas', { class: 'preview' });
  const uploadBox = el('div');
  const thumbsTitle = el('h3');
  const thumbsBox = el('div');
  const runBox = el('div');
  const resultBox = el('div');
  const privacyBox = el('div');
  const maskCanvas = el('canvas', { class: 'preview' });
  let maskImage: HTMLImageElement | null = null;
  let maskPage: number | null = null;
  let dragRect: MaskRect | null = null; // 끄는 중인 영역(놓으면 저장)

  async function reload(): Promise<void> {
    const 폴더 = store.state.current;
    if (shownFor !== 폴더) clear(tryBox); // 시험 결과는 그 세트의 정답표로 그린 것이다
    shownFor = 폴더;
    clear(body);
    for (const p of picked) p.src.close(); picked = []; fileInput.value = ''; // 고른 파일은 고른 때의 세트 기준이라 세트가 바뀌면 버린다
    selected = new Set(); lastPick = null; // 장 번호는 세트마다 겹치므로 고른 장도 버린다
    if (!폴더) { data = null; body.append(el('div', { class: 'muted' }, t('common.chooseSet'))); return; }
    let d: SetData;
    try { d = await api.readSet(폴더); } catch (e) { showError((e as Error).message); return; }
    if (shownFor !== 폴더) return; // 기다리는 사이 다른 세트로 바뀌었으면 늦게 온 응답은 버린다
    data = d;
    renderCounts();
    body.append(el('h3', {}, t('common.set', { name: 폴더 })), countBox,
      el('div', { class: 'card' }, el('h3', {}, t('run.upload')), uploadBox),
      el('div', { class: 'card' }, thumbsTitle, thumbsBox),
      el('div', { class: 'card' }, el('h3', {}, t('run.privacy')), privacyBox),
      // 전체를 전사하기 전에 시험하는 일이라 학생 정보 보호(이름 가림이 시험에도 쓰인다) 다음, 전사 앞에 둔다
      el('div', { class: 'card' }, el('h3', {}, t('run.try.title')), el('div', { class: 'muted' }, t('run.try.help')), el('div', { class: 'row' }, tryInput), tryBox),
      el('div', { class: 'card' }, el('h3', {}, t('run.transcribe')), runBox), resultBox);
    renderUpload(); renderThumbs(); renderPrivacy(); renderRun();
  }

  function renderCounts(): void {
    clear(countBox);
    if (!data) return;
    const dups = toItems(data.transcripts).filter(i => i.중복).map(i => i.page);
    put(countBox, t('run.counts', { pages: data.pages.length, transcripts: data.transcripts.length }),
      data.key.확인?.완료 ? null : el('span', { class: 'band error' }, t('common.notConfirmed')),
      dups.length ? el('span', { class: 'band warn' }, t('run.dupStudents', { list: dups.map(tag).join(', ') })) : null,
      dups.length ? el('button', { onclick: () => ctx.goTo('review') }, t('run.goReview')) : null);
  }

  // ── PDF 올리기 ──
  const fileInput = el('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.bmp', multiple: true });
  fileInput.addEventListener('change', () => void pickFiles());
  const uploadStatus = el('div', { class: 'muted' });

  async function pickFiles(): Promise<void> {
    const files = [...(fileInput.files ?? [])].sort(byNaturalName); // 스캐너 파일명(001, 002…) 순서대로
    if (!files.length) return;
    for (const p of picked) p.src.close();
    picked = [];
    for (const f of files) {
      try {
        const bytes = await f.arrayBuffer(); // 지문과 열기가 같은 버퍼를 쓴다(큰 스캔을 두 번 읽지 않게)
        const 지문 = await sha256(bytes);
        const 이전 = data?.올린파일.find(u => u.지문 === 지문) ?? null;
        picked.push({ src: await openSheetSource(f, bytes), 지문, 크기: f.size, 이전, 포함: !이전 });
      } catch (e) { showError(t('run.openFailed', { name: f.name, error: (e as Error).message })); }
    }
    rotation = store.state.settings.기본회전;
    renderUpload(); await drawPreview();
  }

  async function sha256(bytes: ArrayBuffer): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function drawPreview(): Promise<void> {
    const first = (included()[0] ?? picked[0])?.src;
    if (!first) return;
    const c = await first.render(1, rotation, 0.4);
    preview.width = c.width; preview.height = c.height;
    preview.getContext('2d')!.drawImage(c, 0, 0);
  }

  async function savePages(): Promise<void> {
    if (!data) return;
    if (!included().length) { showError(t('run.noneSelected')); return; }
    const 폴더 = data.폴더, total = totalPages();
    const made: number[] = [];
    saving = true; saveBtn.disabled = true;
    try {
      // 파일 순서대로, 파일 안에서는 쪽 순서대로 하나의 번호 흐름으로 이어 붙인다
      let jpegs: ArrayBuffer[] = [], thumbs: ArrayBuffer[] = [], n = 0;
      const flush = async () => { if (jpegs.length) { made.push(...await api.addPages(폴더, jpegs, thumbs)); jpegs = []; thumbs = []; uploadStatus.textContent = t('run.savedCount', { n: made.length, total }); } };
      for (const { src, 지문, 크기 } of included()) {
        const before = made.length;
        for (let p = 1; p <= src.pageCount; p++) {
          n++;
          const c = await src.render(p, rotation, DPI_SCALE);
          jpegs.push(await canvasToJpeg(c));
          thumbs.push(await canvasToJpeg(shrink(c, THUMB_W), 0.75));
          c.width = c.height = 0; // 200dpi 캔버스(장당 수십 MB)를 GC를 기다리지 않고 비운다
          uploadStatus.textContent = t('run.rendering', { n, total });
          if (jpegs.length >= BATCH) await flush();
        }
        await flush(); // 파일 끝마다 비워 이 파일이 받은 장 범위를 기록한다
        await api.recordUpload(폴더, { 이름: src.name, 크기, 지문, 장수: src.pageCount, 시작: made[before]!, 끝: made[made.length - 1]! });
      }
      showInfo(t('run.pagesSaved', { from: tag(made[0]!), to: tag(made[made.length - 1]!) }));
      for (const p of picked) p.src.close(); picked = []; fileInput.value = '';
      await refresh();
    } catch (e) { showError((e as Error).message); }
    finally { saving = false; saveBtn.disabled = !included().length; }
  }
  const saveBtn = el('button', { class: 'primary', onclick: () => void savePages() }, t('run.splitSave'));

  function renderUpload(): void {
    clear(uploadBox);
    uploadBox.append(el('div', { class: 'row' }, fileInput), uploadStatus);
    if (!picked.length || !data) return;
    const next = data.pages.length ? Math.max(...data.pages) + 1 : 1;
    put(uploadBox,
      el('div', {}, ...picked.map(p => el('div', { class: 'row' },
        p.이전
          ? el('label', {}, el('input', { type: 'checkbox', checked: p.포함, onchange: (e: Event) => { if (saving) { renderUpload(); return; } p.포함 = (e.target as HTMLInputElement).checked; renderUpload(); void drawPreview(); } }), t('run.fileLine', { name: p.src.name, n: p.src.pageCount }))
          : el('span', { class: 'muted' }, t('run.fileLine', { name: p.src.name, n: p.src.pageCount })),
        p.이전 ? el('span', { class: 'band warn' }, t('run.dupFile', { date: p.이전.일시.slice(0, 10), from: tag(p.이전.시작), to: tag(p.이전.끝) })) : null))),
      el('div', { class: 'row' }, t('run.filesRotation', { files: included().length, n: totalPages() }), ...([0, 90, 180, 270] as Rotation[]).map(r =>
        el('button', { class: r === rotation ? 'primary' : '', disabled: saving, onclick: () => { if (saving) return; rotation = r; renderUpload(); void drawPreview(); } }, `${r}°`)),
        el('span', { class: 'muted' }, t('run.rotationHelp'))),
      preview,
      data.pages.length ? el('div', { class: 'band warn' }, t('run.alreadyPages', { n: data.pages.length, next: tag(next) })) : null,
      el('div', { class: 'row' }, saveBtn));
    saveBtn.disabled = saving || !included().length;
  }

  // ── 저장된 장 미리보기·삭제 ──
  async function refresh(): Promise<void> {
    if (!data) return;
    data = await api.readSet(data.폴더);
    renderCounts(); renderUpload(); renderThumbs(); renderPrivacy(); renderRun(); await store.refreshSets();
  }

  const picks = new Map<number, { fig: HTMLElement; box: HTMLInputElement }>();
  const pickAll = el('input', { type: 'checkbox', onchange: () => { selected = new Set(pickAll.checked && data ? data.pages : []); lastPick = null; syncPicks(); } });
  const pickCount = el('span', { class: 'muted' });
  const deleteSel = el('button', { class: 'danger', onclick: () => void deleteSelected() });

  function renderThumbs(): void {
    clear(thumbsBox); picks.clear();
    if (!data) return;
    thumbsTitle.textContent = t('run.savedPages', { n: data.pages.length });
    if (!data.pages.length) { thumbsBox.append(el('div', { class: 'muted' }, t('run.noPages'))); syncPicks(); return; }
    thumbsBox.append(
      el('div', { class: 'row' }, el('label', {}, pickAll, t('run.pickAll')), pickCount, deleteSel),
      el('div', { class: 'thumbs' }, ...data.pages.map(p => {
        const tr = data!.transcripts.find(x => x.page === p);
        const who = !tr ? t('run.untranscribed') : tr.이름 ?? (tr.반 !== null && tr.번호 !== null ? `${tr.반}-${tr.번호}` : t('run.unidentified'));
        // change 이벤트에는 Shift 여부가 없어 click을 쓴다. click 때는 이미 체크가 바뀌어 있다
        const box = el('input', { type: 'checkbox', 'aria-label': t('run.pickPage', { page: tag(p) }), onclick: (e: Event) => pick(p, box.checked, (e as MouseEvent).shiftKey) });
        const fig = el('figure', { class: 'thumb', title: t('run.pickHint') },
          el('label', { class: 'pick' }, box),
          el('img', { src: thumbUrl(data!.폴더, p), loading: 'lazy', decoding: 'async', alt: tag(p),
            onclick: (e: Event) => pick(p, !selected.has(p), (e as MouseEvent).shiftKey),
            onerror: (e: Event) => { const i = e.target as HTMLImageElement; if (i.src !== imageUrl(data!.폴더, p)) i.src = imageUrl(data!.폴더, p); } }), // 작은 그림이 없는 옛 세트는 원본으로
          el('figcaption', {}, el('span', { title: who }, `${tag(p)} · ${who}`),
            el('button', { class: 'danger', disabled: running, title: t('common.delete'), onclick: () => void deletePage(p) }, '×')));
        picks.set(p, { fig, box });
        return fig;
      })));
    syncPicks();
  }

  /** 고른 상태는 그림을 다시 만드는 대신 체크·테두리·버튼에만 반영한다(그림을 다시 만들면 깜박인다) */
  function syncPicks(): void {
    const pages = data?.pages ?? [];
    selected = new Set(pages.filter(p => selected.has(p))); // 이미 지워진 장은 뺀다
    for (const [p, { fig, box }] of picks) { const on = selected.has(p); box.checked = on; fig.classList.toggle('picked', on); }
    const n = selected.size;
    pickAll.checked = n > 0 && n === pages.length;
    pickAll.indeterminate = n > 0 && n < pages.length;
    pickCount.textContent = n ? t('run.pickedCount', { n }) : '';
    deleteSel.textContent = deleting ? t('run.deleting') : t('run.deleteSelected', { n });
    deleteSel.disabled = running || deleting || !n;
  }

  function pick(p: number, on: boolean, range: boolean): void {
    const pages = data?.pages ?? [];
    const from = lastPick === null ? -1 : pages.indexOf(lastPick);
    const to = pages.indexOf(p);
    const span = range && from >= 0 ? pages.slice(Math.min(from, to), Math.max(from, to) + 1) : [p];
    for (const q of span) if (on) selected.add(q); else selected.delete(q);
    lastPick = p;
    syncPicks();
  }

  async function deleteSelected(): Promise<void> {
    if (!data || running || !selected.size) return;
    const pages = data.pages.filter(p => selected.has(p));
    if (!confirm(t('run.deleteManyConfirm', { n: pages.length }))) return;
    deleting = true; syncPicks(); // 엑셀을 다시 만드는 몇 초 동안 두 번 누르지 않게
    try {
      const r = await api.deletePages(data.폴더, pages);
      selected = new Set(); lastPick = null;
      if (r.엑셀오류) showError(t('common.excelFailed', { error: r.엑셀오류 })); else showInfo(t('run.deletedMany', { n: r.삭제 }));
    } catch (e) { showError((e as Error).message); }
    deleting = false;
    try { await refresh(); } catch (e) { showError((e as Error).message); syncPicks(); }
  }

  async function deletePage(p: number): Promise<void> {
    if (!data || !confirm(t('run.deleteConfirm', { page: tag(p) }))) return;
    try {
      const r = await api.deletePage(data.폴더, p);
      if (r.엑셀오류) showError(t('common.excelFailed', { error: r.엑셀오류 })); else showInfo(t('run.deleted', { page: tag(p) }));
      await refresh();
    } catch (e) { showError((e as Error).message); }
  }

  // ── 학생 정보 보호: 이름 칸 가리기·명단 대조 ──
  function drawMask(): void {
    if (!maskImage?.naturalWidth) return;
    const scale = 0.5;
    maskCanvas.width = Math.round(maskImage.naturalWidth * scale); maskCanvas.height = Math.round(maskImage.naturalHeight * scale);
    const g = maskCanvas.getContext('2d')!;
    g.drawImage(maskImage, 0, 0, maskCanvas.width, maskCanvas.height);
    const r = dragRect ?? data?.key.이름가림;
    if (!r) return;
    const box = [r.x * maskCanvas.width, r.y * maskCanvas.height, r.w * maskCanvas.width, r.h * maskCanvas.height] as const;
    g.fillStyle = '#fff'; g.fillRect(...box);
    g.strokeStyle = '#d33'; g.lineWidth = 2; g.strokeRect(...box);
  }

  function showMaskPage(page: number): void {
    if (!data) return;
    maskPage = page;
    const img = new Image();
    img.onload = () => { if (maskPage === page) { maskImage = img; drawMask(); } };
    img.src = imageUrl(data.폴더, page);
  }

  async function saveMask(rect: MaskRect | null): Promise<void> {
    if (!data) return;
    try { data.key = await api.setNameMask(data.폴더, rect); }
    catch (e) { showError((e as Error).message); }
    dragRect = null; renderPrivacy();
  }

  attachRectDrag(maskCanvas, {
    enabled: () => !running && !!data?.key.이름가림,
    onMove: r => { dragRect = r; drawMask(); },
    onDone: r => { if (r) void saveMask(r); else { dragRect = null; drawMask(); } },
  });

  async function matchWithRoster(): Promise<void> {
    if (!data) return;
    try {
      const r = await api.matchRoster(data.폴더);
      if (r.엑셀오류) showError(t('common.excelFailed', { error: r.엑셀오류 }));
      else showInfo(r.바뀐장.length ? t('run.matchDone', { n: r.바뀐장.length }) : t('run.matchNone'));
      clear(resultBox);
      if (r.바뀐장.length) resultBox.append(el('div', { class: 'card' }, el('h3', {}, t('run.matchRoster')),
        el('table', {}, ...r.바뀐장.map(b => el('tr', {}, el('td', {}, tag(b.page)), el('td', {}, b.변경.join('; '))))),
        el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => ctx.goTo('review') }, t('run.goReview')))));
      await refresh();
    } catch (e) { showError((e as Error).message); }
  }

  function renderPrivacy(): void {
    clear(privacyBox);
    if (!data) return;
    const on = !!data.key.이름가림;
    put(privacyBox,
      el('div', { class: 'row' }, el('label', {}, el('input', { type: 'checkbox', checked: on, disabled: running,
        onchange: (e: Event) => void saveMask((e.target as HTMLInputElement).checked ? DEFAULT_MASK : null) }), t('run.maskToggle'))),
      el('div', { class: 'muted' }, t('run.maskHelp')));
    if (on) {
      put(privacyBox, el('div', { class: 'band warn' }, t('run.maskLimit')), data.명단있음 ? null : el('div', { class: 'band warn' }, t('run.maskNoRoster')));
      if (!data.pages.length) put(privacyBox, el('div', { class: 'muted' }, t('run.maskNoPages')));
      else {
        if (maskPage === null || !data.pages.includes(maskPage)) maskPage = data.pages[0]!;
        const picker = el('select', { onchange: () => showMaskPage(Number(picker.value)) }, ...data.pages.map(p => el('option', { value: String(p), selected: p === maskPage }, tag(p))));
        put(privacyBox, el('div', { class: 'row' }, t('run.maskPage'), picker,
          el('button', { disabled: running, onclick: () => void saveMask(DEFAULT_MASK) }, t('run.maskReset'))), maskCanvas);
        showMaskPage(maskPage);
      }
    }
    put(privacyBox,
      el('div', { class: 'row' }, el('button', { disabled: running || !data.명단있음 || !data.transcripts.length, onclick: () => void matchWithRoster() }, t('run.matchRoster')),
        data.명단있음 ? null : el('span', { class: 'muted' }, t('run.matchNeedRoster'))),
      el('div', { class: 'muted' }, t('run.matchHelp')));
  }

  // ── 한 장 채점해 보기: 메인은 모델 부르는 일을 한 번에 하나만 하므로 시험하는 동안 전사 단추도 잠근다 ──
  let trying = false;
  const tryInput = el('input', { type: 'file', accept: '.jpg,.jpeg,.pdf' });
  tryInput.addEventListener('change', () => void tryOne());
  const tryBox = el('div');
  async function tryOne(): Promise<void> {
    const f = tryInput.files?.[0]; tryInput.value = '';
    if (!f || !data || running || trying) return;
    const { 폴더, key } = data; // 기다리는 사이 세트가 바뀌어도 이 정답표로 그린다
    trying = true; renderRun();
    clear(tryBox); tryBox.append(el('div', { class: 'muted' }, t('run.try.running')));
    try {
      const tr = await api.tryPage(폴더, await fileToJpeg(f, store.state.settings.기본회전));
      clear(tryBox); tryBox.append(transcriptTable(key, tr));
    } catch (e) { clear(tryBox); showError((e as Error).message); }
    finally { trying = false; renderRun(); }
  }

  // ── 전사 ──
  const progressBar = el('progress', { max: '1', value: '0' });
  const progressText = el('span');
  const pagesInput = el('input', { size: 10, placeholder: t('common.pagesPlaceholder') });
  let redoOpen = false;

  async function run(opts: { pages?: number[]; force?: boolean }): Promise<void> {
    if (!data || running) return;
    const 폴더 = data.폴더;
    const profile = store.state.settings.프로필.find(p => p.id === store.state.settings.사용중);
    const price = priceOf(profile); // 실제 청구와 다를 수 있는 추정. 구독과 단가를 모르는 API는 보이지 않는다
    running = true; renderRun(); renderThumbs(); renderPrivacy(); clear(resultBox);
    const started = Date.now();
    let inTok = 0, outTok = 0, done = 0, total = opts.pages?.length ?? data.pages.length;
    const tick = () => {
      const sec = Math.round((Date.now() - started) / 1000);
      const cost = price ? t('run.costEstimate', { cost: costUsd(price, inTok, outTok).toFixed(2) }) : '';
      progressText.textContent = t('run.progress', { done, total, sec, in: inTok, out: outTok, cost });
      progressBar.max = Math.max(total, 1); progressBar.value = done;
    };
    const timer = setInterval(tick, 1000);
    const off = api.onProgress((e: ProgressEvent) => { done = e.done; total = e.total; inTok += e.inputTokens ?? 0; outTok += e.outputTokens ?? 0; tick(); });
    tick();
    try {
      showResult(await api.startRun(폴더, opts));
    } catch (e) { showError((e as Error).message); }
    finally {
      clearInterval(timer); off(); tick(); running = false;
      // 전사할 장 수와 장 그림의 학생 표시가 이번 전사를 반영하게 새로 읽은 뒤 그린다
      if (store.state.current === 폴더) data = await api.readSet(폴더).catch(() => data);
      renderCounts(); renderRun(); renderThumbs(); renderPrivacy();
      await store.refreshSets().catch(() => undefined);
    }
  }

  function showResult(r: RunResult): void {
    clear(resultBox);
    const box = el('div', { class: 'card' }, el('h3', {}, t('run.result')),
      el('div', {}, t('run.summary', { ok: r.ok.length, failed: r.failed.length, skipped: r.skipped.length })));
    if (r.failed.length) box.append(el('table', {}, el('tr', {}, el('th', {}, t('run.col.page')), el('th', {}, t('run.col.error'))), ...r.failed.map(f => el('tr', {}, el('td', {}, tag(f.page)), el('td', {}, f.error)))));
    if (r.엑셀) box.append(el('div', { class: 'row' }, t('run.excel'), el('span', { class: 'path' }, r.엑셀), el('button', { onclick: () => api.revealPath(r.엑셀!).catch(e => showError(e.message)) }, t('common.reveal'))));
    if (r.엑셀오류) box.append(el('div', { class: 'band warn' }, t('common.excelFailed', { error: r.엑셀오류 })));
    box.append(el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => ctx.goTo('review') }, t('run.goReview'))));
    resultBox.append(box);
  }

  /** 전사에 쓸 AI(이름·종류·모델, 구독인지 API인지). 어느 프로필로 도는지가 왼쪽 아래 작은 글에만 있었다 */
  function aiLine(): HTMLElement {
    const s = store.state.settings;
    const p = s.프로필.find(x => x.id === s.사용중);
    // 채점 실행에는 떠나기 확인이 없어 goTo가 설정 화면을 바로(동기) 그린다. 그다음 AI 프로필 탭을 고른다
    const open = el('button', { class: 'small', onclick: () => { ctx.goTo('settings'); showSettingsTab('ai'); } }, t('run.ai.settings'));
    if (!p) return el('div', { class: 'row' }, el('span', { class: 'band warn' }, t('run.ai.none')), open);
    const sub = isSubscription(p.종류);
    return el('div', {},
      el('div', { class: 'row' }, el('span', { class: 'muted' }, t('run.ai')),
        el('strong', {}, badgeLabel(p.이름, t(kindKey(p.종류)), modelLabel(p, t('app.badge.codexDefault')))),
        el('span', { class: `band ${sub ? 'info' : 'warn'}` }, t(sub ? 'run.ai.subscription' : 'run.ai.api')), open),
      el('div', { class: 'muted' }, t(sub ? 'run.ai.subscriptionHelp' : priceOf(p) ? 'run.ai.apiHelp' : 'run.ai.apiNoPrice')));
  }

  function renderRun(): void {
    clear(runBox);
    if (!data) return;
    const confirmed = data.key.확인?.완료 === true;
    tryInput.disabled = running || trying || !confirmed;
    const pending = pendingPages(data.pages, data.transcripts).length;
    put(runBox,
      el('div', { class: 'run-ai' }, aiLine(), el('div', {}, t('run.pending', { n: pending, done: data.pages.length - pending }))),
      el('div', { class: 'row' },
        el('button', { class: 'primary', disabled: running || trying || !confirmed || !data.pages.length, onclick: () => void run({ force: false }) }, t('run.start')),
        el('button', { class: 'danger', disabled: !running, onclick: () => api.cancelRun().catch(e => showError(e.message)) }, t('run.cancel')),
        progressBar, progressText),
      el('div', { class: 'muted' }, t('run.startHelp')),
      // 처음 쓰는 사람에게는 '전사 시작' 하나면 되어 다시 전사할 장은 접어 둔다. 전사 칸을 다시 그려도 사용자가 연 상태는 그대로
      el('details', { class: 'advanced', open: redoOpen, ontoggle: (e: Event) => { redoOpen = (e.target as HTMLDetailsElement).open; } },
        el('summary', {}, t('run.advanced'), el('span', { class: 'muted' }, t('run.advancedHint'))),
        el('div', { class: 'row' }, t('run.redoPages'), pagesInput,
          el('button', { disabled: running || trying || !confirmed, onclick: () => {
            const pages = parsePageSpec(pagesInput.value);
            if (!pages) { showError(t('common.badPageSpec')); return; }
            const missing = pages.filter(p => !data!.pages.includes(p));
            if (missing.length) { showError(t('run.missingPages', { pages: missing.map(tag).join(', ') })); return; }
            if (!confirm(t('run.redoConfirm', { pages: pages.map(tag).join(', ') }))) return;
            void run({ pages, force: true });
          } }, t('run.redo')))),
      confirmed ? null : el('div', { class: 'band error' }, t('run.notConfirmedLong')));
  }

  store.subscribe(s => { if (s.current !== shownFor && !running) void reload(); });
  // 다른 탭에서 확인 표시·전사가 바뀌었을 수 있어, 탭이 다시 보일 때 새로 읽는다
  new MutationObserver(() => { if (!root.classList.contains('hidden') && !running) void reload(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  void reload();
}
