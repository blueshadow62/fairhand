import { inflateRawSync } from 'node:zlib';
import { DataError } from './types.js';

/**
 * hwp(한글 5.x 이진 형식)에서 글만 뽑는다. 외부 부품 없이:
 * 1) OLE 복합 문서(CFB)를 읽어 FileHeader와 BodyText/Section* 스트림을 꺼내고
 * 2) 섹션(보통 raw deflate 압축)을 풀어 레코드를 훑으며 HWPTAG_PARA_TEXT(문단 글)만 모은다.
 * 표·글상자 안의 문단도 같은 레코드라 함께 나온다. 암호·배포용 문서는 읽지 못한다.
 */

const MAX_SECTION = 32 * 1024 * 1024;   // 섹션 하나를 푼 크기 상한(압축 폭탄 방지)
const MAX_TOTAL = 64 * 1024 * 1024;

// ── OLE 복합 문서 ──
interface Entry { name: string; type: number; child: number; left: number; right: number; start: number; size: number }

function readCfb(buf: Buffer): { entries: Entry[]; stream(e: Entry): Buffer } {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) throw new DataError('hwp 형식(OLE 복합 문서)이 아닙니다');
  const sectorSize = 1 << buf.readUInt16LE(0x1e), miniSize = 1 << buf.readUInt16LE(0x20);
  if ((sectorSize !== 512 && sectorSize !== 4096) || miniSize !== 64) throw new DataError('hwp 파일의 섹터 크기가 이상합니다');
  const maxSectors = Math.ceil(buf.length / sectorSize);
  const numFat = buf.readUInt32LE(0x2c), firstDir = buf.readUInt32LE(0x30), miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c), numMiniFat = buf.readUInt32LE(0x40);
  let difatSector = buf.readUInt32LE(0x44);
  const sectorAt = (n: number): Buffer => { const off = (n + 1) * sectorSize; if (off + sectorSize > buf.length) throw new DataError('hwp 파일이 잘렸습니다'); return buf.subarray(off, off + sectorSize); };
  const END = 0xfffffffe, FREE = 0xffffffff;
  // DIFAT → FAT 섹터 번호 목록
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFat; i++) { const s = buf.readUInt32LE(0x4c + i * 4); if (s !== FREE) fatSectors.push(s); }
  const seenDifat = new Set<number>();
  for (; difatSector !== END && difatSector !== FREE && !seenDifat.has(difatSector) && seenDifat.size < 1000;) {
    seenDifat.add(difatSector);
    const sec = sectorAt(difatSector);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectors.length < numFat; i++) { const s = sec.readUInt32LE(i * 4); if (s !== FREE) fatSectors.push(s); }
    difatSector = sec.readUInt32LE(sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of new Set(fatSectors)) { const sec = sectorAt(s); for (let i = 0; i < sectorSize / 4; i++) fat.push(sec.readUInt32LE(i * 4)); }
  /** 섹터 사슬. 같은 섹터로 되돌아오면(고리) 멈추고, 길이는 스트림 크기만큼으로 제한한다(조작된 파일의 메모리 소진 방지) */
  const chain = (start: number, table: number[], maxLen: number): number[] => {
    const out: number[] = []; const seen = new Set<number>();
    for (let s = start; s !== END && s !== FREE && out.length < maxLen; s = table[s] ?? END) {
      if (s >= table.length || seen.has(s)) throw new DataError('hwp 파일의 섹터 사슬이 깨졌습니다'); seen.add(s); out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size: number): Buffer => {
    if (size > MAX_SECTION) throw new DataError('hwp 스트림이 너무 큽니다');
    return Buffer.concat(chain(start, fat, Math.min(maxSectors, Math.ceil(size / sectorSize))).map(sectorAt)).subarray(0, size);
  };
  // 디렉터리
  const dirData = Buffer.concat(chain(firstDir, fat, Math.min(maxSectors, 4096)).map(sectorAt));
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const nameLen = dirData.readUInt16LE(off + 64);
    const type = dirData[off + 66]!;
    if (type === 0) { entries.push({ name: '', type, child: -1, left: -1, right: -1, start: 0, size: 0 }); continue; }
    const name = dirData.subarray(off, off + Math.max(0, nameLen - 2)).toString('utf16le');
    const s32 = (p: number) => { const v = dirData.readUInt32LE(p); return v === FREE ? -1 : v; };
    entries.push({ name, type, left: s32(off + 68), right: s32(off + 72), child: s32(off + 76), start: dirData.readUInt32LE(off + 116), size: dirData.readUInt32LE(off + 120) });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new DataError('hwp 파일의 루트 항목이 없습니다');
  // 미니 스트림(작은 스트림은 루트의 데이터 안에 64바이트 단위로)
  let mini: Buffer | null = null, miniFat: number[] | null = null;
  const miniStream = (start: number, size: number): Buffer => {
    mini ??= readChain(root.start, root.size);
    if (!miniFat) { miniFat = []; if (numMiniFat > 0) for (const s of chain(firstMiniFat, fat, Math.min(maxSectors, numMiniFat))) { const sec = sectorAt(s); for (let i = 0; i < sectorSize / 4; i++) miniFat.push(sec.readUInt32LE(i * 4)); } }
    if (size > MAX_SECTION) throw new DataError('hwp 스트림이 너무 큽니다');
    const parts = chain(start, miniFat, Math.ceil(size / miniSize)).map(n => { const off = n * miniSize; if (off + miniSize > mini!.length) throw new DataError('hwp 파일의 미니 스트림이 잘렸습니다'); return mini!.subarray(off, off + miniSize); });
    return Buffer.concat(parts).subarray(0, size);
  };
  return { entries, stream: e => (e.size < miniCutoff ? miniStream(e.start, e.size) : readChain(e.start, e.size)) };
}

