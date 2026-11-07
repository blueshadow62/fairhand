import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseKey } from '../core/key.js';
import { keyExportName, setFolderName } from '../core/names.js';
import { appendUpload, loadSet, loadUploads, listPages, removePage } from '../core/setio.js';
import { parseTranscript } from '../core/transcript.js';
import { DataError, type AnswerKey, type MaskRect, type UploadRecord } from '../core/types.js';
import { EngineError, userFacingMessage } from '../engine/provider.js';
import { CHANNELS, type ExternalLink, type IpcResult, type SetInfo } from '../shared/ipc.js';
import type { EngineBridge } from './engine-bridge.js';
import { leaveChoice, leaveDialogOptions } from './dialogs.js';
import { listSets, nextPageNumber, pageFile, resolveSetDir, uniqueFolderName } from './paths.js';
import { listTrash, purgeSet, restoreSet, trashSet } from './trash.js';
import { buildAllCumulative, saveAndRebuild, rebuildResult } from './results.js';
import type { SecretStore } from './secrets.js';
import type { SettingsStore } from './settings.js';
import type { Updater } from './update.js';
import { copySampleSet, makeDefaultSemester } from './sample.js';

const LINKS: Record<ExternalLink, string> = { install: 'https://code.claude.com/docs/ko/setup', codexInstall: 'https://developers.openai.com/codex/cli', geminiKey: 'https://aistudio.google.com/apikey', privacy: 'https://github.com/blueshadow62/fairhand/blob/main/PRIVACY.md', guide: 'https://github.com/blueshadow62/fairhand#readme' };

export interface IpcDeps { bridge: EngineBridge; settings: SettingsStore; secrets: SecretStore; version: string; window: () => BrowserWindow | null; updater: Updater; sampleDir: string }

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (e) {
    if (e instanceof DataError) return { ok: false, error: e.message };
    if (e instanceof EngineError) return { ok: false, error: userFacingMessage(e) };
    console.error('[ipc]', e); // 비밀은 여기까지 오지 않는다(키는 메시지에 넣지 않음)
    return { ok: false, error: `예상하지 못한 오류: ${(e as Error)?.message ?? String(e)}` };
  }
}

