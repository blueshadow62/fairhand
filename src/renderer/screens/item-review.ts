import { unitPoints } from '../../core/key.js';
import type { Panjeong, QtyUnit, QualUnit, Transcript } from '../../core/types.js';
import { unitChecked, type UnitResultItem } from '../../core/unit-results.js';
import type { SetData } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { anonLabels, groupAnswers, keyLine, progress, sortGroups, unitDone, unitSummaries, type AnswerGroup } from '../lib/item-review.js';

/** 실행마다 새로 정한다. 익명 줄 순서가 실행마다 달라 지난번 순서로 학생을 짐작하지 못한다 */
const SALT = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
const VERDICTS: Panjeong[] = ['O', 'X', '빈칸'];

export interface ItemPane { root: HTMLElement; render(d: SetData | null): void }
export interface ItemPaneDeps {
  notice: HTMLElement;
  /** 세트를 다시 읽어 두 탭을 다시 그린다(알림 칸도 비운다) */
  refresh(): Promise<void>;
  recordCases(): boolean;
  setRecordCases(on: boolean): void;
}

/**
 * 문항별 검토(신원 숨김): 왼쪽은 단위 목록, 가운데는 고른 단위의 답 묶음.
 * 학년·반·번호·이름·식별 확신·장 번호·비고는 그리지 않는다. 동작마다 바로 저장해 저장하지 않은 상태가 없다
 */
