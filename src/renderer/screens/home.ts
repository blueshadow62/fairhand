import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { cliStatusText } from './settings.js';

/** 시작 화면: 무엇을 하는 프로그램인지, 지금 상태, 순서, 세트 목록. 세트를 누르면 문항 설정으로. */
export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, goTo, showError, showInfo } = ctx;
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

  async function renderStatus(): Promise<void> {
    clear(statusBox);
    const s = store.state.settings;
    const profile = s.프로필.find(p => p.id === s.사용중);
    const profileLine = el('div', {}, profile ? t('home.profile', { name: profile.이름, kind: profile.종류 === 'cli' ? 'Claude Code' : 'API' }) : t('home.profileNone'));
    const detail = el('div', { class: 'muted' }, profile ? t('home.checking') : '');
    statusBox.append(el('h3', {}, t('home.status')),
      el('div', {}, s.학기폴더 ? t('home.semester', { path: s.학기폴더 }) : t('home.semesterNone')),
      profileLine, detail);
    if (!profile) return;
    try {
      detail.textContent = profile.종류 === 'cli' ? cliStatusText(await api.cliStatus(profile.id))
        : (await api.secretView(profile.id)).저장됨 ? t('home.apiKeySaved') : t('home.apiKeyNone');
    } catch (e) { detail.textContent = (e as Error).message; }
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

  store.subscribe(() => { renderSets(); void renderStatus(); });
  renderSets(); void renderStatus();
}
