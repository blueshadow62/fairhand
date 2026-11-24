import { crc32, deflateRawSync } from 'node:zlib';

/**
 * 작은 zip 쓰기(외부 부품 없이). HWPX는 첫 항목 mimetype을 압축 없이 두어야 한다(파일 머리만 읽고 형식을 아는 프로그램이 있다).
 * 항목 이름은 UTF-8(일반 목적 비트 11), 크기는 4GB 아래(zip64 없음), 시각은 모두 같은 값을 쓴다
 */
export interface ZipInput { name: string; data: Buffer | string; /** 압축하지 않는다(mimetype) */ store?: boolean }

/** zip의 MS-DOS 날짜·시각(2초 단위, 지역 시각) */
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export function zipWrite(items: ZipInput[], now = new Date()): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const it of items) {
    const raw = typeof it.data === 'string' ? Buffer.from(it.data, 'utf8') : it.data;
    const name = Buffer.from(it.name, 'utf8');
    const method = it.store ? 0 : 8;
    const body = it.store ? raw : deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    // 30~41: 추가 칸·주석 길이, 디스크 번호, 내부·외부 속성은 0
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
