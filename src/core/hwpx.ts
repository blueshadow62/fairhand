import { inflateRawSync } from 'node:zlib';
import { extractHwpText } from './hwp.js';
import { DataError } from './types.js';

/**
 * 문항지·지문 파일에서 글만 뽑는다. 외부 부품 없이: hwpx는 zip 안의 XML, txt는 utf-8/cp949.
 * hwp(2007 이전 이진 형식)는 읽지 못한다. 한글에서 hwpx·pdf로 저장하라고 안내한다.
 */

interface ZipEntry { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number }
/** 압축 폭탄 방지: 항목 하나 20MB, 본문 모두 합쳐 50MB까지만 푼다(문항지 글은 수십 KB) */
const MAX_ENTRY = 20 * 1024 * 1024, MAX_TOTAL = 50 * 1024 * 1024;

export function zipEntries(buf: Buffer): ZipEntry[] {
  // 끝의 central directory 끝 표식(0x06054b50)을 뒤에서부터 찾는다(주석이 있을 수 있어 최대 64KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new DataError('zip 형식이 아닙니다');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + 46 > buf.length) throw new DataError('zip 목록 위치가 파일 밖입니다');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new DataError('zip 목록이 깨졌습니다');
    const method = buf.readUInt16LE(p + 10), compressedSize = buf.readUInt32LE(p + 20), uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new DataError('zip 목록이 깨졌습니다');
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function zipRead(buf: Buffer, e: ZipEntry, budget = MAX_ENTRY): Buffer {
  const p = e.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new DataError('zip 항목이 깨졌습니다');
  if (e.uncompressedSize > budget) throw new DataError(`zip 항목 ${e.name}이 너무 큽니다(${Math.round(e.uncompressedSize / 1048576)}MB)`);
  const nameLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen, end = start + e.compressedSize;
  if (end > buf.length) throw new DataError('zip 항목이 파일 밖까지 이어집니다');
  const data = buf.subarray(start, end);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: budget }); // 목록의 크기를 속여도 여기서 막힌다
  throw new DataError(`zip 압축 방식 ${e.method}은 지원하지 않습니다`);
}

const unescapeXml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/**
 * 한 section XML의 문단 글. 문단(hp:p) 안의 hp:t를 이어 붙이고, 문단은 줄바꿈으로. 표 안 글도 문단이라 함께 나온다.
 * 정규식 대신 indexOf로 한 번씩 훑는다(깨진 XML에서도 선형 시간).
 */
export function hwpxSectionText(xml: string): string {
  const paras: string[] = [];
  let cur = '', i = 0;
  // 찾은 위치를 기억해 i가 그 앞을 지날 때만 다시 찾는다(-1은 '더 없음')
  let t = -2, pe = -2;
  for (;;) {
    if (t !== -1 && t < i) t = xml.indexOf('<hp:t', i);
    if (pe !== -1 && pe < i) pe = xml.indexOf('</hp:p>', i);
    if (pe >= 0 && (t < 0 || pe < t)) { if (cur) paras.push(cur); cur = ''; i = pe + 7; continue; }
    if (t < 0) break;
    const open = xml.indexOf('>', t); if (open < 0) break;
    const tag = xml.slice(t + 5, open); // '' 또는 ' attr…' 이면 hp:t, 'bl…'이면 hp:tbl 같은 다른 태그
    if (tag !== '' && !/^\s/.test(tag)) { i = open + 1; continue; }
    const close = xml.indexOf('</hp:t>', open + 1); if (close < 0) break;
    cur += unescapeXml(xml.slice(open + 1, close));
    i = close + 7;
  }
  if (cur) paras.push(cur);
  return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractHwpxText(buf: Buffer): string {
  const entries = zipEntries(buf).filter(e => /^Contents\/section\d+\.xml$/i.test(e.name))
    .sort((a, b) => Number(/(\d+)/.exec(a.name)![1]) - Number(/(\d+)/.exec(b.name)![1]));
  if (!entries.length) throw new DataError('hwpx 안에 본문(Contents/section*.xml)이 없습니다');
  if (entries.length > 200) throw new DataError('hwpx 본문 조각이 너무 많습니다');
  // 실제로 푼 바이트를 누적해 전체 상한을 지킨다(목록의 크기는 믿지 않는다)
  let used = 0;
  const texts: string[] = [];
  for (const e of entries) {
    const data = zipRead(buf, e, Math.min(MAX_ENTRY, MAX_TOTAL - used));
    used += data.length;
    if (used > MAX_TOTAL) throw new DataError('hwpx 본문이 너무 큽니다(50MB 초과)');
    texts.push(hwpxSectionText(data.toString('utf8')));
  }
  return texts.filter(Boolean).join('\n\n');
}

/** docx(zip 안 word/document.xml): 문단(w:p) 안의 w:t를 잇고 문단은 줄바꿈. 표 안 글도 문단이라 함께 나온다 */
export function docxSectionText(xml: string): string {
  const paras: string[] = [];
  let cur = '', i = 0, t = -2, pe = -2;
  for (;;) {
    if (t !== -1 && t < i) t = xml.indexOf('<w:t', i);
    if (pe !== -1 && pe < i) pe = xml.indexOf('</w:p>', i);
    if (pe >= 0 && (t < 0 || pe < t)) { if (cur) paras.push(cur); cur = ''; i = pe + 6; continue; }
    if (t < 0) break;
    const open = xml.indexOf('>', t); if (open < 0) break;
    const tag = xml.slice(t + 4, open); // '' 또는 ' xml:space…' 이면 w:t, 'bl'·'c' 등이면 다른 태그(w:tbl, w:tc)
    if (tag !== '' && !/^\s/.test(tag) && tag !== '/') { i = open + 1; continue; }
    if (tag === '/') { i = open + 1; continue; } // <w:t/>
    const close = xml.indexOf('</w:t>', open + 1); if (close < 0) break;
    cur += unescapeXml(xml.slice(open + 1, close));
    i = close + 6;
  }
  if (cur) paras.push(cur);
  return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractDocxText(buf: Buffer): string {
  const e = zipEntries(buf).find(x => x.name === 'word/document.xml');
  if (!e) throw new DataError('docx 안에 본문(word/document.xml)이 없습니다');
  return docxSectionText(zipRead(buf, e).toString('utf8'));
}

/** utf-8(BOM 허용)로 읽되, 깨진 글자가 나오면 cp949로 다시 읽는다(메모장 옛 저장본) */
export function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return utf8; }
}

/** 파일 이름의 확장자로 글을 뽑는다. 그림·pdf는 여기서 다루지 않는다(렌더러가 그림으로 만든다). */
export function extractText(name: string, buf: Buffer): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  if (ext === 'txt' || ext === 'md') return decodeText(buf);
  if (ext === 'hwpx') return extractHwpxText(buf);
  if (ext === 'hwp') { try { return extractHwpText(buf); } catch (e) { throw new DataError(`${name}: ${(e as Error).message}`); } }
  if (ext === 'docx') return extractDocxText(buf);
  if (ext === 'doc') throw new DataError(`${name}: doc(옛 Word 형식)는 읽지 못합니다. Word에서 docx나 pdf로 저장해 주세요`);
  throw new DataError(`${name}: 글을 뽑을 수 없는 형식입니다(txt, hwp, hwpx, docx 가능. pdf와 그림은 그림으로 보냅니다)`);
}
