import type { ProgressEvent, RunResult, SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api, imageUrl, thumbUrl } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { toItems } from '../lib/review-filter.js';
import type { AnswerKey, MaskRect, Transcript, UploadRecord } from '../../core/types.js';
import { canvasToJpeg, DPI_SCALE, openSheetSource, pdfPageJpeg, type Rotation, type SheetSource } from '../pdf-pages.js';
import { attachRectDrag } from '../lib/rect-drag.js';
import { parsePageSpec, tag } from '../lib/screen-utils.js';
import { costUsd, priceOf } from '../../shared/prices.js';
import { badgeLabel, isSubscription, kindKey, modelLabel } from '../lib/badge.js';
import { appendFiles, coversSaved, dropSlot, hasFile, moveBefore, nextRotation, pendingPages, saveRanges, SHEET_ACCEPT, sheetKind, sortByName } from '../lib/sheets.js';
import { showSettingsTab } from './settings.js';

// 지금 쓰는 답안지 양식에서 이름 칸이 들어오는 자리(3학년·2학년 스캔으로 확인). 다른 양식은 미리보기에서 다시 잡는다
const DEFAULT_MASK: MaskRect = { x: 0.74, y: 0.07, w: 0.26, h: 0.05 };
const BATCH = 10; // 한 번에 너무 큰 IPC 전송을 피한다
const THUMB_W = 320; // 격자 칸(130~200px)의 두 배면 또렷하다. 원본(1650px)을 그대로 보이면 장당 디코드 60ms가 쌓여 화면이 끊긴다
const PREVIEW_SCALE = 0.35; // 저장 전 미리보기(칸 120~150px). A4 한 쪽이 200px 남짓이라 1.5배 화면에서도 읽힌다
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
  /** 저장 전 미리보기의 한 쪽. 그림은 화면에 들어올 때 한 번만 작게 그려 두고, 돌린 각도는 CSS로 보인다(다시 그리지 않음) */
  interface SheetTile { pk: Picked; page: number; fig: HTMLElement; img: HTMLImageElement; tag: HTMLElement; angle: HTMLElement; btn: HTMLButtonElement; url: string | null; state: 'idle' | 'queued' | 'drawn' | 'failed'; visible: boolean }
  /** 회전: 쪽마다(0부터) 저장할 때 돌릴 각도. closed: 닫은 파일(그리던 그림은 버린다) */
  interface Picked { src: SheetSource; 이름: string; 지문: string; 크기: number; 이전: UploadRecord | null; 포함: boolean; 회전: Rotation[]; tiles: SheetTile[]; closed: boolean }
  let picked: Picked[] = []; // 고른 파일들(이름순). 이 차례로 이어서 쪽으로 나눈다. 이미 올린 파일은 기본으로 빼 둔다
  const included = () => picked.filter(p => p.포함);
  const totalPages = () => included().reduce((n, p) => n + p.src.pageCount, 0);
  let rotation: Rotation = store.state.settings.기본회전; // 모든 쪽에 마지막으로 적용한 각도. 이와 다른 쪽은 따로 돌린 쪽이다
  let running = false;
  let saving = false; // 장 저장 중에는 회전·포함 체크·저장 버튼을 잠근다(같은 파일 이중 저장, 각도 섞임 방지)
  let selected = new Set<number>(); // 한꺼번에 지우려고 고른 장
  let lastPick: number | null = null; // Shift+클릭 범위의 시작 장
  let deleting = false;

  const body = el('div');
  root.append(el('h2', {}, t('run.title')), el('div', { class: 'band info' }, t('run.notice')), body);

  const countBox = el('div', { class: 'row' });
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
    if (shownFor !== 폴더) {
      clear(tryBox); // 시험 결과는 그 세트의 정답표로 그린 것이다
      // 고른 파일은 고른 때의 세트 기준이라 세트가 바뀌면 버린다. 같은 세트면(설정을 보고 돌아옴) 쪽마다 돌린 각도와 함께 둔다
      dropPicked(); fileInput.value = ''; uploadStatus.textContent = ''; justSaved = [];
    }
    shownFor = 폴더;
    clear(body);
    selected = new Set(); lastPick = null; // 장 번호는 세트마다 겹치므로 고른 장도 버린다
    if (!폴더) { data = null; body.append(el('div', { class: 'muted' }, t('common.chooseSet'))); return; }
    let d: SetData;
    try { d = await api.readSet(폴더); } catch (e) { showError((e as Error).message); return; }
    if (shownFor !== 폴더) return; // 기다리는 사이 다른 세트로 바뀌었으면 늦게 온 응답은 버린다
    data = d;
    renderCounts();
    body.append(el('h3', {}, t('common.set', { name: 폴더 })), countBox,
      uploadCard,
      el('div', { class: 'card' }, thumbsTitle, thumbsBox),
      el('div', { class: 'card' }, el('h3', {}, t('run.privacy')), privacyBox),
      // 전체를 전사하기 전에 시험하는 일이라 학생 정보 보호(이름 가림이 시험에도 쓰인다) 다음, 전사 앞에 둔다
      el('div', { class: 'card' }, el('h3', {}, t('run.try.title')), el('div', { class: 'muted' }, t('run.try.help')), el('div', { class: 'row' }, tryInput), tryBox),
      runCard, resultBox);
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

  // ── PDF 올리기: 고른 파일은 목록에 더한다(여러 번 나눠 고르거나 끌어다 놓아도). 목록은 파일 이름 순서이고 그 차례로 쪽이 저장된다 ──
  // 브라우저 기본 '파일 선택' 칸은 앞서 고른 파일 이름 하나만 보여 더하기와 맞지 않는다. 숨겨 두고 앱 모양 단추로 연다
  const fileInput = el('input', { type: 'file', accept: SHEET_ACCEPT, multiple: true, class: 'hidden' });
  const pickBtn = el('button', { onclick: () => { if (!saving) fileInput.click(); } });
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = ''; // 뺀 파일을 다시 골라도 change가 오게
    void addFiles(files);
  });
  const uploadStatus = el('div', { class: 'muted' });
  const moveNote = el('div', { class: 'sr-only', 'aria-live': 'polite' }); // 칩을 옮긴 자리를 화면 읽기 프로그램에 알린다
  const uploadCard = el('div', { class: 'card upload-card' }, el('h3', {}, t('run.upload')), uploadBox, moveNote);
  const runCard = el('div', { class: 'card' }, el('h3', {}, t('run.transcribe')), runBox);
  let justSaved: number[] = []; // 마지막으로 저장한 장. 저장한 자리에서 바로 전사하게 한다
  let listGen = 0; // 목록을 비우면(모두 빼기·저장·세트 바뀜) 늘린다. 그 전에 시작한 더하기는 목록에 넣지 않는다
  let adding: Promise<void> = Promise.resolve(); // 앞의 파일을 여는 동안 또 고르거나 놓아도 차례로 더한다

  function addFiles(files: File[]): Promise<void> {
    adding = adding.then(() => addNow(files), () => addNow(files));
    return adding;
  }

  async function addNow(files: File[]): Promise<void> {
    if (!files.length || !data) return;
    if (saving) { showError(t('run.busySaving')); return; } // 저장 중에는 고르기 단추도 잠근다
    const gen = listGen;
    uploadStatus.textContent = ''; justSaved = []; // 지난 저장의 '3/3장 저장'이 새로 고른 파일의 상태처럼 보였다
    const dup: string[] = [], fresh: Picked[] = [];
    const stop = () => fresh.forEach(closePicked); // 그사이 목록을 비웠으면 이번에 연 파일도 닫는다
    for (const f of files) {
      try {
        const bytes = await f.arrayBuffer(); // 지문과 열기가 같은 버퍼를 쓴다(큰 스캔을 두 번 읽지 않게)
        const 지문 = await sha256(bytes);
        if (gen !== listGen) { stop(); return; }
        if (hasFile(picked, 지문) || hasFile(fresh, 지문)) { dup.push(f.name); continue; }
        const src = await openSheetSource(f, bytes);
        if (gen !== listGen) { src.close(); stop(); return; }
        const 이전 = data?.올린파일.find(u => u.지문 === 지문) ?? null;
        const pk: Picked = { src, 이름: f.name, 지문, 크기: f.size, 이전, 포함: !이전, 회전: Array<Rotation>(src.pageCount).fill(rotation), tiles: [], closed: false };
        pk.tiles = Array.from({ length: src.pageCount }, (_, i) => makeTile(pk, i + 1));
        fresh.push(pk);
      } catch (e) {
        if (gen !== listGen) { stop(); return; }
        showError(t('run.openFailed', { name: f.name, error: (e as Error).message }));
      }
    }
    picked = appendFiles(picked, fresh); // 손으로 바꾼 순서가 풀리지 않게 새 파일은 맨 뒤에
    if (dup.length) showInfo(t('run.dupPicked', { names: dup.join(', ') }));
    renderUpload();
  }

  // ── 끌어다 놓기: 탐색기에서 PDF·사진을 이 화면 어디에 놓아도 '파일 선택'과 같게. 놓을 수 있는 동안 올리기 칸을 강조한다 ──
  let dragDepth = 0; // 안쪽 요소를 지날 때마다 dragenter·dragleave가 오가 깊이로 센다
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  const dropping = (on: boolean) => uploadCard.classList.toggle('dropping', on);
  root.addEventListener('dragenter', e => { if (!hasFiles(e) || !data) return; e.preventDefault(); dragDepth++; dropping(true); });
  root.addEventListener('dragover', e => { if (!hasFiles(e) || !data) return; e.preventDefault(); e.dataTransfer!.dropEffect = saving ? 'none' : 'copy'; });
  root.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; dropping(false); } });
  root.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // 놓은 파일을 창이 열려고(다른 주소로 가려고) 하지 않게
    dragDepth = 0; dropping(false);
    if (!data) return;
    if (saving) { showError(t('run.busySaving')); return; }
    const all = [...e.dataTransfer!.files];
    const sheets = all.filter(f => sheetKind(f.name, f.type));
    const skipped = all.filter(f => !sheetKind(f.name, f.type)).map(f => f.name);
    if (skipped.length) showError(t(sheets.length ? 'run.dropSkipped' : 'run.dropNone', { names: skipped.join(', ') }));
    if (!sheets.length) return;
    uploadCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
    void addFiles(sheets); // '파일 선택'으로 고른 것과 똑같이 목록에 더한다
  });

  async function sha256(bytes: ArrayBuffer): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── 저장 전 모든 쪽 미리보기: 첫 장 하나만 보여서 스캐너가 몇 장을 거꾸로 읽어도 저장 전에는 알 수 없었다.
  //    쪽이 수백 장이어도 느리지 않게 격자에 들어온(곧 들어올) 쪽만 하나씩 작게 그리고, 그린 그림은 JPEG 주소로 바꿔 캔버스 메모리를 비운다 ──
  const sheetGrid = el('div', { class: 'sheet-grid' });
  const tileOf = new WeakMap<Element, SheetTile>();
  const queue: SheetTile[] = [];
  let pumping = false;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const tile = tileOf.get(e.target);
      if (!tile) continue;
      tile.visible = e.isIntersecting;
      if (tile.visible && tile.state === 'idle') { tile.state = 'queued'; queue.push(tile); }
    }
    void pump();
  }, { root: sheetGrid, rootMargin: '240px 0px' });

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (let tile = queue.shift(); tile; tile = queue.shift()) {
        if (tile.state !== 'queued' || tile.pk.closed) continue;
        if (!tile.visible) { tile.state = 'idle'; continue; } // 지나쳐 간 쪽은 다시 들어올 때 그린다
        try { await drawTile(tile); }
        catch { if (!tile.pk.closed) { tile.state = 'failed'; tile.fig.classList.add('failed'); tile.img.alt = t('run.previewFailed'); } }
      }
    } finally { pumping = false; }
  }

  async function drawTile(tile: SheetTile): Promise<void> {
    const c = await tile.pk.src.render(tile.page, 0, PREVIEW_SCALE);
    try {
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.8));
      if (tile.pk.closed) return;
      if (!blob) throw new Error(t('pdf.jpegFailed'));
      tile.url = URL.createObjectURL(blob);
      tile.img.src = tile.url;
      tile.state = 'drawn';
      io.unobserve(tile.fig);
    } finally { c.width = c.height = 0; }
  }

  function makeTile(pk: Picked, page: number): SheetTile {
    const img = el('img', { alt: '', decoding: 'async' });
    const tagText = el('span'), angle = el('span', { class: 'angle' });
    const btn = el('button', { class: 'small', onclick: () => { if (saving) return; turn(tile); } }, '↻');
    const fig = el('figure', { class: 'sheet-tile', title: t('run.pageOfFile', { file: pk.src.name, page }) },
      el('div', { class: 'sheet-img' }, img), el('figcaption', {}, tagText, angle, btn));
    const tile: SheetTile = { pk, page, fig, img, tag: tagText, angle, btn, url: null, state: 'idle', visible: false };
    tileOf.set(fig, tile);
    showTurn(tile);
    return tile;
  }

  /** 쪽마다 돌리기: 시계 방향으로 90°씩. 저장할 때 이 각도로 그린다 */
  function turn(tile: SheetTile): void {
    tile.pk.회전[tile.page - 1] = nextRotation(tile.pk.회전[tile.page - 1]!);
    showTurn(tile); renderRotationNote();
  }

  function showTurn(tile: SheetTile): void {
    const r = tile.pk.회전[tile.page - 1]!;
    for (const a of [90, 180, 270]) tile.img.classList.toggle(`r${a}`, r === a);
    const own = r !== rotation; // 모든 쪽에 적용한 각도와 다르게 따로 돌린 쪽
    tile.fig.classList.toggle('turned', own);
    tile.angle.textContent = own ? `${r}°` : '';
  }

  /** 닫은 파일의 미리보기는 그리지 않고, 만든 그림 주소를 돌려준다 */
  function closePicked(pk: Picked): void {
    pk.closed = true; pk.src.close();
    for (const x of pk.tiles) { io.unobserve(x.fig); if (x.url) URL.revokeObjectURL(x.url); }
  }

  /** 목록을 비운다. 다음에 고르는 파일은 처음처럼 기본 회전으로 시작한다 */
  function dropPicked(): void {
    listGen++;
    picked.forEach(closePicked);
    picked = []; queue.length = 0; clear(sheetGrid);
    rotation = store.state.settings.기본회전;
  }

  /** 칩의 x: 그 파일만 빼고 닫는다. 그 사이 다른 파일을 여는 중이어도 그 더하기는 이어진다 */
  function removePicked(pk: Picked): void {
    if (saving) return;
    closePicked(pk);
    picked = picked.filter(x => x !== pk);
    if (!picked.length) { clear(sheetGrid); rotation = store.state.settings.기본회전; }
    renderUpload();
  }

  const rotationNote = el('span', { class: 'band warn' });
  function renderRotationNote(): void {
    const own = included().reduce((n, pk) => n + pk.회전.filter(r => r !== rotation).length, 0);
    rotationNote.textContent = t('run.rotationOwn', { n: own });
    rotationNote.classList.toggle('hidden', !own);
  }

  async function savePages(): Promise<void> {
    if (!data) return;
    if (!included().length) { showError(t('run.noneSelected')); return; }
    const 폴더 = data.폴더, total = totalPages();
    const made: number[] = [];
    saving = true; renderUpload(); // 저장하는 동안 회전·포함 체크·저장 단추를 잠근다
    try {
      // 파일 순서대로, 파일 안에서는 쪽 순서대로 하나의 번호 흐름으로 이어 붙인다
      let jpegs: ArrayBuffer[] = [], thumbs: ArrayBuffer[] = [], n = 0;
      const flush = async () => { if (jpegs.length) { made.push(...await api.addPages(폴더, jpegs, thumbs)); jpegs = []; thumbs = []; uploadStatus.textContent = t('run.savedCount', { n: made.length, total }); } };
      for (const { src, 지문, 크기, 회전 } of included()) {
        const before = made.length;
        for (let p = 1; p <= src.pageCount; p++) {
          n++;
          const c = await src.render(p, 회전[p - 1]!, DPI_SCALE);
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
      justSaved = [...made];
      dropPicked(); fileInput.value = '';
      await refresh();
    } catch (e) { showError((e as Error).message); }
    finally { saving = false; renderUpload(); }
  }
  const saveBtn = el('button', { class: 'primary', onclick: () => void savePages() }, t('run.splitSave'));

  function renderUpload(): void {
    endDrag(); // 끄는 중에 칩을 다시 그리면(더하기가 끝남 등) 끌기를 그만둔다
    clear(uploadBox);
    // 목록이 비었을 때는 처음 할 일이라 강조하고, 파일이 있으면 강조는 '쪽 나누어 저장'에 둔다
    pickBtn.disabled = saving;
    pickBtn.className = picked.length ? '' : 'primary';
    pickBtn.textContent = picked.length ? t('run.addFiles') : t('run.pickFiles');
    uploadBox.append(el('div', { class: 'row' }, pickBtn, fileInput, el('span', { class: 'muted' }, t('run.dropHint'))), uploadStatus);
    const fresh = data ? justSaved.filter(p => data!.pages.includes(p)) : []; // 그사이 지운 장은 뺀다
    if (fresh.length) uploadBox.append(newPagesRow(fresh));
    if (!picked.length || !data) return;
    const next = data.pages.length ? Math.max(...data.pages) + 1 : 1;
    // 격자에는 저장할 파일의 쪽만, 저장될 장 번호 차례로
    const tiles = included().flatMap(pk => pk.tiles);
    tiles.forEach((x, k) => { x.tag.textContent = tag(next + k); x.btn.disabled = saving; x.btn.title = x.btn.ariaLabel = t('run.rotatePage', { page: tag(next + k) }); });
    sheetGrid.replaceChildren(...tiles.map(x => x.fig));
    for (const x of tiles) if (x.state === 'idle' || x.state === 'queued') io.observe(x.fig);
    renderRotationNote();
    const ranges = saveRanges(picked.map(p => ({ 포함: p.포함, 쪽수: p.src.pageCount })), next);
    const byName = sortByName(picked);
    const sortable = picked.length > 1 && !saving; // 하나뿐이거나 저장하는 동안에는 끌기·옮기기가 없다
    chipOf.clear();
    const chipsBox = el('div', { class: `file-chips${sortable ? ' can-sort' : ''}`, role: 'list', 'aria-label': t('run.chipsLabel') },
      ...picked.map((p, i) => fileChip(p, i, ranges[i] ?? null, sortable)), dropMark);
    if (sortable) watchDrag(chipsBox);
    put(uploadBox,
      chipsBox,
      el('div', { class: 'row' }, el('span', { class: 'muted' }, picked.length > 1 ? `${t('run.chipsHelp')} ${t('run.chipsSortHelp')}` : t('run.chipsHelp')),
        // 손으로 바꾼 순서를 처음처럼 파일 이름 순서로 되돌린다. 이미 이름 순이면 할 일이 없다
        picked.length > 1 ? el('button', { class: 'small', disabled: saving || byName.every((p, i) => p === picked[i]), onclick: () => { if (saving) return; picked = sortByName(picked); renderUpload(); } }, t('run.sortByName')) : null,
        el('button', { class: 'small', disabled: saving, onclick: () => { if (saving) return; dropPicked(); renderUpload(); } }, t('run.removeAll'))),
      el('div', { class: 'row' }, t('run.filesRotation', { files: included().length, n: totalPages() }), ...([0, 90, 180, 270] as Rotation[]).map(r =>
        el('button', { class: r === rotation ? 'primary' : '', disabled: saving, onclick: () => { if (saving) return; turnAll(r); } }, `${r}°`)),
        el('span', { class: 'muted' }, t('run.rotationHelp')), rotationNote),
      tiles.length ? sheetGrid : null,
      data.pages.length ? el('div', { class: 'band warn' }, t('run.alreadyPages', { n: data.pages.length, next: tag(next) })) : null,
      el('div', { class: 'row' }, saveBtn));
    saveBtn.disabled = saving || !included().length;
  }

  /**
   * 고른 파일 하나를 단추 모양 칩으로: 저장 차례(순번)·이름·쪽 수와 받을 장 범위, 오른쪽 위 x로 그 파일만 뺀다.
   * 이미 올린 파일은 칩 안에 경고와 '다시 저장하려면 체크'를 두고, 체크하지 않으면 순번 없이 '저장 안 함'
   */
  function fileChip(p: Picked, i: number, r: { 순번: number; 처음: number; 끝: number } | null, sortable: boolean): HTMLElement {
    const n = p.src.pageCount;
    const meta = !r ? t('run.chipSkip', { n }) : n === 1 ? t('run.chipOne', { page: tag(r.처음) }) : t('run.chipRange', { n, from: tag(r.처음), to: tag(r.끝) });
    const remove = t('run.removeFile', { name: p.이름 });
    // 칩 안의 x 단추 이름까지 섞여 읽히지 않게 칩 이름을 따로 준다. 옮길 수 있으면 초점을 받고 옮기는 방법을 알린다
    const chip = el('div', { class: `file-chip${p.이전 ? ' uploaded' : ''}${r ? '' : ' skipped'}`, role: 'listitem', 'data-index': String(i),
      'aria-label': [r ? t('run.chipOrder', { n: r.순번 }) : '', p.이름, meta].filter(Boolean).join(', '),
      tabindex: sortable ? '0' : null, title: sortable ? t('run.chipMoveHint') : null, 'aria-description': sortable ? t('run.chipMoveHint') : null },
      sortable ? el('span', { class: 'grip', 'aria-hidden': 'true' }) : null,
      el('span', { class: 'order', title: r ? t('run.chipOrder', { n: r.순번 }) : '' }, r ? String(r.순번) : '-'),
      el('span', { class: 'info' },
        el('span', { class: 'name', title: p.이름 }, p.이름),
        el('span', { class: 'meta' }, meta),
        p.이전 ? el('label', { class: 'again' },
          el('input', { type: 'checkbox', checked: p.포함, disabled: saving, onchange: (e: Event) => { if (saving) { renderUpload(); return; } p.포함 = (e.target as HTMLInputElement).checked; renderUpload(); } }),
          t('run.dupFile', { date: p.이전.일시.slice(0, 10), from: tag(p.이전.시작), to: tag(p.이전.끝) })) : null),
      el('button', { class: 'chip-x', disabled: saving, title: remove, 'aria-label': remove, onclick: () => removePicked(p) }, '×'));
    if (sortable) chip.addEventListener('keydown', e => moveByKey(e, i));
    chipOf.set(p, chip);
    return chip;
  }

  // ── 칩 순서 바꾸기: 끌어 놓기(pointer 사건)와 Alt+←·→. 순서가 바뀌면 순번·장 범위·미리보기·저장 차례가 함께 다시 그려진다 ──
  const dropMark = el('div', { class: 'chip-drop-mark hidden', 'aria-hidden': 'true' });
  const chipOf = new Map<Picked, HTMLElement>(); // 키보드로 옮긴 뒤 다시 그린 칩에 초점을 돌려준다
  let drag: { from: number; chip: HTMLElement; box: HTMLElement; id: number; x: number; y: number; on: boolean; before: number | null } | null = null;
  document.addEventListener('keydown', e => { if (drag && e.key === 'Escape') endDrag(); });

  function watchDrag(box: HTMLElement): void {
    box.addEventListener('pointerdown', e => {
      const chip = (e.target as Element).closest<HTMLElement>('.file-chip');
      // x·체크·'다시 저장' 글은 누르기만 한다. 끄는 것은 칩의 나머지 자리
      if (!chip || e.button !== 0 || saving || picked.length < 2 || (e.target as Element).closest('button, input, label')) return;
      drag = { from: Number(chip.dataset.index), chip, box, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, before: null };
      chip.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return; // 칩을 눌러 초점만 옮기는 것과 가른다
        drag.on = true; drag.chip.classList.add('dragging'); box.classList.add('sorting');
      }
      autoScroll(box, e.clientY);
      const chips = [...box.querySelectorAll<HTMLElement>('.file-chip')];
      const slot = dropSlot(chips.map(c => c.getBoundingClientRect()), e.clientX, e.clientY);
      if (!slot) return; // 줄 사이 틈에서는 앞서 고른 자리를 그대로 둔다
      drag.before = slot.before;
      showDropMark(box, chips[slot.chip]!, slot.after, slot.before === drag.from || slot.before === drag.from + 1);
    });
    box.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; endDrag();
      if (d.on && d.before !== null) moveFile(d.from, d.before, false);
    });
    box.addEventListener('pointercancel', endDrag);
  }

  function endDrag(): void {
    if (!drag) return;
    drag.chip.classList.remove('dragging'); drag.box.classList.remove('sorting');
    if (drag.chip.hasPointerCapture(drag.id)) drag.chip.releasePointerCapture(drag.id);
    dropMark.classList.add('hidden');
    drag = null;
  }

  /** 놓을 자리: 고른 칩의 앞(왼쪽)이나 뒤(오른쪽) 틈 가운데 세로 막대. 놓아도 그대로인 자리면 감춘다 */
  function showDropMark(box: HTMLElement, chip: HTMLElement, after: boolean, same: boolean): void {
    dropMark.classList.toggle('hidden', same);
    if (same) return;
    const b = box.getBoundingClientRect(), r = chip.getBoundingClientRect();
    dropMark.style.left = `${Math.max(0, (after ? r.right + 5 : r.left - 5) - b.left + box.scrollLeft - 1.5)}px`; // 칩 간격(10px)의 가운데
    dropMark.style.top = `${r.top - b.top + box.scrollTop}px`;
    dropMark.style.height = `${r.height}px`;
  }

  /** 칩이 많아 칸 안에서 넘길 때: 끄는 점이 칸의 위·아래 끝에 가까우면 그쪽으로 넘긴다 */
  function autoScroll(box: HTMLElement, y: number): void {
    const r = box.getBoundingClientRect();
    if (y < r.top + 20) box.scrollTop -= 10; else if (y > r.bottom - 20) box.scrollTop += 10;
  }

  function moveFile(from: number, before: number, keepFocus: boolean): void {
    const pk = picked[from];
    const next = moveBefore(picked, from, before);
    if (saving || !pk || next.every((x, k) => x === picked[k])) return;
    picked = next;
    renderUpload();
    moveNote.textContent = t('run.moved', { name: pk.이름, n: picked.indexOf(pk) + 1 });
    if (keepFocus) chipOf.get(pk)?.focus();
  }

  /** Alt+←·→: 초점이 있는 칩을 한 자리 앞이나 뒤로. 맨 앞·맨 뒤에서는 그대로 */
  function moveByKey(e: KeyboardEvent, i: number): void {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault(); // Alt+←가 뒤로 가기로 넘어가지 않게
    moveFile(i, e.key === 'ArrowLeft' ? i - 1 : i + 2, true);
  }

  /** 저장한 자리에서 그 장만 바로 전사한다. '전사 시작'이 화면 맨 아래에 있어 장을 저장한 뒤 한참 내려가야 했다 */
  function newPagesRow(pages: number[]): HTMLElement {
    const confirmed = data?.key.확인?.완료 === true;
    return el('div', { class: 'row' },
      el('button', { class: 'primary', disabled: running || trying || !confirmed, onclick: () => {
        runCard.scrollIntoView({ block: 'center', behavior: 'smooth' }); // 진행 막대는 전사 칸에 있다
        void run({ pages, force: false });
      } }, t('run.transcribeNew', { n: pages.length })),
      el('span', { class: 'muted' }, confirmed ? t('run.transcribeNewHelp', { from: tag(pages[0]!), to: tag(pages[pages.length - 1]!) }) : t('common.notConfirmed')));
  }

  /** 전체 회전: 따로 돌린 쪽까지 모든 쪽을 이 각도로 */
  function turnAll(r: Rotation): void {
    rotation = r;
    for (const pk of picked) { pk.회전.fill(r); pk.tiles.forEach(showTurn); }
    renderUpload();
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
    trying = true; renderRun(); renderUpload();
    clear(tryBox); tryBox.append(el('div', { class: 'muted' }, t('run.try.running')));
    try {
      const tr = await api.tryPage(폴더, await fileToJpeg(f, store.state.settings.기본회전));
      clear(tryBox); tryBox.append(transcriptTable(key, tr));
    } catch (e) { clear(tryBox); showError((e as Error).message); }
    finally { trying = false; renderRun(); renderUpload(); }
  }

  // ── 전사 ──
  const progressBar = el('progress', { max: '1', value: '0' });
  const progressText = el('span');
  const pagesInput = el('input', { size: 10, placeholder: t('common.pagesPlaceholder') });
  let redoOpen = false;

  async function run(opts: { pages?: number[]; force?: boolean }): Promise<void> {
    if (!data || running || trying) return;
    const 폴더 = data.폴더;
    const profile = store.state.settings.프로필.find(p => p.id === store.state.settings.사용중);
    const price = priceOf(profile); // 실제 청구와 다를 수 있는 추정. 구독과 단가를 모르는 API는 보이지 않는다
    if (coversSaved(justSaved, opts.pages)) justSaved = []; // 전사한 뒤에는 '새로 저장한 N장 전사하기'가 할 일이 없다
    running = true; renderUpload(); renderRun(); renderThumbs(); renderPrivacy(); clear(resultBox);
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
    // 메인은 창에 초점이 없을 때만 띄운다(다른 창을 보던 사람만 알림이 필요하다)
    const notify = (title: string, body: string) => void api.notify(title, body).catch(() => undefined);
    try {
      const r = await api.startRun(폴더, opts);
      showResult(r);
      notify(t('run.notify.done', { name: 폴더 }), t('run.summary', { ok: r.ok.length, failed: r.failed.length, skipped: r.skipped.length }));
    } catch (e) { showError((e as Error).message); notify(t('run.notify.failed', { name: 폴더 }), (e as Error).message); }
    finally {
      clearInterval(timer); off(); tick(); running = false;
      // 전사할 장 수와 장 그림의 학생 표시가 이번 전사를 반영하게 새로 읽은 뒤 그린다
      if (store.state.current === 폴더) data = await api.readSet(폴더).catch(() => data);
      renderCounts(); renderUpload(); renderRun(); renderThumbs(); renderPrivacy();
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
