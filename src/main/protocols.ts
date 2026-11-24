import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSetDir } from './paths.js';

export const APP_SCHEME = 'geulnun';
import { IMG_SCHEME, imageUrl } from '../shared/ipc.js';
export { IMG_SCHEME, imageUrl };
export const CSP = `default-src 'self'; img-src ${IMG_SCHEME}: blob: data:; style-src 'self'; worker-src 'self' blob:`;
export interface AppRoots { html: string; dist: string; pdfjs: string; fonts: string }

/** root 안의 파일로만 푼다. 밖(..)이면 null */
function inside(root: string, rel: string): string | null {
  const p = path.normalize(path.join(root, rel));
  const r = path.relative(root, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? p : null;
}

export function appFileFor(url: URL, roots: AppRoots): string | null {
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== 'app') return null;
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  if (pathname.includes('..')) return null;
  if (pathname === '/' || pathname === '/index.html') return inside(roots.html, 'index.html');
  if (pathname === '/styles.css') return inside(roots.html, 'styles.css');
  if (pathname === '/criteria.css') return inside(roots.html, 'criteria.css'); // 채점 기준 안내문 PDF의 인쇄 꾸밈
  if (pathname.startsWith('/dist/') && /\.js(\.map)?$/.test(pathname)) return inside(roots.dist, pathname.slice('/dist/'.length));
  if (pathname.startsWith('/pdfjs/') && /\.(mjs|js|map)$/.test(pathname)) return inside(roots.pdfjs, pathname.slice('/pdfjs/'.length));
  if (pathname.startsWith('/fonts/') && /\.woff2$/.test(pathname)) return inside(roots.fonts, pathname.slice('/fonts/'.length));
  return null;
}


export function pageImageFor(url: URL, semesterDir: string | null): string | null {
  if (!semesterDir || url.protocol !== `${IMG_SCHEME}:` || url.host !== 'set') return null;
  const m = /^\/([^/]+)\/(thumbs\/)?(p\d+\.jpg)$/.exec(url.pathname);
  if (!m) return null;
  try { return path.join(resolveSetDir(semesterDir, decodeURIComponent(m[1]!)), 'pages', m[2] ? 'thumbs' : '', m[3]!); } catch { return null; }
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.map': 'application/json', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

async function fileResponse(file: string | null): Promise<Response> {
  if (!file) return new Response('not found', { status: 404 });
  try { return new Response(await readFile(file), { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store' } }); }
  catch { return new Response('not found', { status: 404 }); }
}

/**
 * 숨은 창에서 PDF로 인쇄할 문서(채점 기준 안내문). 앱 주소(geulnun://app/print/<id>.html)로 내야 앱의 글꼴·CSS와 같은 출처라 CSP 'self'로 읽힌다.
 * 문서는 메모리에만 두고 인쇄가 끝나면 지운다. id는 추측할 수 없는 UUID
 */
export class PrintDocs {
  private docs = new Map<string, string>();
  put(html: string): string { const id = randomUUID(); this.docs.set(id, html); return id; }
  get(id: string): string | undefined { return this.docs.get(id); }
  delete(id: string): void { this.docs.delete(id); }
}
export const printDocUrl = (id: string): string => `${APP_SCHEME}://app/print/${id}.html`;
/** 인쇄 문서의 CSP: 스크립트·바깥 주소 없이 앱의 CSS·글꼴만 */
export const PRINT_CSP = "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'none'";

export function printDocFor(url: URL, docs: PrintDocs | undefined): string | null {
  if (!docs || url.protocol !== `${APP_SCHEME}:` || url.host !== 'app') return null;
  const m = /^\/print\/([0-9a-f-]{36})\.html$/.exec(url.pathname);
  return m ? docs.get(m[1]!) ?? null : null;
}

/** app.whenReady 뒤에 한 번. 두 scheme은 app.ready 전에 registerSchemesAsPrivileged로 등록돼 있어야 한다(index.ts). */
export function registerProtocols(protocol: { handle(scheme: string, h: (req: Request) => Promise<Response>): void }, roots: AppRoots, semesterDir: () => string | null, printDocs?: PrintDocs): void {
  protocol.handle(APP_SCHEME, async req => {
    const url = new URL(req.url), doc = printDocFor(url, printDocs);
    if (doc !== null) return new Response(doc, { headers: { 'content-type': MIME['.html']!, 'content-security-policy': PRINT_CSP, 'cache-control': 'no-store' } });
    return fileResponse(appFileFor(url, roots));
  });
  protocol.handle(IMG_SCHEME, req => fileResponse(pageImageFor(new URL(req.url), semesterDir())));
}
