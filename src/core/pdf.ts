import { DataError } from './types.js';

/**
 * 답안지 그림(JPEG)을 그대로 담는 작은 PDF 작성기. 외부 부품 없이 만든다(사양 4절).
 * JPEG는 다시 압축하지 않고 /DCTDecode로 넣고, 채점 표시는 그림 위에 벡터 명령으로 그린다(원본 그림 파일은 건드리지 않는다).
 * 장 수가 많은 세트에서도 메모리가 늘지 않게, 한 쪽을 다 쓰면 그 바이트는 바로 쓰는 곳(sink)으로 넘기고 잡아 두지 않는다
 */

export interface JpegInfo { width: number; height: number; components: 1 | 3 }

/** 기초(SOF0)·확장(SOF1)·점진(SOF2) 허프만만. 무손실·산술 부호화는 PDF 보기 프로그램이 못 여는 일이 있어 받지 않는다 */
const SUPPORTED_SOF = new Set([0xc0, 0xc1, 0xc2]);
const OTHER_SOF = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** JPEG의 SOF 표지에서 너비·높이·성분 수를 읽는다. where는 오류에 넣을 장 이름(p07 등) */
export function readJpegInfo(b: Uint8Array, where: string): JpegInfo {
  const bad = (why: string) => new DataError(`${where}: 답안지 그림을 PDF에 넣을 수 없습니다(${why})`);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw bad('JPEG 파일이 아님');
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw bad('JPEG 구조가 깨짐');
    while (i < b.length && b[i] === 0xff) i++; // 채움 바이트
    const m = b[i++];
    if (m === undefined) break;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // 길이 없는 표지
    if (m === 0xd9 || m === 0xda) break; // 그림 끝·자료 시작 전에 SOF가 있어야 한다
    if (i + 1 >= b.length) break;
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2) throw bad('JPEG 구조가 깨짐');
    if (SUPPORTED_SOF.has(m)) {
      if (i + 7 >= b.length) break;
      const height = (b[i + 3]! << 8) | b[i + 4]!, width = (b[i + 5]! << 8) | b[i + 6]!, n = b[i + 7]!;
      if (!width || !height) throw bad('그림 크기가 0');
      if (n !== 1 && n !== 3) throw bad(`색 성분 ${n}개(CMYK 등)는 지원하지 않음`);
      return { width, height, components: n };
    }
    if (OTHER_SOF.has(m)) throw bad('지원하지 않는 JPEG 방식');
    i += len;
  }
  throw bad('그림 크기를 읽지 못함');
}

/** A4(pt). 그림이 가로로 길면 가로 쪽 */
export const A4 = { w: 595.28, h: 841.89 } as const;
export function pageSizeFor(img: { width: number; height: number }): { w: number; h: number } {
  return img.width > img.height ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h };
}

/** PDF 좌표(pt, 왼쪽 아래 원점)의 사각형 */
export interface Box { x: number; y: number; w: number; h: number }

/** 그림을 비율을 지켜 쪽에 맞추고 가운데에 둔 자리 */
export function fitImage(page: { w: number; h: number }, img: { width: number; height: number }): Box {
  const s = Math.min(page.w / img.width, page.h / img.height);
  const w = img.width * s, h = img.height * s;
  return { x: (page.w - w) / 2, y: (page.h - h) / 2, w, h };
}

/** 그림 위에 그릴 것. 좌표는 PDF 좌표(pt) */
export type Shape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'text'; x: number; y: number; size: number; text: string };

/** 그림 위 표시의 펜. 색은 0~1 RGB */
export interface Pen { color: [number, number, number]; width: number }

export interface PdfPage { jpeg: Uint8Array; info: JpegInfo; shapes?: Shape[]; pen?: Pen }

/** 쓰는 곳. 파일이든 메모리든 받은 차례대로 붙여 쓰기만 하면 된다 */
export interface Sink { write(chunk: Uint8Array): Promise<void> }

const n = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** PDF 기본 글꼴 Helvetica의 글자 폭(1/1000 em). 점수 글자(숫자·점·빗금)만 쓴다 */
const HELV: Record<string, number> = { '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, '.': 278, '/': 278, ' ': 278, '-': 333 };
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    const c = HELV[ch];
    if (c === undefined) throw new DataError(`PDF 점수 글자에 쓸 수 없는 글자: '${ch}'`);
    w += c;
  }
  return w * size / 1000;
}

