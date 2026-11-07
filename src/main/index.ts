import { app, BrowserWindow, Menu, protocol, safeStorage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineBridge } from './engine-bridge.js';
import { maskJpegNative } from './mask.js';
import { registerIpc } from './ipc.js';
import { installLog } from './log.js';
import { APP_SCHEME, CSP, IMG_SCHEME, registerProtocols } from './protocols.js';
import { SecretStore } from './secrets.js';
import { SettingsStore } from './settings.js';
import { startUpdater } from './update.js';
import { SAMPLE_DIR } from './sample.js';
import { CHANNELS } from '../shared/ipc.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // dist/src/main → 저장소 루트
if (process.env.GEULNUN_USER_DATA) app.setPath('userData', path.resolve(process.env.GEULNUN_USER_DATA)); // 개발용: 설정을 local/에

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: IMG_SCHEME, privileges: { standard: true, secure: true } },
]);

let win: BrowserWindow | null = null;

const APP_URL = `${APP_SCHEME}://app/index.html`;

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const log = installLog(path.join(userData, 'logs')); // console.error·warn이 userData/logs/YYYY-MM-DD.log에도 남는다
  log.write('info', `시작 ${app.getVersion()}${app.isPackaged ? '' : ' (개발 실행)'}`);
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const secrets = new SecretStore(path.join(userData, 'secrets.json'), safeStorage);
  const bridge = new EngineBridge({ settings, secrets, version: app.getVersion(), maskJpeg: maskJpegNative });
  let settingsCache = await settings.load();
  const origSave = settings.save.bind(settings);
  const updater = startUpdater({ enabled: () => settingsCache.자동업데이트, packaged: app.isPackaged, log: log.write,
    onStatus: s => win?.webContents.send(CHANNELS.updateStatus, s) });
  settings.save = async (patch) => { // 그림 프로토콜이 학기 폴더를, 업데이트가 켜짐 여부를 동기로 알아야 해서
    settingsCache = await origSave(patch);
    if ('자동업데이트' in patch) updater.setEnabled(settingsCache.자동업데이트);
    return settingsCache;
  };
  // 창 위 기본 메뉴(File·Edit…)는 쓰지 않는다. 설정·언어·정보는 프로그램 안 '설정' 화면에 있다. 복사·붙여넣기는 Windows가 메뉴 없이도 처리한다.
  Menu.setApplicationMenu(null);
  registerProtocols(protocol, { html: path.join(ROOT, 'src', 'renderer'), dist: path.join(ROOT, 'dist', 'src'), pdfjs: path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build'), fonts: path.join(ROOT, 'resources', 'fonts') },
    () => settingsCache.학기폴더);
  registerIpc({ bridge, settings, secrets, version: app.getVersion(), window: () => win, updater, sampleDir: SAMPLE_DIR(ROOT) });

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => cb({ responseHeaders: { ...details.responseHeaders,
    'Content-Security-Policy': [CSP] } }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  win = new BrowserWindow({
    width: 1280, height: 860, title: '글눈',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(ROOT, 'dist-preload', 'preload.cjs') },
  });
  // 렌더러의 경고·오류(CSP 위반 포함)를 메인 로그로: 개발자 도구 없이도 확인할 수 있게
  win.webContents.on('console-message', (e) => { if (e.level === 'warning' || e.level === 'error') console.error(`[renderer:${e.level}] ${e.message.split('\n')[0]!.slice(0, 200)} (${e.sourceId}:${e.lineNumber})`); }); // 예외 본문에 학생 답이 섞여도 로그에 길게 남지 않게
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 다른 주소로는 못 가게 막되, 앱 자신의 주소로 가는 것(언어를 바꾼 뒤 새로 고침)은 허용한다
  win.webContents.on('will-navigate', (e, url) => { if (url !== APP_URL) e.preventDefault(); });
  // 메뉴가 없어도 개발자 도구는 F12로(문제 보고용)
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools(); });
  win.on('closed', () => { bridge.cancel(); win = null; });
  await win.loadURL(APP_URL);
});
app.on('window-all-closed', () => app.quit());
