import { activeCases, DEFAULT_CRITERIA_OPTIONS, type CriteriaFormat, type CriteriaOptions } from '../../core/criteria.js';
import type { AnswerKey } from '../../core/types.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t } from '../lib/i18n.js';

/** 같은 실행 안에서는 마지막에 고른 선택을 다음에 창을 열 때 그대로 둔다 */
let last: CriteriaOptions = { ...DEFAULT_CRITERIA_OPTIONS };

/**
 * '채점 기준 안내문' 내보내기 창. 형식(PDF·HWPX)과 넣을 것을 고르고, 저장 창에서 자리를 정하면 만든다.
 * key는 저장된 정답표(메인도 파일의 정답표로 만든다). 사례 수는 지금 판정에 쓰이는 것만 센다
 */
export function openCriteriaDialog(폴더: string, key: AnswerKey): void {
  const nCases = activeCases(key).length;
  const o: CriteriaOptions = { ...last };
  let busy = false;

  const radio = (value: CriteriaFormat, label: string) =>
    el('label', {}, el('input', { type: 'radio', name: 'criteria-format', value, 'data-focus': `format:${value}`, checked: o.형식 === value, disabled: busy, onchange: () => { o.형식 = value; render(); } }), ' ', label);
  const check = (id: string, cur: boolean, label: string, on: (v: boolean) => void, disabled = false) => {
    const cb = el('input', { type: 'checkbox', 'data-focus': id, checked: cur, disabled: busy || disabled, onchange: () => { on(cb.checked); render(); } });
    return el('label', {}, cb, ' ', label);
  };

  const body = el('div', { class: 'pdf-options' });
  const status = el('div', { class: 'pdf-status', role: 'status' });
  const go = el('button', { class: 'primary', onclick: () => void run() }, t('criteria.go'));
  const close = el('button', { onclick: () => dlg.close() }, t('pdf.export.close'));
  const dlg = el('dialog', { class: 'case-confirm answer-pdf criteria-export', 'aria-labelledby': 'criteria-title' },
    el('h3', { id: 'criteria-title' }, t('criteria.title')),
    el('div', { class: 'muted' }, t('criteria.intro')),
    body, status,
    el('div', { class: 'row actions' }, go, close));
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dlg.addEventListener('close', () => dlg.remove());

  function render(): void {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    clear(body);
    const format = el('fieldset', {}, el('legend', {}, t('criteria.format')), radio('pdf', t('criteria.format.pdf')), radio('hwpx', t('criteria.format.hwpx')));
    // 사례의 답은 정답을 드러내므로 정답을 끄면 사례도 넣을 수 없다
    const caseOn = o.사례 && o.정답 && nCases > 0;
    const parts = el('fieldset', {}, el('legend', {}, t('criteria.parts')),
      check('answers', o.정답, t('criteria.answers'), v => { o.정답 = v; }),
      o.정답 ? null : el('div', { class: 'muted sub' }, t('criteria.answersOff')),
      check('rules', o.규칙, t('criteria.rules'), v => { o.규칙 = v; }),
      check('cases', caseOn, t('criteria.cases', { n: nCases }), v => { o.사례 = v; }, !o.정답 || nCases === 0),
      nCases === 0 ? el('div', { class: 'muted sub' }, t('criteria.noCases')) : caseOn ? el('div', { class: 'muted sub' }, t('criteria.casesPrivacy')) : null);
    body.append(format, parts);
    go.disabled = busy;
    close.disabled = busy;
    if (focused) [...body.querySelectorAll<HTMLElement>('[data-focus]')].find(x => x.dataset.focus === focused)?.focus();
  }

  async function run(): Promise<void> {
    if (busy) return;
    busy = true; render();
    showStatus(t('criteria.making'));
    try {
      const sent: CriteriaOptions = { ...o, 사례: o.사례 && o.정답 && nCases > 0 };
      const p = await api.exportCriteria(폴더, sent);
      if (!p) { clear(status); return; } // 저장 창에서 그만두었다
      last = { ...o };
      clear(status);
      status.append(el('div', { class: 'band info' }, t('criteria.done')),
        el('div', { class: 'row' }, el('span', { class: 'path' }, p),
          el('button', { onclick: () => api.revealPath(p).catch(e => showStatus((e as Error).message, true)) }, t('common.reveal'))));
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
