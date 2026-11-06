import type { SetInfo, Settings } from '../shared/ipc.js';
import { api } from './lib/api.js';
import { el } from './lib/el.js';
import { setLanguage, t } from './lib/i18n.js';
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

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function start(): Promise<void> {
  window.addEventListener('unhandledrejection', e => showError(errText(e.reason)));
  window.addEventListener('error', e => showError(errText(e.error ?? e.message)));
  const root = document.getElementById('app')!;
  const current = el('span', { class: 'current' });
  const tabs = el('nav', { id: 'tabs' });
  const main = el('main', { id: 'main' });
  root.append(el('header', { id: 'top' }, el('span', { class: 'brand' }, '글눈'), current), tabs, main, el('div', { id: 'toast', class: 'hidden' }));

  store.update({ settings: await api.getSettings() });
  setLanguage(store.state.settings.언어); // 이 뒤의 t()가 모두 이 언어로 나온다
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
  for (const tab of TABS) { const b = el('button', { onclick: () => goTo(tab.id) }, t(`app.tab.${tab.id}`)); buttons.set(tab.id, b); tabs.append(b); }

  const back = takeTabAfterReload();
  if (store.state.settings.학기폴더) {
    try { await store.refreshSets(); } catch (e) { showError(errText(e)); }
    goTo(back ?? 'home');
  } else {
    goTo('settings');
    showInfo(t('app.firstRun'));
  }
}

start().catch(e => showError(errText(e)));
