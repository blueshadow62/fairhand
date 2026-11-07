// 묶은 앱(electron-builder --dir 결과)을 실제로 띄워 탭마다 화면을 찍고, 화면 오류를 모은다.
// 개발 PC에서 직접 볼 수 없는 맥·리눅스 판을 CI에서 확인하려고 만들었다. 추가 패키지 없이 Chromium 디버깅 포트(CDP)로 조작한다.
// 사용: node scripts/smoke.mjs <저장 폴더>   (리눅스는 xvfb-run 아래에서)
// 결과: <저장 폴더>/NN-탭.png, summary.json. 화면 예외가 있거나 탭·그림이 안 뜨면 종료 코드 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'smoke-out');
fs.mkdirSync(out, { recursive: true });
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findApp(dir) {
  if (process.platform === 'win32') return path.join(dir, 'win-unpacked', 'Fairhand.exe');
  if (process.platform === 'darwin') {
    for (const d of fs.readdirSync(dir).filter(d => d.startsWith('mac'))) {
      const app = fs.readdirSync(path.join(dir, d)).find(a => a.endsWith('.app'));
      if (app) { const macos = path.join(dir, d, app, 'Contents', 'MacOS'); return path.join(macos, fs.readdirSync(macos)[0]); }
    }
    throw new Error('release/mac*/*.app 없음');
  }
  const u = path.join(dir, 'linux-unpacked');
  const bin = fs.readdirSync(u).find(f => /^fairhand$/i.test(f));
  if (!bin) throw new Error(`linux-unpacked에 실행 파일 없음: ${fs.readdirSync(u).join(', ')}`);
  return path.join(u, bin);
}

const exe = findApp(path.resolve('release'));
// 사용자 설정과 섞이지 않게 빈 설정 폴더와 학기 폴더를 새로 만든다
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'geulnun-smoke-'));
const semester = path.join(userData, 'semester');
fs.mkdirSync(semester);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ 학기폴더: semester, 언어: 'ko', 자동업데이트: false }));
// Ubuntu 23.10+는 권한 없는 사용자 네임스페이스를 막아 Chromium 격리가 실패한다(CI 전용 우회)
const args = [`--remote-debugging-port=${PORT}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
const app = spawn(exe, args, { env: { ...process.env, GEULNUN_USER_DATA: userData }, stdio: ['ignore', 'pipe', 'pipe'] });
const appLog = fs.createWriteStream(path.join(out, 'app.log'));
app.stdout.pipe(appLog); app.stderr.pipe(appLog);

const summary = { platform: process.platform, arch: process.arch, exe, shots: [], exceptions: [], consoleErrors: [], toasts: [] };
let failed = false;
const fail = msg => { failed = true; summary.problems = [...(summary.problems ?? []), msg]; console.error('문제:', msg); };

try {
  let page;
  for (let i = 0; i < 120 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('geulnun://app')); }
    catch { /* 아직 안 떴다 */ }
    if (!page) await sleep(500);
  }
  if (!page) {
    // 창이 안 뜬 이유를 가르기 위해: 포트가 열렸는지(=앱 프로세스는 떴는지), 떠 있는 화면 목록
    summary.debugPort = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json()).catch(e => `응답 없음: ${e.message}`);
    summary.targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()).catch(() => null);
    summary.appExited = app.exitCode ?? app.signalCode ?? null;
    throw new Error('60초 안에 글눈 창이 뜨지 않음');
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') summary.exceptions.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') summary.consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
    summary.shots.push(name);
    const toast = await run(`(() => { const t = document.getElementById('toast'); return t && !t.classList.contains('hidden') ? t.className + ': ' + t.textContent : null; })()`);
    if (toast) summary.toasts.push(`${name} → ${toast}`);
  };
  const clickTab = i => run(`(() => { const b = document.querySelectorAll('#tabs button')[${i}]; if (b) b.click(); return !!b; })()`);

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 60 && !(await run(`document.querySelectorAll('#tabs button').length`)); i++) await sleep(250);
  summary.tabCount = await run(`document.querySelectorAll('#tabs button').length`);
  if (summary.tabCount < 5) fail(`탭이 ${summary.tabCount}개`);

  await sleep(3000); // 시작 화면의 AI 도구 상태 점검이 끝나게
  summary.homeText = (await run(`document.querySelector('#main')?.innerText ?? ''`)).slice(0, 800);
  summary.fontPretendard = await run(`document.fonts.ready.then(() => document.fonts.check('16px Pretendard'))`);
  await shot('01-home');

  // 샘플 세트를 넣고 연다(AI 없이 문항 설정·검토 화면과 답안지 그림을 볼 수 있다)
  const added = await run(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '샘플 세트 넣어 보기'); if (b) b.click(); return !!b; })()`);
  if (!added) fail('샘플 세트 단추 없음');
  for (let i = 0; i < 40 && !(await run(`!!document.querySelector('.home-sets button')`)); i++) await sleep(250);
  if (!(await run(`(() => { const b = document.querySelector('.home-sets button'); if (b) b.click(); return !!b; })()`))) fail('샘플 세트가 목록에 없음');
  await sleep(2500);
  await shot('02-key');

  for (const [i, name] of [[2, '03-run'], [3, '04-review'], [4, '05-settings']]) {
    await clickTab(i); await sleep(2500);
    if (name === '04-review') {
      summary.reviewImages = await run(`[...document.querySelectorAll('[data-tab="review"] img')].map(i => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 60) }))`);
      if (!summary.reviewImages.some(i => i.w > 0)) fail('검토 화면에 답안지 그림이 안 보임');
    }
    await shot(name);
  }
  if (summary.exceptions.length) fail(`화면 예외 ${summary.exceptions.length}건`);
  ws.close();
} catch (e) {
  fail(String(e?.message ?? e));
} finally {
  app.kill();
  await sleep(1000);
  // 앱이 설정 폴더에 남긴 로그(시작·경고·오류)를 함께 남긴다
  try { fs.cpSync(path.join(userData, 'logs'), path.join(out, 'app-logs'), { recursive: true }); } catch { /* 로그를 못 남길 만큼 일찍 멈췄다 */ }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* 앱이 아직 파일을 쥐고 있으면 남겨 둔다 */ }
  process.exit(failed ? 1 : 0);
}