export function registerIpc(d: IpcDeps): void {
  const semester = async () => { const s = await d.settings.load(); if (!s.학기폴더) throw new DataError('설정에서 학기 폴더를 먼저 고르세요'); return s.학기폴더; };
  const setDir = async (폴더: unknown) => { if (typeof 폴더 !== 'string') throw new DataError('세트 폴더 이름이 글자가 아닙니다'); return resolveSetDir(await semester(), 폴더); };
  const roster = async () => { const s = await d.settings.load(); return s.명단 ? (await import('../core/roster.js')).readRoster(s.명단) : null; };
  const h = <A extends unknown[], T>(ch: string, fn: (...a: A) => Promise<T>) => ipcMain.handle(ch, (_e, ...a: unknown[]) => wrap(() => fn(...(a as A))));

  h(CHANNELS.version, async () => d.version);
  h(CHANNELS.getSettings, () => d.settings.load());
  h(CHANNELS.saveSettings, (patch: Parameters<SettingsStore['save']>[0]) => d.settings.save(patch));
  h(CHANNELS.pickFolder, async () => { const r = await dialog.showOpenDialog(d.window()!, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0] ?? null; });
  h(CHANNELS.pickFile, async (kind: 'roster' | 'exe' | 'json') => {
    const filters = kind === 'roster' ? [{ name: '명단', extensions: ['xlsx', 'csv'] }] : kind === 'exe' ? [{ name: '실행 파일', extensions: ['exe', 'cmd'] }] : [{ name: 'JSON', extensions: ['json'] }];
    const r = await dialog.showOpenDialog(d.window()!, { properties: ['openFile'], filters }); return r.canceled ? null : r.filePaths[0] ?? null;
  });
  h(CHANNELS.askLeave, async () => { const s = await d.settings.load(); const r = await dialog.showMessageBox(d.window()!, leaveDialogOptions(s.언어)); return leaveChoice(r.response); });
  h(CHANNELS.openExternal, async (link: ExternalLink) => { const url = LINKS[link]; if (!url) throw new DataError('허용되지 않은 주소'); await shell.openExternal(url); });
  h(CHANNELS.revealPath, async (p: string) => { const sem = await semester(); const rel = path.relative(sem, p); if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new DataError('학기 폴더 밖은 열지 않습니다'); shell.showItemInFolder(p); });

  h(CHANNELS.secretView, (id: string) => d.secrets.view(id));
  h(CHANNELS.secretSet, (id: string, key: string) => d.secrets.set(id, key));
  h(CHANNELS.secretClear, (id: string) => d.secrets.clear(id));
  h(CHANNELS.secretTest, (id: string) => d.bridge.testApiKey(id));
  h(CHANNELS.cliStatus, (id: string) => d.bridge.cliStatus(id));
  h(CHANNELS.cliLogin, (id: string) => d.bridge.openLogin(id));

  h(CHANNELS.listSets, async () => listSets(await semester()));
  h(CHANNELS.deleteSet, async (폴더: string) => {
    const dir = await setDir(폴더);
    if (d.bridge.running()) throw new DataError('전사가 실행 중입니다. 끝나거나 중단한 뒤 지우세요');
    await trashSet(await semester(), path.basename(dir));
  });
  h(CHANNELS.listTrash, async () => listTrash(await semester()));
  h(CHANNELS.restoreSet, async (id: string) => restoreSet(await semester(), id));
  h(CHANNELS.purgeSet, async (id: string) => purgeSet(await semester(), id));
  h(CHANNELS.createSet, async (raw: unknown): Promise<SetInfo> => {
    const key = parseKey(JSON.stringify(raw), '새 정답표');
    const sem = await semester();
    const 폴더 = uniqueFolderName(sem, setFolderName(key), existsSync);
    const dir = path.join(sem, 폴더);
    await mkdir(path.join(dir, 'pages'), { recursive: true }); await mkdir(path.join(dir, 'transcripts'), { recursive: true }); await mkdir(path.join(dir, '원본'), { recursive: true });
    await writeFile(path.join(dir, '정답표.json'), JSON.stringify(key, null, 1), 'utf-8');
    return { 폴더, key, 쪽수: 0, 전사수: 0 };
  });
  h(CHANNELS.readSet, async (폴더: string) => {
    const dir = await setDir(폴더); const { key, transcripts } = await loadSet(dir);
    const all = await roster().catch(() => null); // 명단 파일이 깨져도 세트는 열리게(엑셀 만들 때 오류가 보인다)
    const 명단 = all ? all.filter(x => x.학년 === key.대상.학년 && key.대상.반.includes(x.반)) : null; // 검토 화면의 미제출 목록용
    return { 폴더, key, transcripts, pages: await listPages(dir), 올린파일: await loadUploads(dir), 명단있음: !!all, 명단 };
  });
  h(CHANNELS.saveKey, async (폴더: string, raw: unknown): Promise<AnswerKey> => d.bridge.saveKey(await setDir(폴더), raw));
  h(CHANNELS.setNameMask, async (폴더: string, rect: unknown): Promise<AnswerKey> => d.bridge.setNameMask(await setDir(폴더), rect as MaskRect | null));
  h(CHANNELS.matchRoster, async (폴더: string) => d.bridge.matchRosterAll(await setDir(폴더)));
  h(CHANNELS.importKey, async () => { const r = await dialog.showOpenDialog(d.window()!, { properties: ['openFile'], filters: [{ name: '정답표', extensions: ['json'] }] }); if (r.canceled || !r.filePaths[0]) return null; return parseKey(await readFile(r.filePaths[0], 'utf-8'), path.basename(r.filePaths[0])); });
  h(CHANNELS.exportKey, async (폴더: string) => { const dir = await setDir(폴더); const { key } = await loadSet(dir); const r = await dialog.showSaveDialog(d.window()!, { defaultPath: keyExportName(key), filters: [{ name: '정답표', extensions: ['json'] }] }); if (r.canceled || !r.filePath) return null; await writeFile(r.filePath, JSON.stringify(key, null, 1), 'utf-8'); return r.filePath; });
  h(CHANNELS.attachSource, async (폴더: string) => {
    const dir = await setDir(폴더);
    const r = await dialog.showOpenDialog(d.window()!, { properties: ['openFile'], filters: [{ name: '지문', extensions: ['pdf', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0], out = path.join(dir, '원본');
    await mkdir(out, { recursive: true });
    const { name: stem, ext } = path.parse(src);
    let name = path.basename(src);
    for (let i = 2; existsSync(path.join(out, name)); i++) name = `${stem} (${i})${ext}`; // 같은 이름의 지문을 덮어쓰지 않는다
    await copyFile(src, path.join(out, name));
    return name;
  });
  h(CHANNELS.readSourceText, async (폴더: string) => { const dir = await setDir(폴더); try { return await readFile(path.join(dir, '원본', '지문.txt'), 'utf-8'); } catch { return ''; } });

  h(CHANNELS.draftKey, (input: { 글: string; 문제: string; 지문?: string; 문제그림?: ArrayBuffer[]; 지문그림?: ArrayBuffer[] }) => {
    const imgs = (a?: ArrayBuffer[]) => (a ?? []).map(b => Buffer.from(b).toString('base64'));
    if (imgs(input.문제그림).length + imgs(input.지문그림).length > 40) throw new DataError('그림은 모두 합쳐 40장까지만 보낼 수 있습니다');
    return d.bridge.draftKey({ 글: input.글, 문제: input.문제, 지문: input.지문, 문제그림: imgs(input.문제그림), 지문그림: imgs(input.지문그림) });
  });
  h(CHANNELS.reviseKey, (input: { 글: string; 문제: string; 지문?: string; 문제그림?: ArrayBuffer[]; 지문그림?: ArrayBuffer[]; 현재: { 정량: AnswerKey['정량']; 정성: AnswerKey['정성'] }; 지시: string; 앞선지시?: string[] }) => {
    const imgs = (a?: ArrayBuffer[]) => (a ?? []).map(b => Buffer.from(b).toString('base64'));
    return d.bridge.reviseKey({ 글: input.글, 문제: input.문제, 지문: input.지문, 문제그림: imgs(input.문제그림), 지문그림: imgs(input.지문그림), 현재: input.현재, 지시: input.지시, 앞선지시: input.앞선지시?.slice(-5) });
  });
  h(CHANNELS.extractText, async (name: string, data: ArrayBuffer) => (await import('../core/hwpx.js')).extractText(name, Buffer.from(data)));
  h(CHANNELS.tryPage, async (폴더: string, jpeg: ArrayBuffer) => d.bridge.tryPage(await setDir(폴더), Buffer.from(jpeg)));
  // 렌더러가 보낸 값은 형이 아니라 검사로 믿는다: 쪽 번호는 1 이상 정수만 파일 이름이 된다
  const pageList = (p: unknown): number[] | undefined => {
    if (p === undefined || p === null) return undefined;
    if (!Array.isArray(p) || !p.every(n => Number.isInteger(n) && n >= 1)) throw new DataError('쪽 번호 목록이 잘못되었습니다');
    return p as number[];
  };
  h(CHANNELS.startRun, async (폴더: string, opts: { pages?: unknown; force?: unknown }) => d.bridge.startRun(await setDir(폴더), { pages: pageList(opts?.pages), force: opts?.force === true }, e => d.window()?.webContents.send(CHANNELS.progress, e)));
  h(CHANNELS.cancelRun, async () => d.bridge.cancel());
  h(CHANNELS.addPages, async (폴더: string, jpegs: ArrayBuffer[], thumbs?: ArrayBuffer[]) => {
    const dir = await setDir(폴더);
    await mkdir(path.join(dir, 'pages', 'thumbs'), { recursive: true });
    let n = await nextPageNumber(dir); const made: number[] = [];
    for (const [i, j] of jpegs.entries()) {
      await writeFile(pageFile(dir, n), Buffer.from(j));
      if (thumbs?.[i]) await writeFile(path.join(dir, 'pages', 'thumbs', path.basename(pageFile(dir, n))), Buffer.from(thumbs[i]!));
      made.push(n++);
    }
    return made;
  });
  h(CHANNELS.deletePage, async (폴더: string, page: number) => {
    const dir = await setDir(폴더);
    const { 전사있었음 } = await removePage(dir, page);
    if (!전사있었음 || !(await loadSet(dir)).transcripts.length) return {};
    try { return await rebuildResult(dir, await roster(), { version: d.version }); }
    catch (e) { return { 엑셀오류: e instanceof Error ? e.message : String(e) }; }
  });
  h(CHANNELS.recordUpload, async (폴더: string, r: Omit<UploadRecord, '일시'>) => appendUpload(await setDir(폴더),
    { 이름: String(r.이름), 크기: Number(r.크기), 지문: String(r.지문), 장수: Number(r.장수), 시작: Number(r.시작), 끝: Number(r.끝), 일시: new Date().toISOString() }));

  h(CHANNELS.saveTranscript, async (폴더: string, raw: unknown) => { const dir = await setDir(폴더); const t = parseTranscript(JSON.stringify(raw), '검토 화면'); return saveAndRebuild(dir, t, await roster(), { version: d.version }); });
  h(CHANNELS.buildResult, async (폴더: string) => rebuildResult(await setDir(폴더), await roster(), { version: d.version }));
  h(CHANNELS.applyCase, async (폴더: string, c: { 단위: string; 답: string; 판정: 'O' | 'X'; page: number }) => d.bridge.applyCase(await setDir(폴더), c));
  h(CHANNELS.removeCase, async (폴더: string, 단위: string, 답: string) => d.bridge.removeCase(await setDir(폴더), 단위, 답));
  h(CHANNELS.rejudge, async (폴더: string) => d.bridge.rejudge(await setDir(폴더)));
  h(CHANNELS.judgeWithModel, async (폴더: string, opts: { pages?: unknown }) => d.bridge.judgeWithModel(await setDir(폴더), pageList(opts?.pages), e => d.window()?.webContents.send(CHANNELS.progress, e)));
  h(CHANNELS.createSampleSet, async () => ({ 폴더: await copySampleSet(d.sampleDir, await semester()) }));
  h(CHANNELS.makeDefaultSemester, async () => { const p = await makeDefaultSemester(app.getPath('documents')); await d.settings.save({ 학기폴더: p }); return p; });
  h(CHANNELS.updateStatus, async () => d.updater.status());
  h(CHANNELS.checkUpdate, () => d.updater.check());
  h(CHANNELS.installUpdate, async () => d.updater.install());
  h(CHANNELS.buildCumulative, async () => buildAllCumulative(await semester(), await roster(), { version: d.version }));
}
