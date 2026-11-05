import { inflateRawSync } from 'node:zlib';
import { DataError } from './types.js';

/**
 * 문항지·지문 파일에서 글만 뽑는다. 외부 부품 없이: hwpx는 zip 안의 XML, txt는 utf-8/cp949.
 * hwp(2007 이전 이진 형식)는 읽지 못한다. 한글에서 hwpx·pdf로 저장하라고 안내한다.
 */

interface ZipEntry { name: string; method: number; compressedSize: number; localOffset: number }

function zipEntries(buf: Buffer): ZipEntry[] {
  // 끝의 central directory 끝 표식(0x06054b50)을 뒤에서부터 찾는다(주석이 있을 수 있어 최대 64KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new DataError('zip 형식이 아닙니다');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new DataError('zip 목록이 깨졌습니다');
    const method = buf.readUInt16LE(p + 10), compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf: Buffer, e: ZipEntry): Buffer {
  const p = e.localOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new DataError('zip 항목이 깨졌습니다');
  const nameLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
  const data = buf.subarray(p + 30 + nameLen + extraLen, p + 30 + nameLen + extraLen + e.compressedSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new DataError(`zip 압축 방식 ${e.method}은 지원하지 않습니다`);
}

const unescapeXml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** 한 section XML의 문단 글. 문단(hp:p) 안의 hp:t를 이어 붙이고, 문단은 줄바꿈으로. 표 안 글도 문단이라 함께 나온다. */
export function hwpxSectionText(xml: string): string {
  const paras: string[] = [];
  for (const p of xml.split(/<\/hp:p>/)) {
    const ts = [...p.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)].map(m => unescapeXml(m[1]!));
    if (ts.length) paras.push(ts.join(''));
  }
  return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractHwpxText(buf: Buffer): string {
  const entries = zipEntries(buf).filter(e => /^Contents\/section\d+\.xml$/i.test(e.name))
    .sort((a, b) => Number(/(\d+)/.exec(a.name)![1]) - Number(/(\d+)/.exec(b.name)![1]));
  if (!entries.length) throw new DataError('hwpx 안에 본문(Contents/section*.xml)이 없습니다');
  return entries.map(e => hwpxSectionText(zipRead(buf, e).toString('utf8'))).filter(Boolean).join('\n\n');
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
  if (ext === 'hwp') throw new DataError(`${name}: hwp(옛 형식)는 아직 읽지 못합니다. 한글에서 '다른 이름으로 저장'으로 hwpx 또는 pdf로 저장해 주세요`);
  if (ext === 'docx') throw new DataError(`${name}: docx는 아직 읽지 못합니다. pdf로 저장해 주세요`);
  throw new DataError(`${name}: 글을 뽑을 수 없는 형식입니다(txt, hwpx 가능. pdf와 그림은 그림으로 보냅니다)`);
}