/** 이름으로 항목 찾기: 루트 아래 storage(BodyText)와 그 안 stream(Section0) */
function find(entries: Entry[], parent: Entry, name: string): Entry | undefined {
  // 재귀 대신 반복: 왼쪽 포인터로만 길게 이어진(조작된) 디렉터리에서 스택이 넘치지 않게. 방문 순서는 왼쪽 먼저
  const seen = new Set<number>(); const stack = [parent.child];
  while (stack.length) {
    const i = stack.pop()!;
    if (i < 0 || i >= entries.length || seen.has(i)) continue; seen.add(i);
    const e = entries[i]!;
    if (e.name === name) return e;
    stack.push(e.right, e.left);
  }
  return undefined;
}

// ── HWP 레코드 ──
const TAG_PARA_TEXT = 0x10 + 51;
/** 제어 문자 중 8 WCHAR(16바이트)를 차지하는 것(확장·인라인 컨트롤). 10·13·0·24~31은 1 WCHAR */
const WIDE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

export function paraTextToString(data: Buffer): string {
  let out = '';
  for (let i = 0; i + 1 < data.length;) {
    const c = data.readUInt16LE(i);
    if (c >= 32) { out += String.fromCharCode(c); i += 2; continue; }
    if (WIDE.has(c)) { if (c === 9) out += '\t'; i += 16; continue; }
    if (c === 10) out += '\n';
    else if (c === 13) { /* 문단 끝 */ }
    else if (c === 30 || c === 31) out += ' ';
    else if (c === 24) out += '-';
    i += 2;
  }
  return out;
}

/** 한 섹션(압축 푼 뒤)의 레코드에서 문단 글을 순서대로 */
export function sectionParagraphs(data: Buffer): string[] {
  const paras: string[] = [];
  for (let p = 0; p + 4 <= data.length;) {
    const h = data.readUInt32LE(p);
    const tag = h & 0x3ff; let size = h >>> 20; p += 4;
    if (size === 0xfff) { if (p + 4 > data.length) break; size = data.readUInt32LE(p); p += 4; }
    if (p + size > data.length) break;
    if (tag === TAG_PARA_TEXT) { const t = paraTextToString(data.subarray(p, p + size)); if (t.trim()) paras.push(t); }
    p += size;
  }
  return paras;
}

export function extractHwpText(buf: Buffer): string {
  const { entries, stream } = readCfb(buf);
  const root = entries[0]!;
  const header = find(entries, root, 'FileHeader');
  if (!header) throw new DataError('hwp 파일에 FileHeader가 없습니다');
  const hb = stream(header);
  if (hb.length < 40) throw new DataError('hwp FileHeader가 너무 짧습니다(깨진 파일)');
  if (!hb.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) throw new DataError('hwp 5.0 형식이 아닙니다(아주 옛 버전은 한글에서 다시 저장해 주세요)');
  const flags = hb.readUInt32LE(36);
  const compressed = (flags & 1) !== 0;
  if (flags & 2) throw new DataError('암호가 걸린 hwp는 읽을 수 없습니다. 암호를 풀어 저장해 주세요');
  if (flags & 4) throw new DataError('배포용 hwp는 읽을 수 없습니다. 원본 문서로 저장해 주세요');
  const body = find(entries, root, 'BodyText');
  if (!body) throw new DataError('hwp 파일에 본문(BodyText)이 없습니다');
  const sections: Entry[] = [];
  for (let i = 0; ; i++) { const s = find(entries, body, `Section${i}`); if (!s) break; sections.push(s); if (i > 200) break; }
  if (!sections.length) throw new DataError('hwp 파일에 본문 섹션이 없습니다');
  let used = 0;
  const out: string[] = [];
  for (const s of sections) {
    const raw = stream(s);
    let data: Buffer;
    try { data = compressed ? inflateRawSync(raw, { maxOutputLength: Math.min(MAX_SECTION, MAX_TOTAL - used) }) : raw; }
    catch (e) { throw new DataError(`hwp 본문을 풀지 못했습니다: ${(e as Error).message}`); }
    used += data.length;
    if (used > MAX_TOTAL) throw new DataError('hwp 본문이 너무 큽니다');
    out.push(...sectionParagraphs(data));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
