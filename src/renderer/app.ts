import type { SetInfo, Settings, Theme, UpdateStatus } from '../shared/ipc.js';
import { api } from './lib/api.js';
import { badgeLabel, kindKey, modelLabel } from './lib/badge.js';
import { readCollapsed, writeCollapsed } from './lib/collapse.js';
import { el } from './lib/el.js';
import { setLanguage, t } from './lib/i18n.js';
import type { SettingsTab } from './lib/settings-form.js';
import * as homeScreen from './screens/home.js';
import * as keyScreen from './screens/key.js';
import * as reviewScreen from './screens/review.js';
import * as runScreen from './screens/run.js';
import * as settingsScreen from './screens/settings.js';

export interface AppState { settings: Settings; sets: SetInfo[]; current: string | null /* 세트 폴더 */ }
export type Tab = 'home' | 'key' | 'run' | 'review' | 'settings';

type Listener = (s: AppState) => void;
const listeners = new Set<Listener>();
export const store = {
  state: { settings: null as unknown as Settings, sets: [], current: null } as AppState,
  subscribe(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); },
  update(patch: Partial<AppState>): void { Object.assign(store.state, patch); for (const fn of listeners) fn(store.state); },
  /** 학기 폴더의 세트 목록을 다시 읽는다. 학기 폴더가 없으면 빈 목록 */
  async refreshSets(): Promise<void> { store.update({ sets: store.state.settings.학기폴더 ? await api.listSets() : [] }); },
};

export interface Ctx { store: typeof store; showError(message: string): void; showInfo(message: string): void; goTo(tab: Tab): void; setLeaveGuard(fn: () => Promise<boolean>): void }

/** 언어를 바꾸면 화면을 통째로 다시 그린다. 돌아올 탭을 세션 저장소에 적어 두고 reload */
const TAB_AFTER_RELOAD = 'geulnun.tabAfterReload';
export function reloadTo(tab: Tab): void {
  try { sessionStorage.setItem(TAB_AFTER_RELOAD, tab); } catch { /* 저장 못 하면 기본 탭으로 */ }
  location.reload();
}
function takeTabAfterReload(): Tab | null {
  try { const v = sessionStorage.getItem(TAB_AFTER_RELOAD); sessionStorage.removeItem(TAB_AFTER_RELOAD); return v as Tab | null; } catch { return null; }
}

/** 화면 색은 <html data-theme>로 바꾼다(styles.css). 기준은 설정 파일이고, 로컬 저장소 사본은
 *  다음 실행 때 설정을 받기 전에 먼저 칠해 어두운 화면이 밝게 번쩍이지 않게 하는 데만 쓴다 */
const THEME_KEY = 'geulnun.theme';
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* 못 적어도 설정 파일이 기준 */ }
}
function applyCachedTheme(): void {
  try { const v = localStorage.getItem(THEME_KEY); if (v) document.documentElement.dataset.theme = v; } catch { /* 없으면 기본 색 */ }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(kind: 'error' | 'info', message: string): void {
  const t = document.getElementById('toast')!;
  t.className = kind; t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 8000 : 5000);
}
const showError = (m: string) => toast('error', m);
const showInfo = (m: string) => toast('info', m);

const TABS: { id: Tab; mod: { mount(root: HTMLElement, ctx: Ctx): void } }[] = [
  { id: 'home', mod: homeScreen },
  { id: 'key', mod: keyScreen },
  { id: 'run', mod: runScreen },
  { id: 'review', mod: reviewScreen },
  { id: 'settings', mod: settingsScreen },
];

/**
 * 설정의 업데이트 칸을 화면 가운데로(정보·업데이트 탭을 연 뒤에 부른다). 업데이트 칸은 상태를 받은 뒤에 그려 높이가 바뀌므로
 * 잠깐(1.5초) 동안은 바뀔 때마다 다시 맞춘다. 떠나기 확인에서 머무르기를 골랐으면 아무것도 하지 않는다
 */
