import { app, BrowserWindow, dialog, Menu, protocol, safeStorage, session, shell } from 'electron';
import { menuTemplate } from './menu.js';
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
  const applyMenu = () => Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(settingsCache.언어, {
    openGuide: () => { void shell.openExternal('https://github.com/blueshadow62/geulnun#readme'); },
    openPrivacy: () => { void shell.openExternal('https://github.com/blueshadow62/geulnun/blob/main/PRIVACY.md'); },
    showAbout: () => { void dialog.showMessageBox({ title: '글눈', message: `글눈 ${app.getVersion()}`, detail: settingsCache.언어 === 'en' ? 'Transcribes and grades handwritten essay answer sheets. Apache-2.0.' : '손글씨 서·논술형 답안지 전사·채점 도구. Apache-2.0.' }); },
  })));
  settings.save = async (patch) => { const before = settingsCache.언어; settingsCache = await origSave(patch); if (settingsCache.언어 !== before) applyMenu(); return settingsCache; }; // 그림 프로토콜이 학기 폴더를 동기로 알아야 해서
  applyMenu();
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
  win.on('closed', () => { bridge.cancel(); win = null; });
  await win.loadURL(`${APP_SCHEME}://app/index.html`);
});
app.on('window-all-closed', () => app.quit());