export function createItemPane(ctx: Ctx, deps: ItemPaneDeps): ItemPane {
  const { showError, showInfo } = ctx;
  const units = el('div', { class: 'units' });
  const groups = el('div', { class: 'groups' });
  const root = el('div', { class: 'item-review hidden' }, units, groups);
  let data: SetData | null = null;
  let unitId: string | null = null;
  let onlyUnchecked = false;
  let busy = false; // 저장과 엑셀 생성이 두 벌 돌지 않게 기다리는 동안 단추를 잠근다
  const open = new Set<string>(); // 펼친 묶음: 단위 + 정규 답

  function render(d: SetData | null): void {
    if (d?.폴더 !== data?.폴더) { open.clear(); unitId = null; }
    data = d;
    if (!d) { clear(units); clear(groups); return; }
    const sums = unitSummaries(d.key, d.transcripts);
    if (!unitId || !sums.some(s => s.id === unitId)) unitId = (sums.find(s => !unitDone(s)) ?? sums[0])?.id ?? null;
    renderUnits(); renderGroups();
  }

  function pick(id: string): void {
    unitId = id;
    renderUnits(); renderGroups(); groups.scrollTop = 0;
  }

  function renderUnits(): void {
    clear(units);
    if (!data) return;
    const d = data, sums = unitSummaries(d.key, d.transcripts), p = progress(d.key, d.transcripts);
    const only = el('input', { type: 'checkbox', checked: onlyUnchecked, onchange: () => { onlyUnchecked = only.checked; renderUnits(); } });
    units.append(el('div', { class: 'filters' },
      el('div', {}, t('item.progress', { units: p.단위, unitsTotal: p.단위전체, pages: p.장, pagesTotal: p.장전체 })),
      el('label', {}, only, t('item.onlyUnchecked'))));
    const shown = sums.filter(s => !onlyUnchecked || !unitDone(s));
    if (!shown.length) { units.append(el('div', { class: 'unit-empty muted' }, t(sums.length ? 'item.allDone' : 'item.noUnits'))); return; }
    for (const s of shown) {
      const on = s.id === unitId, done = unitDone(s);
      units.append(el('button', { class: `unit${on ? ' active' : ''}${done ? ' done' : ''}`, 'aria-current': on ? 'true' : null, onclick: () => pick(s.id) },
        el('span', { class: 'line' }, el('strong', {}, s.id), el('span', { class: 'desc', title: s.설명 }, s.설명)),
        el('span', { class: 'meta' }, t('item.unitChecked', { done: s.확인, total: s.전체 }), done ? ' ✓' : null,
          s.갈림 ? el('span', { class: 'tag-warn', title: t('item.splitCountTitle') }, t('item.splitCount', { n: s.갈림 })) : null)));
    }
  }

  function renderGroups(): void {
    const scroll = groups.scrollTop; // 판정을 넣은 뒤 다시 그려도 보던 자리에 머문다
    clear(groups);
    if (!data) return;
    const d = data;
    if (!d.transcripts.length) { groups.append(el('div', { class: 'muted' }, t('item.noTranscripts'))); return; }
    const qty = d.key.정량.find(u => u.id === unitId), qual = d.key.정성.find(u => u.id === unitId);
    if (!qty && !qual) { groups.append(el('div', { class: 'muted' }, t('item.noUnits'))); return; }
    const u = (qty ?? qual)!;
    const labels = anonLabels(SALT, u.id, d.transcripts.map(x => x.page));
    const byPage = new Map(d.transcripts.map(x => [x.page, x]));
    groups.append(el('div', { class: 'muted' }, t('item.notice')), head(u, !!qty, d.transcripts.every(x => unitChecked(x, u.id))));
    if (qty) for (const g of sortGroups(groupAnswers(d.transcripts, qty.id))) groups.append(groupBox(qty, g, labels, byPage));
    else groups.append(el('div', { class: 'qual-list' }, ...[...labels].sort(([, a], [, b]) => a - b).map(([page, n]) => qualRow(qual!, byPage.get(page)!, n))));
    groups.scrollTop = scroll;
  }

  function head(u: QtyUnit | QualUnit, isQty: boolean, allChecked: boolean): HTMLElement {
    const 유형 = isQty ? (u as QtyUnit).유형 : '응답형';
    const cases = el('input', { type: 'checkbox', checked: deps.recordCases(), onchange: () => deps.setRecordCases(cases.checked) });
    return el('div', { class: 'ir-head' },
      el('div', { class: 'row' }, el('strong', { class: 'unit-id' }, u.id), 유형 ? el('span', { class: 'muted' }, t(`unit.${유형}`)) : null,
        unitPoints(u) === 1 ? null : el('span', { class: 'muted' }, t('review.points', { n: unitPoints(u) })),
        el('button', { class: 'primary', disabled: busy || allChecked, title: t('item.confirmAllTitle'), onclick: () => void send(u.id, data!.transcripts.map(x => ({ page: x.page }))) }, t('item.confirmAll')),
        isQty ? el('label', { title: t('item.recordCasesTitle') }, cases, t('item.recordCases')) : null),
      el('div', { class: 'ir-desc' }, u.설명),
      isQty ? el('div', { class: 'muted' }, keyLine(u as QtyUnit)) : null);
  }

  const verdictButtons = (current: Panjeong | null, title: 'item.groupVerdict' | 'item.rowVerdict', onPick: (v: Panjeong) => void): HTMLElement =>
    el('div', { class: 'verdicts', role: 'group' }, ...VERDICTS.map(v => el('button', { class: `v-${v}${v === current ? ' on' : ''}`, 'aria-pressed': String(v === current),
      disabled: busy, title: t(title), onclick: () => onPick(v) }, t(`verdict.${v}`))));

  const checkMark = (tr: Transcript, 단위: string): HTMLElement =>
    unitChecked(tr, 단위) ? el('span', { class: 'ok-text', title: t('item.checked') }, '✓') : el('span', { class: 'muted' }, t('item.unchecked'));

  function groupBox(u: QtyUnit, g: AnswerGroup, labels: Map<number, number>, byPage: Map<number, Transcript>): HTMLElement {
    const k = `${u.id}\u0000${g.정규}`, isOpen = open.has(k);
    const same = VERDICTS.find(v => g.판정[v] === g.장.length) ?? null;
    const status = g.확인 === g.장.length ? el('span', { class: 'ok-text' }, `✓ ${t('item.checked')}`)
      : g.확인 ? el('span', {}, t('item.unitChecked', { done: g.확인, total: g.장.length })) : el('span', { class: 'muted' }, t('item.unchecked'));
    const box = el('div', { class: `group${g.갈림 ? ' mixed' : ''}` },
      el('div', { class: 'group-head' },
        el('button', { class: 'twisty', 'aria-expanded': String(isOpen), title: t(isOpen ? 'item.collapse' : 'item.expand'), 'aria-label': t(isOpen ? 'item.collapse' : 'item.expand'),
          onclick: () => { if (isOpen) open.delete(k); else open.add(k); renderGroups(); } }, isOpen ? '▼' : '▶'),
        el('div', { class: 'answer' }, g.정규 ? g.대표 : el('span', { class: 'muted' }, t('item.emptyAnswer'))),
        el('div', { class: 'group-meta' }, el('span', {}, t('item.sheets', { n: g.장.length })),
          el('span', {}, VERDICTS.filter(v => g.판정[v]).map(v => `${t(`verdict.${v}`)} ${g.판정[v]}`).join(' · ')),
          g.갈림 ? el('span', { class: 'tag-warn', title: t('item.splitTitle') }, t('item.split')) : null, status),
        verdictButtons(same, 'item.groupVerdict', v => void send(u.id, g.장.map(page => ({ page, 판정: v }))))));
    if (!isOpen) return box;
    // 줄 순서와 번호는 장 번호가 아니라 익명 번호(단위마다 다른 해시 순)
    box.append(el('div', { class: 'group-rows' }, ...[...g.장].sort((a, b) => labels.get(a)! - labels.get(b)!).map(page => {
      const tr = byPage.get(page)!, v = tr.정량[u.id] ?? { 답: '', 판정: '빈칸' as Panjeong }, own = v.답.trim();
      return el('div', { class: 'answer-row' },
        el('span', { class: 'anon' }, t('item.answerN', { n: labels.get(page)! })),
        el('div', { class: 'answer' }, own === g.대표 ? '' : own), // 대표 답과 글자가 다를 때만 원래 글을 보인다
        checkMark(tr, u.id),
        verdictButtons(v.판정, 'item.rowVerdict', p => void send(u.id, [{ page, 판정: p }])));
    })));
    return box;
  }

  function qualRow(u: QualUnit, tr: Transcript, n: number): HTMLElement {
    const v = tr.정성[u.id] ?? { 응답: false, 답: '' };
    const cb = el('input', { type: 'checkbox', checked: v.응답, disabled: busy, onchange: () => void send(u.id, [{ page: tr.page, 응답: cb.checked }]) });
    return el('div', { class: 'answer-row' },
      el('span', { class: 'anon' }, t('item.answerN', { n })),
      el('div', { class: 'answer' }, v.답.trim() || el('span', { class: 'muted' }, t('item.emptyAnswer'))),
      el('label', {}, cb, t('review.responded')),
      checkMark(tr, u.id));
  }

  async function send(단위: string, 항목: UnitResultItem[]): Promise<void> {
    if (busy || !data) return;
    busy = true; renderGroups();
    try {
      const r = await api.setUnitResults(data.폴더, { 단위, 항목, 사례기록: deps.recordCases() });
      await deps.refresh(); // 다시 읽어 그린다. 알림 칸을 비우므로 안내는 그 뒤에
      if (r.엑셀오류) deps.notice.append(el('div', { class: 'band warn' }, t('review.savedExcelFailed', { error: r.엑셀오류 })));
      if (r.사례오류) deps.notice.append(el('div', { class: 'band warn' }, t('item.caseFailed', { error: r.사례오류 })));
      // 신원을 숨기는 화면이라 알림에도 장 번호 없이 수만 적는다
      if (!r.엑셀오류) showInfo(r.바뀐장수 ? [t('item.changed', { n: r.바뀐장수 }), r.사례수 ? t('item.casesRecorded', { n: r.사례수 }) : ''].join(' ').trim()
        : r.확인장수 ? t('item.confirmed', { n: r.확인장수 }) : t('item.nothingNew'));
    } catch (e) {
      showError((e as Error).message);
      await deps.refresh().catch(() => undefined); // 일부만 저장됐을 수 있어 디스크의 상태로 다시 그린다
    } finally { busy = false; renderGroups(); }
  }

  return { root, render };
}
