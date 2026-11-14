import type { CasePreview } from '../../core/cases.js';
import type { Panjeong } from '../../core/types.js';
import { el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { tag } from '../lib/screen-utils.js';

/** record: 사례로 기록(같은 답의 다른 장도 바뀜), sheet: 이 장만 저장(사례 없이), cancel: 저장하지 않고 고치던 화면으로 */
export type CaseChoice = 'record' | 'sheet' | 'cancel';

const verdict = (v: Panjeong) => t(`verdict.${v}`);

/**
 * 사례로 기록하기 전 확인 창(답안지별 검토). 단추가 셋이라 브라우저 confirm 대신 앱 안의 창으로 만든다.
 * 신원이 보이는 탭이라 함께 바뀔 장 번호를 그대로 보인다. Esc나 창 닫기는 취소
 */
export function askCaseRecord(previews: CasePreview[]): Promise<CaseChoice> {
  return new Promise(resolve => {
    let choice: CaseChoice = 'cancel';
    const pick = (c: CaseChoice) => { choice = c; dlg.close(); };
    const items = previews.map(p => el('li', { class: `case-item${p.경고 ? ' warned' : ''}` },
      el('div', { class: 'case-what' }, el('strong', {}, p.단위), ' ', el('span', { class: 'case-answer' }, `'${p.답.trim()}'`), ' → ', el('strong', { class: `v-${p.판정}` }, verdict(p.판정))),
      el('div', { class: 'case-pages' }, p.바뀔장.length
        ? t('review.case.pages', { n: p.바뀔장.length, list: p.바뀔장.map(c => `${tag(c.page)}(${verdict(c.이전)}→${verdict(c.이후)})`).join(', ') })
        : t('review.case.noPages')),
      p.경고 ? el('div', { class: 'case-warn', role: 'alert' }, t(p.논술형 ? 'review.case.warnContains' : 'review.case.warnSame', { what: t(`review.case.what.${p.경고}`) })) : null));
    const record = el('button', { class: 'primary', onclick: () => pick('record') }, t('review.case.record'));
    const sheet = el('button', { onclick: () => pick('sheet') }, t('review.case.sheetOnly'));
    const cancel = el('button', { onclick: () => pick('cancel') }, t('review.case.cancel'));
    const dlg = el('dialog', { class: 'case-confirm', 'aria-labelledby': 'case-confirm-title' },
      el('h3', { id: 'case-confirm-title' }, t('review.case.title')),
      el('div', { class: 'muted' }, t('review.case.lead')),
      el('ul', { class: 'case-list' }, ...items),
      el('div', { class: 'row actions' }, record, sheet, cancel));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(choice); });
    document.body.append(dlg);
    dlg.showModal();
    // 정답표와 맞는 답을 X로 기록하려 할 때는 Enter 한 번에 기록되지 않게 '취소'에 초점을 둔다
    (previews.some(p => p.경고) ? cancel : record).focus();
  });
}
