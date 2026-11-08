import type { SetInfo } from '../../shared/ipc.js';
import type { Ctx, Tab } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t } from '../lib/i18n.js';
import { makeGuard } from '../lib/screen-utils.js';
import { sameAsKind } from '../lib/badge.js';
import { nextStep, stages, type NextStep, type Stage } from '../lib/set-progress.js';
import { requestOpenSet } from './key.js';
import { cliStatusText, createDefaultSemester, showSettingsTab } from './settings.js';

/** 다음 할 일 단추가 갈 화면(엑셀은 화면 대신 파일을 연다) */
const NEXT_TAB: Record<Exclude<NextStep, 'excel'>, Tab> = { key: 'key', upload: 'run', transcribe: 'run', review: 'review' };

function stageText(x: Stage): string {
  switch (x.id) {
    case 'key': return t(x.done ? 'home.stage.key' : 'home.stage.keyTodo');
    case 'pages': return x.total ? t('home.stage.pages', { n: x.total }) : t('home.stage.noPages');
    case 'transcribe': return x.total ? t('home.stage.transcribe', { n: x.n, total: x.total }) : t('home.stage.transcribeNone');
    case 'review': return x.total ? t('home.stage.review', { n: x.n, total: x.total }) : t('home.stage.reviewNone');
  }
}

/** 시작 화면: 무엇을 하는 프로그램인지, 학기 현황판(세트마다 진행과 다음 할 일), 순서, 지금 상태 */
export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, goTo, showError, showInfo } = ctx;
  const guard = makeGuard(showError);
  const statusBox = el('div', { class: 'card' });
  const setsList = el('div');
  root.append(
    el('div', { class: 'home-head' }, el('h1', {}, t('home.title')), el('div', { class: 'muted' }, t('home.tagline'))),
    el('div', { class: 'card home-board' }, el('div', { class: 'row' }, el('h3', {}, t('home.board'))), setsList),
    el('div', { class: 'home-grid' },
      el('div', { class: 'card' }, el('h3', {}, t('home.steps')),
        el('div', { class: 'home-steps' },
          el('button', { class: 'primary', onclick: () => goTo('key') }, t('home.step.key')),
          el('button', { onclick: () => goTo('run') }, t('home.step.run')),
          el('button', { onclick: () => goTo('review') }, t('home.step.review')),
          el('button', { onclick: () => goTo('settings') }, t('home.step.settings')))),
      statusBox));

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

  /**
   * 세트를 열고 tab 화면으로 간다. 세트를 여는 일은 문항 설정 화면이 하므로(store.current도 그 화면이 정한다), 그 화면이 아직 없으면
   * 먼저 그 화면으로 가서 그린다. 시작 화면에는 떠나기 확인이 없어 goTo가 바로(동기) 그린다
   */
  function openSet(폴더: string, tab: Tab): void {
    const req = { 폴더, then: tab === 'key' ? undefined : () => goTo(tab) };
    if (tab === 'key') goTo('key');
    if (!requestOpenSet(req)) { goTo('key'); requestOpenSet(req); }
  }

  function setRow(s: SetInfo): HTMLElement {
    const all = stages(s), now = all.find(x => !x.done), next = nextStep(s);
    const nextBtn = el('button', { class: 'primary', title: t(`home.next.${next}.hint`, { n: next === 'transcribe' ? s.미전사수 : s.전사수 - s.확인수 }),
      onclick: () => {
        if (next !== 'excel') { openSet(s.폴더, NEXT_TAB[next]); return; }
        void guard(async () => {
          nextBtn.disabled = true;
          try { showInfo(t('home.excelOpened', { path: await api.openResult(s.폴더) })); } finally { nextBtn.disabled = false; }
        });
      } }, t(`home.next.${next}`));
    return el('div', { class: 'home-set' },
      el('div', { class: 'home-set-main' },
        el('button', { class: 'home-set-title', title: t('home.openInKey'), onclick: () => openSet(s.폴더, 'key') }, s.key.글),
        el('div', { class: 'muted' }, t('home.setTarget', { grade: s.key.대상.학년, classes: s.key.대상.반.join('·') })),
        el('div', { class: 'home-stages' }, ...all.map(x => el('span', { class: `stage${x.done ? ' done' : x === now ? ' now' : ''}` },
          x.done ? el('span', { class: 'mark', 'aria-hidden': 'true' }, '✓') : null, stageText(x))))),
      nextBtn);
  }

  function renderSets(): void {
    clear(setsList);
    const sets = store.state.sets;
    if (!sets.length) {
      setsList.append(el('div', { class: 'muted' }, t('home.noSets')),
        el('div', { class: 'row' }, el('button', { onclick: async () => {
          try { const { 폴더 } = await api.createSampleSet(); await store.refreshSets(); showInfo(t('home.sampleAdded', { name: 폴더 })); }
          catch (e) { showError((e as Error).message); }
        } }, t('home.sample'))),
        el('div', { class: 'muted' }, t('home.sampleHelp')));
      return;
    }
    setsList.append(el('div', { class: 'home-sets' }, ...sets.map(setRow)));
  }

  // CLI 상태 점검은 외부 프로그램을 띄우므로 프로필·학기 폴더가 바뀔 때만(세트 목록·저장마다 돌지 않게)
  const statusKey = () => JSON.stringify([store.state.settings.사용중, store.state.settings.프로필, store.state.settings.학기폴더]);
  let lastStatusKey = statusKey();
  store.subscribe(() => { renderSets(); const k = statusKey(); if (k !== lastStatusKey) { lastStatusKey = k; void renderStatus(); } });
  // 검토·채점 실행에서 전사와 확인이 바뀌어도 세트 목록은 다시 읽지 않는다. 이 화면이 다시 보일 때 새로 읽어 현황을 맞춘다
  new MutationObserver(() => { if (!root.classList.contains('hidden') && store.state.settings.학기폴더) void store.refreshSets().catch(() => undefined); })
    .observe(root, { attributes: true, attributeFilter: ['class'] });
  renderSets(); void renderStatus();
}
