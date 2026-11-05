import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeText, extractHwpxText, extractText, hwpxSectionText } from '../src/core/hwpx.js';
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
  assert.throws(() => extractText('a.hwp', Buffer.alloc(0)), (e: unknown) => e instanceof DataError && /hwpx 또는 pdf/.test(e.message));
  assert.throws(() => extractText('a.xyz', Buffer.alloc(0)), DataError);
  assert.throws(() => extractHwpxText(Buffer.from('not a zip')), DataError);
});
