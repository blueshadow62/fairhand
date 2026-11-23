import { answerPdfSummary, DEFAULT_ANSWER_PDF_OPTIONS, type AnswerPdfBundle, type AnswerPdfOptions, type AnswerPdfOrder } from '../../core/answer-pdf.js';
import type { AnswerKey } from '../../core/types.js';
import type { SetData } from '../../shared/ipc.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { openRegionBatch } from './region-batch.js';

/** 같은 실행 안에서는 마지막에 고른 선택을 다음에 창을 열 때 그대로 둔다 */
let last: AnswerPdfOptions = { ...DEFAULT_ANSWER_PDF_OPTIONS };

/**
 * '답안지 PDF 받기' 창. 표시·묶음·순서를 고르고, 폴더 고르기 창에서 받을 폴더를 정하면 만든다.
 * 끝나면 창 안에 경로와 '폴더에서 보기'를 보인다. Esc나 닫기로 닫는다.
 * 답 칸이 없거나 모자라면 안내 옆에서 '답 칸 한꺼번에 잡기'를 연다. 저장하면 안내 숫자를 새로 세고 onRegionsSaved로 알린다
 */
export function openAnswerPdfDialog(data: SetData, opts: { onRegionsSaved?(key: AnswerKey): void } = {}): void {
  let s = answerPdfSummary(data.key, data.transcripts, data.pages);
  let canMark = s.답칸 > 0;
  const o: AnswerPdfOptions = { ...last, 표시: last.표시 && canMark };
  let busy = false;

  const radio = <V extends string>(name: string, value: V, cur: V, label: string, on: (v: V) => void, disabled = false) =>
    el('label', {}, el('input', { type: 'radio', name, value, 'data-focus': `${name}:${value}`, checked: value === cur, disabled, onchange: () => { on(value); render(); } }), ' ', label);
  const check = (id: string, cur: boolean, label: string, on: (v: boolean) => void, disabled = false) => {
    const cb = el('input', { type: 'checkbox', 'data-focus': id, checked: cur, disabled, onchange: () => { on(cb.checked); render(); } });
    return el('label', {}, cb, ' ', label);
  };

  const body = el('div', { class: 'pdf-options' });
  const status = el('div', { class: 'pdf-status', role: 'status' });
  const go = el('button', { class: 'primary', onclick: () => void run() }, t('pdf.export.go'));
  const close = el('button', { onclick: () => dlg.close() }, t('pdf.export.close'));
  const summary = el('div', { class: 'muted' });
  const dlg = el('dialog', { class: 'case-confirm answer-pdf', 'aria-labelledby': 'answer-pdf-title' },
    el('h3', { id: 'answer-pdf-title' }, t('pdf.export.title')),
    summary,
    body, status,
    el('div', { class: 'row actions' }, go, close));
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); }); // 만드는 중에 Esc로 닫으면 끝난 줄 모른다
  dlg.addEventListener('close', () => dlg.remove());

  /** 답 칸을 잡을 창. 전사한 장이 없으면 잡을 그림이 없어 잠근다 */
  const batchButton = (): HTMLElement => el('button', { class: 'small', 'data-focus': 'region-batch', disabled: busy || !data.transcripts.length,
    title: t(data.transcripts.length ? 'region.batch.openTitle' : 'region.batch.needTranscript'),
    onclick: () => openRegionBatch({ data, onSaved: (key, n) => {
      data.key = key;
      s = answerPdfSummary(data.key, data.transcripts, data.pages);
      canMark = s.답칸 > 0;
      if (!canMark) o.표시 = false;
      render();
      showStatus(t('region.batch.saved', { n }));
      opts.onRegionsSaved?.(key);
    } }) }, t('region.batch.open'));

  function render(): void {
    // 고를 때마다 다시 그려도 키보드 초점이 같은 선택지로 돌아오게
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    summary.textContent = t('pdf.export.summary', { pages: s.장수, unconfirmed: s.미확인, regions: s.답칸, units: s.단위 });
    clear(body);
    const marks = el('fieldset', {}, el('legend', {}, t('pdf.export.marks')),
      radio('pdf-marks', 'plain', o.표시 ? 'marked' : 'plain', t('pdf.export.plain'), () => { o.표시 = false; }, busy),
      radio('pdf-marks', 'marked', o.표시 ? 'marked' : 'plain', t('pdf.export.marked'), () => { o.표시 = true; }, busy || !canMark));
    if (!canMark) marks.append(el('div', { class: 'band warn region-note' }, el('span', {}, t('pdf.export.noRegions')), batchButton()));
    if (o.표시) {
      marks.append(el('div', { class: 'row sub' }, check('score', o.점수, t('pdf.export.score'), v => { o.점수 = v; }, busy)),
        el('div', { class: 'row sub' }, check('unconfirmed', o.미확인표시, t('pdf.export.unconfirmed'), v => { o.미확인표시 = v; }, busy)));
      if (s.답칸 < s.단위) marks.append(el('div', { class: 'muted region-note' }, el('span', {}, t('pdf.export.partialRegions', { n: s.단위 - s.답칸 })), batchButton()));
      if (s.미확인 && !o.미확인표시) marks.append(el('div', { class: 'muted' }, t('pdf.export.unconfirmedNote', { n: s.미확인 })));
    }
    const bundle = el('fieldset', {}, el('legend', {}, t('pdf.export.bundle')),
      ...(['one', 'class', 'student'] as AnswerPdfBundle[]).map(b => radio('pdf-bundle', b, o.묶음, t(`pdf.export.bundle.${b}`), v => { o.묶음 = v; }, busy)));
    const order = el('fieldset', {}, el('legend', {}, t('pdf.export.order')),
      ...(['student', 'page'] as AnswerPdfOrder[]).map(v => radio('pdf-order', v, o.순서, t(`pdf.export.order.${v}`), x => { o.순서 = x; }, busy)));
    body.append(marks, bundle, order, el('div', { class: 'muted' }, t('pdf.export.noMask')));
    go.disabled = busy || !s.장수;
    close.disabled = busy;
    if (focused) [...body.querySelectorAll<HTMLElement>('[data-focus]')].find(x => x.dataset.focus === focused)?.focus();
  }

  async function run(): Promise<void> {
    if (busy) return;
    const outDir = await api.pickFolder().catch(e => { showStatus((e as Error).message, true); return null; });
    if (!outDir) return;
    busy = true; render();
    showStatus(t('pdf.export.making', { pages: s.장수 }));
    try {
      const r = await api.exportAnswerPdf(data.폴더, outDir, o);
      last = { ...o };
      clear(status);
      status.append(el('div', { class: 'band info' }, t('pdf.export.done', { files: r.파일.length, pages: r.장수, marked: r.표시장수 })),
        el('div', { class: 'row' }, el('span', { class: 'path' }, r.파일.length === 1 ? r.파일[0]! : r.폴더),
          el('button', { onclick: () => api.revealPath(r.파일.length === 1 ? r.파일[0]! : r.폴더).catch(e => showStatus((e as Error).message, true)) }, t('common.reveal'))));
    } catch (e) { showStatus((e as Error).message, true); }
    finally { busy = false; render(); }
  }
  function showStatus(msg: string, error = false): void {
    clear(status);
    status.append(el('div', { class: `band ${error ? 'error' : 'info'}`, role: error ? 'alert' : null }, msg));
  }

  render();
  document.body.append(dlg);
  dlg.showModal();
  go.focus();
}
