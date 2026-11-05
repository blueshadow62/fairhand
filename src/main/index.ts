import { app, BrowserWindow, Menu, protocol, safeStorage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineBridge } from './engine-bridge.js';
import { registerIpc } from './ipc.js';
import { APP_SCHEME, CSP, IMG_SCHEME, registerProtocols } from './protocols.js';
import { SecretStore } from './secrets.js';
import { SettingsStore } from './settings.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // dist/src/main → 저장소 루트
if (process.env.GEULNUN_USER_DATA) app.setPath('userData', path.resolve(process.env.GEULNUN_USER_DATA)); // 개발용: 설정을 local/에

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: IMG_SCHEME, privileges: { standard: true, secure: true } },
]);

let win: BrowserWindow | null = null;

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const secrets = new SecretStore(path.join(userData, 'secrets.json'), safeStorage);
  const bridge = new EngineBridge({ settings, secrets, version: app.getVersion() });
  let settingsCache = await settings.load();
  const origSave = settings.save.bind(settings);
  settings.save = async (patch) => { settingsCache = await origSave(patch); return settingsCache; }; // 그림 프로토콜이 학기 폴더를 동기로 알아야 해서
  // 창 위 기본 메뉴(File·Edit…)는 쓰지 않는다. 설정·언어·정보는 프로그램 안 '설정' 화면에 있다. 복사·붙여넣기는 Windows가 메뉴 없이도 처리한다.
  Menu.setApplicationMenu(null);
  registerProtocols(protocol, { html: path.join(ROOT, 'src', 'renderer'), dist: path.join(ROOT, 'dist', 'src'), pdfjs: path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build') },
    () => settingsCache.학기폴더);
  registerIpc({ bridge, settings, secrets, version: app.getVersion(), window: () => win });

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => cb({ responseHeaders: { ...details.responseHeaders,
    'Content-Security-Policy': [CSP] } }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  win = new BrowserWindow({
    width: 1280, height: 860, title: '글눈',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(ROOT, 'dist-preload', 'preload.cjs') },
  });
  // 렌더러의 경고·오류(CSP 위반 포함)를 메인 로그로: 개발자 도구 없이도 확인할 수 있게
  win.webContents.on('console-message', (e) => { if (e.level === 'warning' || e.level === 'error') console.error(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // 메뉴가 없어도 개발자 도구는 F12로(문제 보고용)
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools(); });
  win.on('closed', () => { bridge.cancel(); win = null; });
  await win.loadURL(`${APP_SCHEME}://app/index.html`);
});
app.on('window-all-closed', () => app.quit());
