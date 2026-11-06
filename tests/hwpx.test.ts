import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeText, extractHwpxText, extractText, hwpxSectionText, zipEntries } from '../src/core/hwpx.js';
import { DataError } from '../src/core/types.js';

const fx = (n: string) => readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url));

test('extractHwpxText: kordoc으로 만든 hwpx에서 문항 글을 뽑는다', () => {
  const t = extractHwpxText(fx('문항지.hwpx'));
  assert.ok(t.includes('최 __ 과장은 누구인가'), t);
  assert.ok(t.includes('근로 __ 미작성'));
  assert.ok(t.indexOf('최 __') < t.indexOf('근로 __'));
});

test('hwpxSectionText: 문단 안 글을 잇고 문단은 줄바꿈, XML 글자 풀기', () => {
  const xml = '<hp:p><hp:run><hp:t>가 &amp; </hp:t><hp:t>나</hp:t></hp:run></hp:p><hp:p><hp:t>&lt;다&gt;</hp:t></hp:p>';
  assert.equal(hwpxSectionText(xml), '가 & 나\n<다>');
});

test('decodeText·extractText: utf-8 BOM, cp949, 확장자별 안내', () => {
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('한글', 'utf-8')])), '한글');
  assert.equal(decodeText(Buffer.from([0xc7, 0xd1, 0xb1, 0xdb])), '한글'); // cp949 '한글'
  assert.equal(extractText('a.txt', Buffer.from('x')), 'x');
  assert.throws(() => extractText('a.doc', Buffer.alloc(0)), (e: unknown) => e instanceof DataError && /docx나 pdf/.test(e.message));
  assert.throws(() => extractText('a.xyz', Buffer.alloc(0)), DataError);
  assert.throws(() => extractHwpxText(Buffer.from('not a zip')), DataError);
});

test('hwpxSectionText: 닫히지 않은 태그·hp:tbl은 건너뛰고 멈추지 않는다', () => {
  assert.equal(hwpxSectionText('<hp:tbl><hp:t>가</hp:t></hp:tbl><hp:p><hp:t>나'), '가');
  const big = '<hp:t'.repeat(20000);
  const t0 = Date.now(); hwpxSectionText(big); assert.ok(Date.now() - t0 < 500);
});

test('extractHwpxText: 너무 큰 항목은 거절(압축 폭탄 방지)', () => {
  // 중앙 목록의 크기만 큰 척하는 zip: 픽스처의 uncompressedSize 바이트를 덮어쓴다
  const buf = Buffer.from(fx('문항지.hwpx'));
  let eocd = -1; for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  let p = buf.readUInt32LE(eocd + 16), count = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < count; k++) { const n = buf.readUInt16LE(p + 28); if (buf.toString('utf8', p + 46, p + 46 + n).startsWith('Contents/section')) buf.writeUInt32LE(0x7fffffff, p + 24); p += 46 + n + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32); }
  assert.throws(() => extractHwpxText(buf), (e: unknown) => e instanceof DataError && /너무 큽니다/.test(e.message));
});

test('hwpxSectionText: 문단 끝 표식이 많아도 선형 시간', () => {
  const big = '<hp:p><hp:t>가</hp:t></hp:p>'.repeat(50000) + '<hp:t'.repeat(20000);
  const t0 = Date.now(); const out = hwpxSectionText(big); assert.ok(Date.now() - t0 < 1500); assert.ok(out.startsWith('가\n가'));
});

test('extractDocxText: 문단·표 안 글을 뽑고 빈 w:t는 무시', () => {
  const t = extractText('문항지.docx', fx('문항지.docx'));
  assert.equal(t, '시험 문항지(docx)\n1. 최 __ 과장은 누구인가.\n표 안 글');
});

test('extractHwpText: rhwp로 만든 hwp(압축 본문, 표 포함)에서 글을 뽑는다', () => {
  const t = extractText('문항지.hwp', fx('문항지.hwp'));
  assert.ok(t.includes('시험 문항지(hwp)'), t);
  assert.ok(t.includes('1. 최 __ 과장은 누구인가.') && t.includes('근로 __ 미작성'), t);
  assert.throws(() => extractText('a.hwp', Buffer.from('not ole')), (e: unknown) => e instanceof DataError && /OLE/.test(e.message));
});

test('extractText: 압축 데이터가 깨진 항목은 파일 이름과 함께 한글 오류', () => {
  // docx 픽스처는 deflate(method 8)라 본문 항목의 압축 데이터 앞 8바이트를 덮어써 깨뜨린다(목록은 그대로)
  const buf = Buffer.from(fx('문항지.docx'));
  const e = zipEntries(buf).find(x => x.name === 'word/document.xml')!;
  assert.equal(e.method, 8);
  const lo = e.localOffset, start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  buf.fill(0xff, start, start + 8);
  assert.throws(() => extractText('문항지.docx', buf), (err: unknown) => err instanceof DataError && /^문항지\.docx: zip 항목 word\/document\.xml이 깨져 풀지 못했습니다/.test(err.message));
});
