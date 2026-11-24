import { BrowserWindow } from 'electron';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCriteria, type CriteriaDoc, type CriteriaLang, type CriteriaOptions } from '../core/criteria.js';
import { criteriaHtml } from '../core/criteria-html.js';
import { criteriaHwpx } from '../core/criteria-hwpx.js';
import { DataError, type AnswerKey } from '../core/types.js';
import { APP_SCHEME, printDocUrl, type PrintDocs } from './protocols.js';
import { friendlyFsError } from './results.js';

/** 인쇄가 끝나지 않을 때 기다리는 한도. 표 몇 쪽은 1초 안팎이다 */
const PRINT_TIMEOUT_MS = 60_000;

/**
 * 문서를 숨은 창에서 A4 PDF로 인쇄한다. 숨은 창: preload 없음, node 통합 없음, 자바스크립트 끔, 다른 주소로 가지 않음, 끝나면(실패해도) 닫는다.
 * 문서는 앱 주소로 내어(PrintDocs) 앱에 든 글꼴·CSS를 같은 출처로 읽는다
 */
export async function printCriteriaPdf(doc: CriteriaDoc, docs: PrintDocs): Promise<Buffer> {
  const id = docs.put(criteriaHtml(doc, `${APP_SCHEME}://app/criteria.css`));
  const win = new BrowserWindow({
    show: false, width: 794, height: 1123, // A4를 96dpi로(화면에 보이지 않지만 배치 폭의 기준)
    webPreferences: { javascript: false, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', e => e.preventDefault());
  wc.on('will-redirect', e => e.preventDefault());
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      await win.loadURL(printDocUrl(id));
      return wc.printToPDF({
        pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
        // 쪽 번호는 Chromium이 아래 여백에 그린다(문서 글꼴이 아닌 숫자만이라 글꼴이 없어도 된다)
        displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;font-size:8px;color:#777;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    })();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DataError('PDF를 만드는 데 너무 오래 걸려 멈췄습니다')), PRINT_TIMEOUT_MS); });
    return Buffer.from(await Promise.race([work, timeout]));
  } finally {
    clearTimeout(timer);
    docs.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** 정답표 → 고른 형식의 파일 내용 */
export async function criteriaFile(key: AnswerKey, o: CriteriaOptions, lang: CriteriaLang, now: Date, docs: PrintDocs): Promise<Buffer> {
  const doc = buildCriteria(key, o, lang, now);
  return o.형식 === 'hwpx' ? criteriaHwpx(doc, now) : printCriteriaPdf(doc, docs);
}

/** 임시 이름(.part)에 쓴 뒤 바꿔, 쓰다 끊겨도 반쪽 파일이 그 이름으로 남지 않게 한다 */
export async function writeCriteriaFile(target: string, data: Buffer): Promise<void> {
  const tmp = `${target}.part`;
  try { await writeFile(tmp, data); await rename(tmp, target); }
  catch (e) { await rm(tmp, { force: true }).catch(() => undefined); throw friendlyFsError(e, `파일 ${path.basename(target)}`); }
}
