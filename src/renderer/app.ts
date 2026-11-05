import type { SetInfo, Settings } from '../shared/ipc.js';
import { api } from './lib/api.js';
import { el } from './lib/el.js';
import * as keyScreen from './screens/key.js';
import * as reviewScreen from './screens/review.js';
import * as runScreen from './screens/run.js';
import * as settingsScreen from './screens/settings.js';

export interface AppState { settings: Settings; sets: SetInfo[]; current: string | null /* 세트 폴더 */ }
export type Tab = 'key' | 'run' | 'review' | 'settings';

type Listener = (s: AppState) => void;
const listeners = new Set<Listener>();
export const store = {
  state: { settings: null as unknown as Settings, sets: [], current: null } as AppState,
  subscribe(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); },
  update(patch: Partial<AppState>): void { Object.assign(store.state, patch); for (const fn of listeners) fn(store.state); },
  /** 학기 폴더의 세트 목록을 다시 읽는다. 학기 폴더가 없으면 빈 목록 */
  async refreshSets(): Promise<void> { store.update({ sets: store.state.settings.학기폴더 ? await api.listSets() : [] }); },
};

export interface Ctx { store: typeof store; showError(message: string): void; showInfo(message: string): void; goTo(tab: Tab): void }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(kind: 'error' | 'info', message: string): void {
  const t = document.getElementById('toast')!;
  t.className = kind; t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 8000 : 5000);
}
const showError = (m: string) => toast('error', m);
const showInfo = (m: string) => toast('info', m);

const TABS: { id: Tab; 이름: string; mod: { mount(root: HTMLElement, ctx: Ctx): void } }[] = [
  { id: 'key', 이름: '문항 설정', mod: keyScreen },
  { id: 'run', 이름: '채점 실행', mod: runScreen },
  { id: 'review', 이름: '검토', mod: reviewScreen },
  { id: 'settings', 이름: '설정', mod: settingsScreen },
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
  store.subscribe(s => { current.textContent = s.current ? `세트: ${s.current}` : '세트를 고르지 않음'; });
  store.update({});

  const mounted = new Map<Tab, HTMLElement>();
  const buttons = new Map<Tab, HTMLButtonElement>();
  const ctx: Ctx = { store, showError, showInfo, goTo };
  function goTo(tab: Tab): void {
    for (const [id, b] of buttons) b.classList.toggle('active', id === tab);
    for (const [id, node] of mounted) node.classList.toggle('hidden', id !== tab);
    if (!mounted.has(tab)) {
      const node = el('div', { class: 'screen', 'data-tab': tab });
      main.append(node); mounted.set(tab, node);
      TABS.find(t => t.id === tab)!.mod.mount(node, ctx);
    }
  }
  for (const t of TABS) { const b = el('button', { onclick: () => goTo(t.id) }, t.이름); buttons.set(t.id, b); tabs.append(b); }

  if (store.state.settings.학기폴더) {
    try { await store.refreshSets(); } catch (e) { showError(errText(e)); }
    goTo('key');
  } else {
    goTo('settings');
    showInfo('처음 실행입니다. 학기 폴더를 고르세요.');
  }
}

start().catch(e => showError(errText(e)));
