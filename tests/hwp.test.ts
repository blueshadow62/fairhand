import test from 'node:test';
import assert from 'node:assert/strict';
import { paraTextToString, sectionParagraphs } from '../src/core/hwp.js';

const u16 = (s: string) => Buffer.from(s, 'utf16le');

test('paraTextToString: 제어 문자 처리(줄바꿈 10, 문단 끝 13, 탭 9는 8 WCHAR, 확장 컨트롤 건너뜀)', () => {
  const ctrl = (code: number) => Buffer.concat([Buffer.from([code, 0]), Buffer.alloc(14)]); // 8 WCHAR
  const data = Buffer.concat([u16('가'), ctrl(9), u16('나'), Buffer.from([10, 0]), u16('다'), ctrl(11), u16('라'), Buffer.from([13, 0])]);
  assert.equal(paraTextToString(data), '가\t나\n다라');
});

test('sectionParagraphs: PARA_TEXT 레코드만 모으고 큰 크기 표기도 읽는다', () => {
  const rec = (tag: number, body: Buffer, big = false) => {
    const size = body.length;
    const h = Buffer.alloc(4); h.writeUInt32LE(((tag & 0x3ff) | ((big ? 0xfff : size) << 20)) >>> 0, 0);
    return big ? Buffer.concat([h, Buffer.from(new Uint32Array([size]).buffer), body]) : Buffer.concat([h, body]);
  };
  const data = Buffer.concat([rec(66, Buffer.alloc(8)), rec(67, u16('첫 문단')), rec(68, Buffer.alloc(4)), rec(67, u16('둘째'), true)]);
  assert.deepEqual(sectionParagraphs(data), ['첫 문단', '둘째']);
});

test('extractHwpText: 섹터 사슬이 고리를 이루는 조작 파일은 멈추지 않고 거절', async () => {
  const { readFileSync } = await import('node:fs');
  const { extractHwpText } = await import('../src/core/hwp.js');
  const buf = Buffer.from(readFileSync(new URL('../../tests/fixtures/문항지.hwp', import.meta.url)));
  // 첫 FAT 섹터의 모든 항목을 자기 자신을 가리키게 바꿔 고리를 만든다
  const fatSector = buf.readUInt32LE(0x4c), sectorSize = 1 << buf.readUInt16LE(0x1e);
  const off = (fatSector + 1) * sectorSize;
  for (let i = 0; i < sectorSize / 4; i++) buf.writeUInt32LE(i, off + i * 4);
  const t0 = Date.now();
  assert.throws(() => extractHwpText(buf));
  assert.ok(Date.now() - t0 < 2000);
});