function revealUpdateBox(): void {
  const screen = document.querySelector('.screen[data-tab="settings"]:not(.hidden)');
  const box = screen?.querySelector('[data-section="update"]');
  if (!screen || !box) return;
  const show = () => box.scrollIntoView({ block: 'center' });
  show();
  const ro = new ResizeObserver(show); ro.observe(screen);
  setTimeout(() => ro.disconnect(), 1500);
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function start(): Promise<void> {
  applyCachedTheme();
  window.addEventListener('unhandledrejection', e => showError(errText(e.reason)));
  window.addEventListener('error', e => showError(errText(e.error ?? e.message)));
  const root = document.getElementById('app')!;
  const current = el('span', { class: 'current' });
  const tabs = el('nav', { id: 'tabs' });
  const main = el('main', { id: 'main' });
  const version = el('span', { class: 'version' });
  void api.version().then(v => { version.textContent = `v${v}`; }).catch(() => undefined);
  // 버전 옆 알림: 설정 화면에 가지 않아도 새 버전이 있는 줄 알게. 누르면 설정의 정보·업데이트 탭을 열고 업데이트 칸으로
  const updatePill = el('button', { class: 'update-pill hidden', onclick: () => void openSettings('about').then(shown => { if (shown) revealUpdateBox(); }) });
  const renderUpdatePill = (s: UpdateStatus) => {
    const text = s.kind === 'available' ? t('app.update.available') : s.kind === 'downloading' ? t('app.update.downloading', { percent: s.percent })
      : s.kind === 'downloaded' ? t('app.update.ready') : '';
    updatePill.textContent = text; updatePill.title = 'version' in s ? t('app.update.hint', { version: s.version }) : '';
    updatePill.classList.toggle('hidden', !text);
  };
  root.append(el('header', { id: 'top' }, el('span', { class: 'brand' }, '글눈', version), updatePill, current), tabs, main, el('div', { id: 'toast', class: 'hidden' }));

  store.update({ settings: await api.getSettings() });
  setLanguage(store.state.settings.언어); // 이 뒤의 t()가 모두 이 언어로 나온다
  api.onUpdate(renderUpdatePill);
  void api.updateStatus().then(renderUpdatePill).catch(() => undefined);
  applyTheme(store.state.settings.화면색);
  store.subscribe(s => { current.textContent = s.current ? t('common.set', { name: s.current }) : t('app.noSet'); });
  store.update({});

  const mounted = new Map<Tab, HTMLElement>();
  const buttons = new Map<Tab, HTMLButtonElement>();
  const guards = new Map<Tab, () => Promise<boolean>>();
  let currentTab: Tab | null = null, leaving = false;
  const ctx: Ctx = { store, showError, showInfo, goTo, setLeaveGuard: () => undefined };
  function goTo(tab: Tab): void { void goToAsync(tab); }
  async function goToAsync(tab: Tab): Promise<void> {
    if (tab === currentTab || leaving) return;
    const guard = currentTab ? guards.get(currentTab) : undefined;
    if (guard) { leaving = true; try { if (!(await guard())) return; } finally { leaving = false; } }
    currentTab = tab;
    for (const [id, b] of buttons) b.classList.toggle('active', id === tab);
    for (const [id, node] of mounted) node.classList.toggle('hidden', id !== tab);
    if (!mounted.has(tab)) {
      const node = el('div', { class: 'screen', 'data-tab': tab });
      main.append(node); mounted.set(tab, node);
      TABS.find(t => t.id === tab)!.mod.mount(node, { ...ctx, setLeaveGuard: fn => guards.set(tab, fn) });
    }
  }
  /** 설정 화면을 열고 그 안의 탭을 고른다. 떠나기 확인에서 머무르기를 골라 설정이 보이지 않으면 false */
  async function openSettings(tab: SettingsTab): Promise<boolean> {
    await goToAsync('settings');
    if (currentTab !== 'settings') return false;
    settingsScreen.showSettingsTab(tab);
    return true;
  }
  for (const tab of TABS) { const b = el('button', { onclick: () => goTo(tab.id) }, t(`app.tab.${tab.id}`)); buttons.set(tab.id, b); tabs.append(b); }

  // 왼쪽 메뉴 맨 아래: 지금 쓰는 AI 프로필과 상태(이음오피스의 'Claude · 연결됨' 표시처럼). 누르면 설정의 AI 프로필 탭으로
  const badgeName = el('div', { class: 'name' }), badgeStatus = el('div', { class: 'status' });
  tabs.append(el('button', { class: 'badge', title: t('app.badge.hint'), onclick: () => void openSettings('ai') }, el('span', { class: 'dot' }), el('div', {}, badgeName, badgeStatus)));
  let badgeSeq = 0;
  async function renderBadge(): Promise<void> {
    const seq = ++badgeSeq;
    const s = store.state.settings;
    const p = s.프로필.find(x => x.id === s.사용중);
    if (!p) { badgeName.textContent = t('app.badge.none'); badgeStatus.textContent = t('app.badge.hint'); return; }
    badgeName.textContent = badgeLabel(p.이름, t(kindKey(p.종류)), modelLabel(p, t('app.badge.codexDefault')));
    badgeStatus.textContent = t('home.checking');
    try {
      const text = p.종류 === 'cli' || p.종류 === 'codex' ? settingsScreen.cliStatusText(await api.cliStatus(p.id)) : (await api.secretView(p.id)).저장됨 ? t('home.apiKeySaved') : t('home.apiKeyNone');
      if (seq === badgeSeq) badgeStatus.textContent = text;
    } catch (e) { if (seq === badgeSeq) badgeStatus.textContent = (e as Error).message; }
  }
  let lastProfileKey = '';
  store.subscribe(s => { const k = JSON.stringify([s.settings.사용중, s.settings.프로필]); if (k !== lastProfileKey) { lastProfileKey = k; void renderBadge(); } });
  void renderBadge();

  // 좁은 창(1024 등)에서 검토 그림 칸을 넓히려고 왼쪽 메뉴를 숨긴다. 단추는 늘 머리글 맨 앞에 두고, 접은 상태는 다음 실행에도 기억한다(기본은 펼침)
  const NAV_PREF = 'geulnun.navCollapsed';
  const navBtn = el('button', { class: 'nav-toggle', 'aria-controls': 'tabs', onclick: () => { const on = !root.classList.contains('nav-collapsed'); showNav(on); writeCollapsed(NAV_PREF, on); } });
  function showNav(collapsed: boolean): void {
    root.classList.toggle('nav-collapsed', collapsed);
    navBtn.title = t(collapsed ? 'app.nav.expand' : 'app.nav.collapse');
    navBtn.setAttribute('aria-label', navBtn.title);
    navBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  root.querySelector('#top')?.prepend(navBtn);
  showNav(readCollapsed(NAV_PREF));

  const back = takeTabAfterReload();
  if (store.state.settings.학기폴더) {
    try { await store.refreshSets(); } catch (e) { showError(errText(e)); }
  }
  // 처음 실행(학기 폴더 없음)도 시작 화면으로 간다. 전에는 설정 화면으로 바로 가서 낯선 낱말이 한꺼번에 보였다.
  // 시작 화면의 처음 실행 안내가 학기 폴더 → AI 도구 → 샘플 차례로 안내한다
  goTo(back ?? 'home');
}

start().catch(e => showError(errText(e)));
