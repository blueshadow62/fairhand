import type { ProgressEvent, RunResult, SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el, put } from '../lib/el.js';
import { canvasToJpeg, DPI_SCALE, openPdf, type OpenedPdf, type Rotation } from '../pdf-pages.js';

const NOTICE = '학생 답안지에는 학년, 반, 번호만 입력되어 있는 걸 추천합니다. 이름이 있으면 그림과 함께 Anthropic 서버로 전송됩니다.';
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
  let pdf: OpenedPdf | null = null;
  let rotation: Rotation = store.state.settings.기본회전;
  let running = false;

  const body = el('div');
  root.append(el('h2', {}, '채점 실행'), el('div', { class: 'band info' }, NOTICE), body);

  const countBox = el('div', { class: 'row' });
  const preview = el('canvas', { class: 'preview' });
  const uploadBox = el('div');
  const runBox = el('div');
  const resultBox = el('div');

  async function reload(): Promise<void> {
    const 폴더 = store.state.current;
    shownFor = 폴더;
    clear(body);
    if (!폴더) { body.append(el('div', { class: 'muted' }, '문항 설정에서 세트를 고르세요.')); return; }
    try { data = await api.readSet(폴더); } catch (e) { showError((e as Error).message); return; }
    renderCounts();
    body.append(el('h3', {}, `세트: ${폴더}`), countBox,
      el('div', { class: 'card' }, el('h3', {}, '답안지 PDF 올리기'), uploadBox),
      el('div', { class: 'card' }, el('h3', {}, '전사'), runBox), resultBox);
    renderUpload(); renderRun();
  }

  function renderCounts(): void {
    clear(countBox);
    if (!data) return;
    put(countBox, `답안지 ${data.pages.length}장 · 전사 ${data.transcripts.length}장`,
      data.key.확인?.완료 ? null : el('span', { class: 'band error' }, '정답표가 아직 확인되지 않았습니다'));
  }

  // ── PDF 올리기 ──
  const fileInput = el('input', { type: 'file', accept: '.pdf' });
  fileInput.addEventListener('change', () => void pickPdf());
  const uploadStatus = el('div', { class: 'muted' });

  async function pickPdf(): Promise<void> {
    const f = fileInput.files?.[0];
    if (!f) return;
    pdf?.close(); pdf = null;
    try { pdf = await openPdf(f); } catch (e) { showError(`PDF를 열지 못했습니다: ${(e as Error).message}`); return; }
    rotation = store.state.settings.기본회전;
    renderUpload(); await drawPreview();
  }

  async function drawPreview(): Promise<void> {
    if (!pdf) return;
    const c = await pdf.renderPage(1, { rotation, scale: 0.4 });
    preview.width = c.width; preview.height = c.height;
    preview.getContext('2d')!.drawImage(c, 0, 0);
  }

  async function savePages(): Promise<void> {
    if (!pdf || !data) return;
    const 폴더 = data.폴더, total = pdf.pageCount;
    const made: number[] = [];
    saveBtn.disabled = true;
    try {
      for (let start = 1; start <= total; start += BATCH) {
        const jpegs: ArrayBuffer[] = [];
        for (let n = start; n < start + BATCH && n <= total; n++) {
          jpegs.push(await canvasToJpeg(await pdf.renderPage(n, { rotation, scale: DPI_SCALE })));
          uploadStatus.textContent = `${n}/${total}장 그리는 중…`;
        }
        made.push(...await api.addPages(폴더, jpegs));
        uploadStatus.textContent = `${made.length}/${total}장 저장`;
      }
      showInfo(`${tag(made[0]!)}~${tag(made[made.length - 1]!)} 저장했습니다`);
      pdf.close(); pdf = null; fileInput.value = '';
      data = await api.readSet(폴더); renderCounts(); renderUpload(); await store.refreshSets();
    } catch (e) { showError((e as Error).message); }
    finally { saveBtn.disabled = false; }
  }
  const saveBtn = el('button', { class: 'primary', onclick: () => void savePages() }, '쪽 나누어 저장');

  function renderUpload(): void {
    clear(uploadBox);
    uploadBox.append(el('div', { class: 'row' }, fileInput), uploadStatus);
    if (!pdf || !data) return;
    const next = data.pages.length ? Math.max(...data.pages) + 1 : 1;
    put(uploadBox,
      el('div', { class: 'row' }, `${pdf.pageCount}쪽 · 회전: `, ...([0, 90, 180, 270] as Rotation[]).map(r =>
        el('button', { class: r === rotation ? 'primary' : '', onclick: () => { rotation = r; renderUpload(); void drawPreview(); } }, `${r}°`)),
        el('span', { class: 'muted' }, '첫 장의 글이 바로 서도록 고르세요(시계 방향).')),
      preview,
      data.pages.length ? el('div', { class: 'band warn' }, `이미 ${data.pages.length}장이 있습니다. 새 장은 ${tag(next)}부터 저장됩니다.`) : null,
      el('div', { class: 'row' }, saveBtn));
  }

  // ── 전사 ──
  const progressBar = el('progress', { max: '1', value: '0' });
  const progressText = el('span');
  const pagesInput = el('input', { size: 10, placeholder: '예: 1-3,7' });

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
      const cost = isApi ? ` · 비용 추정 약 $${((inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6).toFixed(2)}` : '';
      progressText.textContent = `${done}/${total}장 · ${sec}초 · 토큰 입력 ${inTok} / 출력 ${outTok}${cost}`;
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
    const box = el('div', { class: 'card' }, el('h3', {}, '결과'),
      el('div', {}, `성공 ${r.ok.length}장 · 실패 ${r.failed.length}장 · 건너뜀(이미 전사됨) ${r.skipped.length}장`));
    if (r.failed.length) box.append(el('table', {}, el('tr', {}, el('th', {}, '장'), el('th', {}, '오류')), ...r.failed.map(f => el('tr', {}, el('td', {}, tag(f.page)), el('td', {}, f.error)))));
    if (r.엑셀) box.append(el('div', { class: 'row' }, '엑셀: ', el('span', { class: 'path' }, r.엑셀), el('button', { onclick: () => api.revealPath(r.엑셀!).catch(e => showError(e.message)) }, '폴더에서 보기')));
    if (r.엑셀오류) box.append(el('div', { class: 'band warn' }, `엑셀을 만들지 못했습니다: ${r.엑셀오류}`));
    box.append(el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => ctx.goTo('review') }, '검토로 가기')));
    resultBox.append(box);
  }

  function renderRun(): void {
    clear(runBox);
    if (!data) return;
    const confirmed = data.key.확인?.완료 === true;
    put(runBox,
      el('div', { class: 'row' },
        el('button', { class: 'primary', disabled: running || !confirmed || !data.pages.length, onclick: () => void run({ force: false }) }, '전사 시작'),
        el('button', { class: 'danger', disabled: !running, onclick: () => api.cancelRun().catch(e => showError(e.message)) }, '중단'),
        progressBar, progressText),
      el('div', { class: 'muted' }, '이미 전사한 장은 건너뜁니다. 끝나면 채점결과 엑셀을 세트 폴더에 만듭니다.'),
      el('div', { class: 'row' }, '다시 전사할 장: ', pagesInput,
        el('button', { disabled: running || !confirmed, onclick: () => {
          const pages = parsePageSpec(pagesInput.value);
          if (!pages) { showError('장 번호를 1-3,7처럼 적으세요'); return; }
          const missing = pages.filter(p => !data!.pages.includes(p));
          if (missing.length) { showError(`없는 장: ${missing.map(tag).join(', ')}`); return; }
          if (!confirm(`${pages.map(tag).join(', ')}의 전사를 새로 만들어 덮어씁니다(검토에서 고친 내용도 사라집니다). 계속할까요?`)) return;
          void run({ pages, force: true });
        } }, '다시 전사')),
      confirmed ? null : el('div', { class: 'band error' }, '정답표가 아직 확인되지 않았습니다. 문항 설정에서 확인 완료를 표시하세요.'));
  }

  store.subscribe(s => { if (s.current !== shownFor && !running) void reload(); });
  // 다른 탭에서 확인 표시·전사가 바뀌었을 수 있어, 탭이 다시 보일 때 새로 읽는다
  new MutationObserver(() => { if (!root.classList.contains('hidden') && !running) void reload(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  void reload();
}
