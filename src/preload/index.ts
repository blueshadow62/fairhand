import { contextBridge, ipcRenderer } from 'electron';
import type { GeulnunApi, IpcResult, ProgressEvent, UpdateStatus } from '../shared/ipc.js';

// sandbox preload는 CommonJS 한 파일이어야 해서 런타임 값을 가져오지 않고 복제한다. main-protocols 검사가 shared/ipc.ts와 같은지 본다.
const CHANNELS = {
  getSettings: 'settings:get', saveSettings: 'settings:save', pickFolder: 'dialog:folder', pickFile: 'dialog:file', askLeave: 'dialog:leave', openExternal: 'shell:external', revealPath: 'shell:reveal', version: 'app:version',
  secretView: 'secret:view', secretSet: 'secret:set', secretClear: 'secret:clear', secretTest: 'secret:test',
  cliStatus: 'cli:status', cliLogin: 'cli:login',
  listSets: 'set:list', createSet: 'set:create', deleteSet: 'set:delete', listTrash: 'trash:list', restoreSet: 'trash:restore', purgeSet: 'trash:purge', readSet: 'set:read', saveKey: 'set:save-key', importKey: 'set:import-key', exportKey: 'set:export-key', attachSource: 'set:attach-source', readSourceText: 'set:source-text',
  draftKey: 'ai:draft-key', reviseKey: 'ai:revise-key', extractText: 'file:extract-text', tryPage: 'ai:try-page', startRun: 'run:start', cancelRun: 'run:cancel', progress: 'run:progress', addPages: 'pages:add', deletePage: 'pages:delete', deletePages: 'pages:delete-many', recordUpload: 'pages:record-upload',
  saveTranscript: 'review:save', buildResult: 'review:build-result', buildCumulative: 'review:build-cumulative', setUnitResults: 'review:unit-results',
  setNameMask: 'set:name-mask', setIdentityMask: 'set:identity-mask', setAnswerRegion: 'set:answer-region', matchRoster: 'roster:match',
  applyCase: 'case:apply', revertCase: 'case:revert', removeCase: 'case:remove', rejudge: 'judge:rule', judgeWithModel: 'judge:model',
  updateStatus: 'update:status', checkUpdate: 'update:check', downloadUpdate: 'update:download', installUpdate: 'update:install',
  createSampleSet: 'sample:create', makeDefaultSemester: 'semester:make-default',
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
  askLeave: () => call(CHANNELS.askLeave),
  openExternal: (link) => call(CHANNELS.openExternal, link),
  revealPath: (p) => call(CHANNELS.revealPath, p),
  secretView: (id) => call(CHANNELS.secretView, id),
  secretSet: (id, key) => call(CHANNELS.secretSet, id, key),   // 키는 들어가기만 한다. 돌아오는 것은 SecretView
  secretClear: (id) => call(CHANNELS.secretClear, id),
  secretTest: (id) => call(CHANNELS.secretTest, id),
  cliStatus: (id) => call(CHANNELS.cliStatus, id),
  cliLogin: (id) => call(CHANNELS.cliLogin, id),
  listSets: () => call(CHANNELS.listSets),
  deleteSet: (폴더) => call(CHANNELS.deleteSet, 폴더),
  listTrash: () => call(CHANNELS.listTrash),
  restoreSet: (id) => call(CHANNELS.restoreSet, id),
  purgeSet: (id) => call(CHANNELS.purgeSet, id),
  createSet: (key) => call(CHANNELS.createSet, key),
  readSet: (폴더) => call(CHANNELS.readSet, 폴더),
  saveKey: (폴더, key) => call(CHANNELS.saveKey, 폴더, key),
  importKey: () => call(CHANNELS.importKey),
  exportKey: (폴더) => call(CHANNELS.exportKey, 폴더),
  attachSource: (폴더) => call(CHANNELS.attachSource, 폴더),
  readSourceText: (폴더) => call(CHANNELS.readSourceText, 폴더),
  draftKey: (input) => call(CHANNELS.draftKey, input),
  extractText: (name, data) => call(CHANNELS.extractText, name, data),
  reviseKey: (input) => call(CHANNELS.reviseKey, input),
  tryPage: (폴더, jpeg) => call(CHANNELS.tryPage, 폴더, jpeg),
  startRun: (폴더, opts) => call(CHANNELS.startRun, 폴더, opts),
  cancelRun: () => call(CHANNELS.cancelRun),
  onProgress: (cb) => { const h = (_e: unknown, ev: ProgressEvent) => cb(ev); ipcRenderer.on(CHANNELS.progress, h); return () => ipcRenderer.removeListener(CHANNELS.progress, h); },
  addPages: (폴더, jpegs, thumbs) => call(CHANNELS.addPages, 폴더, jpegs, thumbs),
  deletePage: (폴더, page) => call(CHANNELS.deletePage, 폴더, page),
  deletePages: (폴더, pages) => call(CHANNELS.deletePages, 폴더, pages),
  recordUpload: (폴더, r) => call(CHANNELS.recordUpload, 폴더, r),
  saveTranscript: (폴더, t) => call(CHANNELS.saveTranscript, 폴더, t),
  setUnitResults: (폴더, req) => call(CHANNELS.setUnitResults, 폴더, req),
  buildResult: (폴더) => call(CHANNELS.buildResult, 폴더),
  buildCumulative: () => call(CHANNELS.buildCumulative),
  setNameMask: (폴더, rect) => call(CHANNELS.setNameMask, 폴더, rect),
  setIdentityMask: (폴더, rect) => call(CHANNELS.setIdentityMask, 폴더, rect),
  setAnswerRegion: (폴더, 단위, rect) => call(CHANNELS.setAnswerRegion, 폴더, 단위, rect),
  matchRoster: (폴더) => call(CHANNELS.matchRoster, 폴더),
  applyCase: (폴더, c) => call(CHANNELS.applyCase, 폴더, c),
  revertCase: (폴더, req) => call(CHANNELS.revertCase, 폴더, req),
  removeCase: (폴더, 단위, 답) => call(CHANNELS.removeCase, 폴더, 단위, 답),
  rejudge: (폴더) => call(CHANNELS.rejudge, 폴더),
  judgeWithModel: (폴더, opts) => call(CHANNELS.judgeWithModel, 폴더, opts),
  updateStatus: () => call(CHANNELS.updateStatus),
  checkUpdate: () => call(CHANNELS.checkUpdate),
  downloadUpdate: () => call(CHANNELS.downloadUpdate),
  installUpdate: () => call(CHANNELS.installUpdate),
  createSampleSet: () => call(CHANNELS.createSampleSet),
  makeDefaultSemester: () => call(CHANNELS.makeDefaultSemester),
  onUpdate: (cb) => { const h = (_e: unknown, s: UpdateStatus) => cb(s); ipcRenderer.on(CHANNELS.updateStatus, h); return () => ipcRenderer.removeListener(CHANNELS.updateStatus, h); },
};
contextBridge.exposeInMainWorld('geulnun', api);