/** 베지어 네 개로 그린 타원(K: 원을 근사하는 조절점 비율) */
const K = 0.5522847498;
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const ox = rx * K, oy = ry * K;
  return [
    `${n(cx + rx)} ${n(cy)} m`,
    `${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)} c`,
    `${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)} c`,
    'S',
  ].join('\n');
}

/** 한 쪽의 내용 흐름: 그림을 놓고 그 위에 표시를 그린다 */
export function pageContent(img: Box, shapes: Shape[], pen: Pen): string {
  const out = ['q', `${n(img.w)} 0 0 ${n(img.h)} ${n(img.x)} ${n(img.y)} cm`, '/Im0 Do', 'Q'];
  if (shapes.length) {
    const [r, g, b] = pen.color;
    out.push('q', `${n(r)} ${n(g)} ${n(b)} RG`, `${n(r)} ${n(g)} ${n(b)} rg`, `${n(pen.width)} w`, '1 J', '1 j');
    for (const s of shapes) {
      if (s.kind === 'ellipse') out.push(ellipsePath(s.cx, s.cy, s.rx, s.ry));
      else if (s.kind === 'line') out.push(`${n(s.x1)} ${n(s.y1)} m ${n(s.x2)} ${n(s.y2)} l S`);
      else { textWidth(s.text, s.size); out.push(`BT /F1 ${n(s.size)} Tf ${n(s.x)} ${n(s.y)} Td (${s.text}) Tj ET`); }
    }
    out.push('Q');
  }
  return out.join('\n') + '\n';
}

const enc = new TextEncoder();
const RED: Pen = { color: [0.86, 0.08, 0.1], width: 0.9 };

/**
 * PDF 한 파일을 쓴다. addPage를 쪽마다 부르고 끝에 finish. 객체 번호: 1 문서, 2 쪽 목록(끝에 씀), 3 글꼴, 그 뒤 쪽마다 그림·내용·쪽.
 * 교차 참조표(xref)에 적을 자리는 쓴 바이트 수로 센다
 */
export class PdfWriter {
  private offset = 0;
  private readonly offsets: number[] = []; // 객체 번호 → 파일 안 자리
  private readonly kids: number[] = [];
  private nextId = 4;
  private started = false;
  constructor(private readonly sink: Sink) {}

  private async put(chunk: Uint8Array | string): Promise<void> {
    const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    await this.sink.write(b);
    this.offset += b.length;
  }
  private async obj(id: number, body: string): Promise<void> {
    this.offsets[id] = this.offset;
    await this.put(`${id} 0 obj\n${body}\nendobj\n`);
  }
  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.put(new Uint8Array([...enc.encode('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // 둘째 줄은 이 파일이 이진 자료임을 알리는 관례
    await this.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    await this.obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  }

  get pageCount(): number { return this.kids.length; }

  async addPage(p: PdfPage): Promise<void> {
    await this.start();
    const size = pageSizeFor(p.info), img = fitImage(size, p.info);
    const imgId = this.nextId++, contentId = this.nextId++, pageId = this.nextId++;
    this.offsets[imgId] = this.offset;
    await this.put(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.info.width} /Height ${p.info.height} /ColorSpace /${p.info.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    await this.put(p.jpeg);
    await this.put('\nendstream\nendobj\n');
    const content = enc.encode(pageContent(img, p.shapes ?? [], p.pen ?? RED));
    this.offsets[contentId] = this.offset;
    await this.put(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    await this.put(content);
    await this.put('endstream\nendobj\n');
    await this.obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(size.w)} ${n(size.h)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    this.kids.push(pageId);
  }

  async finish(): Promise<void> {
    if (!this.kids.length) throw new DataError('PDF에 넣을 장이 없습니다');
    await this.obj(2, `<< /Type /Pages /Count ${this.kids.length} /Kids [${this.kids.map(k => `${k} 0 R`).join(' ')}] >>`);
    const xref = this.offset, size = this.nextId;
    const rows = ['xref', `0 ${size}`, '0000000000 65535 f\r'];
    for (let id = 1; id < size; id++) rows.push(`${String(this.offsets[id] ?? 0).padStart(10, '0')} 00000 n\r`);
    await this.put(`${rows.join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  }
}

/** 메모리에 모으는 쓰는 곳(검사·작은 파일용) */
export function memorySink(): Sink & { bytes(): Uint8Array } {
  const parts: Uint8Array[] = [];
  return {
    async write(c) { parts.push(c); },
    bytes() { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; },
  };
}
