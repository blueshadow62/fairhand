import { app, BrowserWindow } from 'electron';
import path from 'node:path';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(app.getAppPath(), 'src/renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
