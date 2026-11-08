import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { makeGuard } from '../lib/screen-utils.js';
import { sameAsKind } from '../lib/badge.js';
import { cliStatusText, createDefaultSemester, showSettingsTab } from './settings.js';

/** 시작 화면: 무엇을 하는 프로그램인지, 지금 상태, 순서, 세트 목록. 세트를 누르면 문항 설정으로. */
export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, goTo, showError, showInfo } = ctx;
  const guard = makeGuard(showError);
  const statusBox = el('div', { class: 'card' });
  const setsBox = el('div', { class: 'card' });
  root.append(
    el('div', { class: 'home-head' }, el('h1', {}, t('home.title')), el('div', { class: 'muted' }, t('home.tagline'))),
    el('div', { class: 'band info' }, t('home.notice')),
    el('div', { class: 'home-grid' },
      el('div', { class: 'card' }, el('h3', {}, t('home.steps')),
        el('div', { class: 'home-steps' },
          el('button', { class: 'primary', onclick: () => goTo('key') }, t('home.step.key')),
          el('button', { onclick: () => goTo('run') }, t('home.step.run')),
          el('button', { onclick: () => goTo('review') }, t('home.step.review')),
          el('button', { onclick: () => goTo('settings') }, t('home.step.settings')))),
      statusBox),
    setsBox);

  let statusSeq = 0;
  async function renderStatus(): Promise<void> {
    const seq = ++statusSeq;
    clear(statusBox);
    const s = store.state.settings;
    const profile = s.프로필.find(p => p.id === s.사용중);
    const kind = !profile ? '' : profile.종류 === 'cli' ? 'Claude Code' : profile.종류 === 'codex' ? 'Codex' : profile.종류 === 'gemini' ? 'Gemini API' : profile.종류 === 'openai' ? 'OpenAI API' : 'API';
    const profileLine = el('div', {}, !profile ? t('home.profileNone')
      : sameAsKind(profile.이름, kind) ? t('home.profileKind', { kind }) : t('home.profile', { name: profile.이름.trim(), kind }));
    const detail = el('div', { class: 'muted' }, profile ? t('home.checking') : '');
    // 처음 쓰는 사람이 설정 화면을 찾아가지 않아도 되게. 만들면 학기 폴더가 바뀌어 상태를 다시 그리므로 단추는 저절로 사라진다
    const makeBtn = el('button', { class: 'primary', onclick: () => guard(async () => {
      makeBtn.disabled = true;
      try { showInfo(t('settings.defaultMade', { path: await createDefaultSemester(store) })); } finally { makeBtn.disabled = false; }
    }) }, t('settings.makeDefault'));
    statusBox.append(el('h3', {}, t('home.status')),
      el('div', {}, s.학기폴더 ? t('home.semester', { path: s.학기폴더 }) : t('home.semesterNone')),
      // 시작 화면에는 떠나기 확인이 없어 goTo가 설정 화면을 바로(동기) 그린다. 그다음 학기 폴더를 고르는 기본 탭을 고른다
      ...(s.학기폴더 ? [] : [el('div', { class: 'row' }, makeBtn, el('button', { onclick: () => { goTo('settings'); showSettingsTab('basic'); } }, t('home.openSettings')))]),
      profileLine, detail);
    if (!profile) return;
    try {
      const text = profile.종류 === 'cli' || profile.종류 === 'codex' ? cliStatusText(await api.cliStatus(profile.id))
        : (await api.secretView(profile.id)).저장됨 ? t('home.apiKeySaved') : t('home.apiKeyNone');
      if (seq === statusSeq) detail.textContent = text;
    } catch (e) { if (seq === statusSeq) detail.textContent = (e as Error).message; }
  }

  function renderSets(): void {
    clear(setsBox);
    setsBox.append(el('h3', {}, t('home.recent')));
    const sets = store.state.sets;
    if (!sets.length) {
      setsBox.append(el('div', { class: 'muted' }, t('home.noSets')),
        el('div', { class: 'row' }, el('button', { onclick: async () => {
          try { const { 폴더 } = await api.createSampleSet(); await store.refreshSets(); showInfo(t('home.sampleAdded', { name: 폴더 })); }
          catch (e) { showError((e as Error).message); }
        } }, t('home.sample'))),
        el('div', { class: 'muted' }, t('home.sampleHelp')));
      return;
    }
    const list = el('div', { class: 'setlist home-sets' });
    for (const s of sets) {
      list.append(el('button', { onclick: () => { goTo('key'); /* 먼저 화면을 만들고(동기) 그다음 열라고 알린다 */ window.dispatchEvent(new CustomEvent('geulnun:open-set', { detail: s.폴더 })); } },
        el('div', {}, s.key.글),
        el('div', { class: 'muted' }, t('home.setLine', { grade: s.key.대상.학년, classes: s.key.대상.반.join('·'), pages: s.쪽수, done: s.전사수, confirmed: s.key.확인?.완료 ? t('home.confirmed') : t('home.unconfirmed') }))));
    }
    setsBox.append(list);
  }

  // CLI 상태 점검은 외부 프로그램을 띄우므로 프로필·학기 폴더가 바뀔 때만(세트 목록·저장마다 돌지 않게)
  const statusKey = () => JSON.stringify([store.state.settings.사용중, store.state.settings.프로필, store.state.settings.학기폴더]);
  let lastStatusKey = statusKey();
  store.subscribe(() => { renderSets(); const k = statusKey(); if (k !== lastStatusKey) { lastStatusKey = k; void renderStatus(); } });
  renderSets(); void renderStatus();
}
