import { contextBridge, ipcRenderer } from 'electron';
import type { GeulnunApi, IpcResult, ProgressEvent } from '../shared/ipc.js';

// sandbox preload는 CommonJS 한 파일이어야 해서 런타임 값을 가져오지 않고 복제한다. main-protocols 검사가 shared/ipc.ts와 같은지 본다.
const CHANNELS = {
  getSettings: 'settings:get', saveSettings: 'settings:save', pickFolder: 'dialog:folder', pickFile: 'dialog:file', openExternal: 'shell:external', revealPath: 'shell:reveal', version: 'app:version',
  secretView: 'secret:view', secretSet: 'secret:set', secretClear: 'secret:clear', secretTest: 'secret:test',
  cliStatus: 'cli:status', cliLogin: 'cli:login',
  listSets: 'set:list', createSet: 'set:create', readSet: 'set:read', saveKey: 'set:save-key', importKey: 'set:import-key', exportKey: 'set:export-key', attachSource: 'set:attach-source', readSourceText: 'set:source-text',
  draftKey: 'ai:draft-key', tryPage: 'ai:try-page', startRun: 'run:start', cancelRun: 'run:cancel', progress: 'run:progress', addPages: 'pages:add',
  saveTranscript: 'review:save', buildResult: 'review:build-result', buildCumulative: 'review:build-cumulative',
  applyCase: 'case:apply', removeCase: 'case:remove', rejudge: 'judge:rule', judgeWithModel: 'judge:model',
} as const;

async function call<T>(ch: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(ch, ...args)) as IpcResult<T>;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const api: GeulnunApi = {
  version: () => call(CHANNELS.version),
  getSettings: () => call(CHANNELS.getSettings),
  saveSettings: (patch) => call(CHANNELS.saveSettings, patch),
  pickFolder: () => call(CHANNELS.pickFolder),
  pickFile: (kind) => call(CHANNELS.pickFile, kind),
  openExternal: (link) => call(CHANNELS.openExternal, link),
  revealPath: (p) => call(CHANNELS.revealPath, p),
  secretView: (id) => call(CHANNELS.secretView, id),
  secretSet: (id, key) => call(CHANNELS.secretSet, id, key),   // 키는 들어가기만 한다. 돌아오는 것은 SecretView
  secretClear: (id) => call(CHANNELS.secretClear, id),
  secretTest: (id) => call(CHANNELS.secretTest, id),
  cliStatus: (id) => call(CHANNELS.cliStatus, id),
  cliLogin: (id) => call(CHANNELS.cliLogin, id),
  listSets: () => call(CHANNELS.listSets),
  createSet: (key) => call(CHANNELS.createSet, key),
  readSet: (폴더) => call(CHANNELS.readSet, 폴더),
  saveKey: (폴더, key) => call(CHANNELS.saveKey, 폴더, key),
  importKey: () => call(CHANNELS.importKey),
  exportKey: (폴더) => call(CHANNELS.exportKey, 폴더),
  attachSource: (폴더) => call(CHANNELS.attachSource, 폴더),
  readSourceText: (폴더) => call(CHANNELS.readSourceText, 폴더),
  draftKey: (input) => call(CHANNELS.draftKey, input),
  tryPage: (폴더, jpeg) => call(CHANNELS.tryPage, 폴더, jpeg),
  startRun: (폴더, opts) => call(CHANNELS.startRun, 폴더, opts),
  cancelRun: () => call(CHANNELS.cancelRun),
  onProgress: (cb) => { const h = (_e: unknown, ev: ProgressEvent) => cb(ev); ipcRenderer.on(CHANNELS.progress, h); return () => ipcRenderer.removeListener(CHANNELS.progress, h); },
  addPages: (폴더, jpegs) => call(CHANNELS.addPages, 폴더, jpegs),
  saveTranscript: (폴더, t) => call(CHANNELS.saveTranscript, 폴더, t),
  buildResult: (폴더) => call(CHANNELS.buildResult, 폴더),
  buildCumulative: () => call(CHANNELS.buildCumulative),
  applyCase: (폴더, c) => call(CHANNELS.applyCase, 폴더, c),
  removeCase: (폴더, 단위, 답) => call(CHANNELS.removeCase, 폴더, 단위, 답),
  rejudge: (폴더) => call(CHANNELS.rejudge, 폴더),
  judgeWithModel: (폴더, opts) => call(CHANNELS.judgeWithModel, 폴더, opts),
};
contextBridge.exposeInMainWorld('geulnun', api);
