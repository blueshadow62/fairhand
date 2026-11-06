import type { ProgressEvent, RunResult, SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { byNaturalName, canvasToJpeg, DPI_SCALE, openSheetSource, type Rotation, type SheetSource } from '../pdf-pages.js';

// API 요금 추정(백만 토큰당 달러). 실제 청구와 다를 수 있다
const PRICE_IN = 5, PRICE_OUT = 25;
const BATCH = 10; // 한 번에 너무 큰 IPC 전송을 피한다
const tag = (p: number) => `p${String(p).padStart(2, '0')}`;

/** "1-3,7" → [1,2,3,7] */
function parsePageSpec(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (b < a) return null;
    for (let p = a; p <= b; p++) out.add(p);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  let shownFor: string | null | undefined;
  let data: SetData | null = null;
  let sources: SheetSource[] = []; // 올린 파일들(이름순). 한 번에 이어서 쪽으로 나눈다
  const totalPages = () => sources.reduce((n, s) => n + s.pageCount, 0);
  let rotation: Rotation = store.state.settings.기본회전;
  let running = false;

  const body = el('div');
  root.append(el('h2', {}, t('run.title')), el('div', { class: 'band info' }, t('run.notice')), body);

  const countBox = el('div', { class: 'row' });
  const preview = el('canvas', { class: 'preview' });
  const uploadBox = el('div');
  const runBox = el('div');
  const resultBox = el('div');

  async function reload(): Promise<void> {
    const 폴더 = store.state.current;
    shownFor = 폴더;
    clear(body);
    if (!폴더) { body.append(el('div', { class: 'muted' }, t('common.chooseSet'))); return; }
    try { data = await api.readSet(폴더); } catch (e) { showError((e as Error).message); return; }
    renderCounts();
    body.append(el('h3', {}, t('common.set', { name: 폴더 })), countBox,
      el('div', { class: 'card' }, el('h3', {}, t('run.upload')), uploadBox),
      el('div', { class: 'card' }, el('h3', {}, t('run.transcribe')), runBox), resultBox);
    renderUpload(); renderRun();
  }

  function renderCounts(): void {
    clear(countBox);
    if (!data) return;
    put(countBox, t('run.counts', { pages: data.pages.length, transcripts: data.transcripts.length }),
      data.key.확인?.완료 ? null : el('span', { class: 'band error' }, t('common.notConfirmed')));
  }

  // ── PDF 올리기 ──
  const fileInput = el('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.bmp', multiple: true });
  fileInput.addEventListener('change', () => void pickFiles());
  const uploadStatus = el('div', { class: 'muted' });

  async function pickFiles(): Promise<void> {
    const files = [...(fileInput.files ?? [])].sort(byNaturalName); // 스캐너 파일명(001, 002…) 순서대로
    if (!files.length) return;
    for (const s of sources) s.close();
    sources = [];
    for (const f of files) {
      try { sources.push(await openSheetSource(f)); }
      catch (e) { showError(t('run.openFailed', { name: f.name, error: (e as Error).message })); }
    }
    rotation = store.state.settings.기본회전;
    renderUpload(); await drawPreview();
  }

  async function drawPreview(): Promise<void> {
    const first = sources[0];
    if (!first) return;
    const c = await first.render(1, rotation, 0.4);
    preview.width = c.width; preview.height = c.height;
    preview.getContext('2d')!.drawImage(c, 0, 0);
  }

  async function savePages(): Promise<void> {
    if (!sources.length || !data) return;
    const 폴더 = data.폴더, total = totalPages();
    const made: number[] = [];
    saveBtn.disabled = true;
    try {
      // 파일 순서대로, 파일 안에서는 쪽 순서대로 하나의 번호 흐름으로 이어 붙인다
      let jpegs: ArrayBuffer[] = [], n = 0;
      const flush = async () => { if (jpegs.length) { made.push(...await api.addPages(폴더, jpegs)); jpegs = []; uploadStatus.textContent = t('run.savedCount', { n: made.length, total }); } };
      for (const src of sources) {
        for (let p = 1; p <= src.pageCount; p++) {
          n++;
          jpegs.push(await canvasToJpeg(await src.render(p, rotation, DPI_SCALE)));
          uploadStatus.textContent = t('run.rendering', { n, total });
          if (jpegs.length >= BATCH) await flush();
        }
      }
      await flush();
      showInfo(t('run.pagesSaved', { from: tag(made[0]!), to: tag(made[made.length - 1]!) }));
      for (const s of sources) s.close(); sources = []; fileInput.value = '';
      data = await api.readSet(폴더); renderCounts(); renderUpload(); await store.refreshSets();
    } catch (e) { showError((e as Error).message); }
    finally { saveBtn.disabled = false; }
  }
  const saveBtn = el('button', { class: 'primary', onclick: () => void savePages() }, t('run.splitSave'));

  function renderUpload(): void {
    clear(uploadBox);
    uploadBox.append(el('div', { class: 'row' }, fileInput), uploadStatus);
    if (!sources.length || !data) return;
    const next = data.pages.length ? Math.max(...data.pages) + 1 : 1;
    put(uploadBox,
      el('div', { class: 'muted' }, sources.map(s => t('run.fileLine', { name: s.name, n: s.pageCount })).join(' · ')),
      el('div', { class: 'row' }, t('run.filesRotation', { files: sources.length, n: totalPages() }), ...([0, 90, 180, 270] as Rotation[]).map(r =>
        el('button', { class: r === rotation ? 'primary' : '', onclick: () => { rotation = r; renderUpload(); void drawPreview(); } }, `${r}°`)),
        el('span', { class: 'muted' }, t('run.rotationHelp'))),
      preview,
      data.pages.length ? el('div', { class: 'band warn' }, t('run.alreadyPages', { n: data.pages.length, next: tag(next) })) : null,
      el('div', { class: 'row' }, saveBtn));
  }

  // ── 전사 ──
  const progressBar = el('progress', { max: '1', value: '0' });
  const progressText = el('span');
  const pagesInput = el('input', { size: 10, placeholder: t('common.pagesPlaceholder') });

  async function run(opts: { pages?: number[]; force?: boolean }): Promise<void> {
    if (!data || running) return;
    const 폴더 = data.폴더;
    const profile = store.state.settings.프로필.find(p => p.id === store.state.settings.사용중);
    const isApi = profile?.종류 === 'api';
    running = true; renderRun(); clear(resultBox);
    const started = Date.now();
    let inTok = 0, outTok = 0, done = 0, total = opts.pages?.length ?? data.pages.length;
    const tick = () => {
      const sec = Math.round((Date.now() - started) / 1000);
      const cost = isApi ? t('run.costEstimate', { cost: ((inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6).toFixed(2) }) : '';
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
      clearInterval(timer); off(); tick(); running = false; renderRun();
      if (store.state.current === 폴더) { data = await api.readSet(폴더).catch(() => data); renderCounts(); }
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

  function renderRun(): void {
    clear(runBox);
    if (!data) return;
    const confirmed = data.key.확인?.완료 === true;
    put(runBox,
      el('div', { class: 'row' },
        el('button', { class: 'primary', disabled: running || !confirmed || !data.pages.length, onclick: () => void run({ force: false }) }, t('run.start')),
        el('button', { class: 'danger', disabled: !running, onclick: () => api.cancelRun().catch(e => showError(e.message)) }, t('run.cancel')),
        progressBar, progressText),
      el('div', { class: 'muted' }, t('run.startHelp')),
      el('div', { class: 'row' }, t('run.redoPages'), pagesInput,
        el('button', { disabled: running || !confirmed, onclick: () => {
          const pages = parsePageSpec(pagesInput.value);
          if (!pages) { showError(t('common.badPageSpec')); return; }
          const missing = pages.filter(p => !data!.pages.includes(p));
          if (missing.length) { showError(t('run.missingPages', { pages: missing.map(tag).join(', ') })); return; }
          if (!confirm(t('run.redoConfirm', { pages: pages.map(tag).join(', ') }))) return;
          void run({ pages, force: true });
        } }, t('run.redo'))),
      confirmed ? null : el('div', { class: 'band error' }, t('run.notConfirmedLong')));
  }

  store.subscribe(s => { if (s.current !== shownFor && !running) void reload(); });
  // 다른 탭에서 확인 표시·전사가 바뀌었을 수 있어, 탭이 다시 보일 때 새로 읽는다
  new MutationObserver(() => { if (!root.classList.contains('hidden') && !running) void reload(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  void reload();
}
