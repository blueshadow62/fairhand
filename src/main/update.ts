import type { Language, UpdateStatus } from '../shared/ipc.js';

export type UpdateEvent = { type: 'check' } | { type: 'none'; version: string } | { type: 'available'; version: string } | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string } | { type: 'error'; message: string } | { type: 'off' } | { type: 'on' };

export function reduce(prev: UpdateStatus, ev: UpdateEvent): UpdateStatus {
  if (prev.kind === 'disabled' && (prev.reason === 'dev' || prev.reason === 'manual')) return prev;
  if (ev.type === 'off') return { kind: 'disabled', reason: 'off' };
  if (ev.type === 'on') return prev.kind === 'disabled' ? { kind: 'idle' } : prev;
  if (prev.kind === 'disabled') return prev;
  // 받아 둔 새 버전은 사용자가 '다시 시작해 적용'을 누르기 전까지 그대로 둔다(다음 확인이 상태를 덮지 않게)
  if (prev.kind === 'downloaded' && ev.type !== 'downloaded' && ev.type !== 'error') return prev;
  switch (ev.type) {
    case 'check': return { kind: 'checking' };
    case 'none': return { kind: 'none', version: ev.version };
    case 'available': return { kind: 'available', version: ev.version };
    case 'progress': return { kind: 'downloading', percent: Math.floor(ev.percent) };
    case 'downloaded': return { kind: 'downloaded', version: ev.version };
    case 'error': return { kind: 'error', message: ev.message };
  }
}

/** 로그용 한 줄. 화면은 같은 뜻의 i18n 키(settings.update.status.*)를 쓴다(렌더러는 src/main을 import하지 않는다) */
export function statusText(s: UpdateStatus, lang: Language): string {
  const ko = lang === 'ko';
  switch (s.kind) {
    case 'disabled': return s.reason === 'dev' ? (ko ? '개발 실행에서는 확인하지 않습니다' : 'Not checked in a development run')
      : s.reason === 'manual' ? (ko ? '맥 시험판은 자동 업데이트가 없습니다' : 'The Mac beta does not update automatically')
      : (ko ? '자동 확인이 꺼져 있습니다' : 'Automatic checking is off');
    case 'idle': return ko ? '아직 확인하지 않았습니다' : 'Not checked yet';
    case 'checking': return ko ? '확인 중…' : 'Checking…';
    case 'none': return ko ? `최신 버전입니다(${s.version})` : `Up to date (${s.version})`;
    case 'available': return ko ? `새 버전 ${s.version}을 받는 중…` : `Downloading version ${s.version}…`;
    case 'downloading': return ko ? `새 버전을 받는 중… ${s.percent}%` : `Downloading the new version… ${s.percent}%`;
    case 'downloaded': return ko ? `새 버전 ${s.version}을 받았습니다. 다시 시작하면 적용됩니다` : `Version ${s.version} is ready. Restart to apply`;
    case 'error': return ko ? '업데이트를 확인하지 못했습니다' : 'Could not check for updates';
  }
}

type Timers = { setTimeout: typeof setTimeout; setInterval: typeof setInterval; clearTimeout: typeof clearTimeout; clearInterval: typeof clearInterval };

/** 시작 firstDelayMs 뒤 한 번, 그 뒤 intervalMs마다. 돌려준 함수로 멈춘다 */
export function scheduleChecks(check: () => void, opts: { firstDelayMs: number; intervalMs: number } & Timers): () => void {
  const a = opts.setTimeout(check, opts.firstDelayMs);
  const b = opts.setInterval(check, opts.intervalMs);
  return () => { opts.clearTimeout(a); opts.clearInterval(b); };
}

export interface Updater { check(): Promise<void>; install(): void; status(): UpdateStatus; setEnabled(on: boolean): void; stop(): void }

const FIRST_DELAY_MS = 10_000, INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * electron-updater 연결. 개발 실행·꺼짐이면 GitHub에 접속하지 않고, 오류는 상태와 로그로만 남긴다(창을 띄우지 않음).
 * 맥은 앱에 Apple 서명이 있어야 자동 업데이트가 설치되는데 시험판은 서명이 없어, 확인하지 않고 릴리스 페이지로 안내한다(manual).
 */
export function startUpdater(deps: { enabled: () => boolean; packaged: boolean; platform?: NodeJS.Platform; onStatus(s: UpdateStatus): void; log(level: 'warn' | 'info', ...p: unknown[]): void }): Updater {
  const manual = (deps.platform ?? process.platform) === 'darwin';
  let status: UpdateStatus = !deps.packaged ? { kind: 'disabled', reason: 'dev' } : manual ? { kind: 'disabled', reason: 'manual' }
    : deps.enabled() ? { kind: 'idle' } : { kind: 'disabled', reason: 'off' };
  const set = (ev: UpdateEvent) => {
    const next = reduce(status, ev);
    if (JSON.stringify(next) === JSON.stringify(status)) return;
    status = next; deps.onStatus(status);
  };
  const fail = (e: unknown) => {
    const message = String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 200); // 응답 머리글까지 붙는 긴 메시지를 한 줄로
    if (status.kind === 'error' && status.message === message) return; // 'error' 이벤트와 거절된 약속이 같은 오류를 두 번 알린다
    deps.log('warn', '[update]', message);
    set({ type: 'error', message });
  };
  if (!deps.packaged || manual) return { check: async () => undefined, install: () => undefined, status: () => status, setEnabled: () => undefined, stop: () => undefined };

  type AU = import('electron-updater').AppUpdater;
  let au: AU | null = null;
  const load = async (): Promise<AU> => {
    if (au) return au;
    const m = await import('electron-updater');
    const u = (m as unknown as { default: { autoUpdater: AU } }).default.autoUpdater; // CommonJS의 getter라 default로 꺼낸다
    // 서명이 없어 발행자를 확인할 수 없으므로 받아 두기만 하고, 설치는 사용자가 '다시 시작해 적용'을 누를 때만
    u.autoDownload = true; u.autoInstallOnAppQuit = false; u.logger = null;
    u.on('checking-for-update', () => set({ type: 'check' }));
    u.on('update-available', i => set({ type: 'available', version: i.version }));
    u.on('update-not-available', i => set({ type: 'none', version: i.version }));
    u.on('download-progress', p => set({ type: 'progress', percent: p.percent }));
    u.on('update-downloaded', i => { deps.log('info', `[update] ${i.version} 받음`); set({ type: 'downloaded', version: i.version }); });
    u.on('error', fail);
    return (au = u);
  };
  const check = async () => {
    if (!deps.enabled()) { set({ type: 'off' }); return; }
    set({ type: 'on' });
    if (['checking', 'available', 'downloading', 'downloaded'].includes(status.kind)) return;
    try { await (await load()).checkForUpdates(); } catch (e) { fail(e); }
  };
  const stop = scheduleChecks(() => void check(), { firstDelayMs: FIRST_DELAY_MS, intervalMs: INTERVAL_MS, setTimeout, setInterval, clearTimeout, clearInterval });
  return {
    check, status: () => status, stop,
    // 조용히(/S) 설치하고 끝나면 다시 띄운다. 기본값으로 부르면 설치 마법사가 떠서 사용자가 눌러야 한다(0.2.2까지의 문제)
    install: () => { if (status.kind === 'downloaded') au?.quitAndInstall(true, true); },
    setEnabled: on => set({ type: on ? 'on' : 'off' }),
  };
}
