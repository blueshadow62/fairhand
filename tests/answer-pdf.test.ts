import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerPdfOptionsArg, answerPdfSummary, drawsMarks, markShape, MARK, orderPages, pageShapes, planAnswerPdf, regionBox, scoreShape, unitMarks,
  type AnswerPdfOptions,
} from '../src/core/answer-pdf.js';
import { answerPdfFileName, answerPdfFolderName, uniqueName } from '../src/core/names.js';
import { A4, fitImage, memorySink, pageSizeFor, PdfWriter, readJpegInfo, textWidth } from '../src/core/pdf.js';
import { DataError, type AnswerKey, type Transcript } from '../src/core/types.js';
import { exportAnswerPdf } from '../src/main/answer-pdf.js';

/** 가짜 JPEG: SOI, (APP0), SOF, EOI. 그림 자료는 없다(쪽 수·크기·xref 검사에는 풀지 않는다) */
function fakeJpeg(width: number, height: number, comps = 3, sof = 0xc0, app0 = true): Uint8Array {
  const app = app0 ? [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] : [];
  const comp = Array.from({ length: comps }, (_, i) => [i + 1, 0x11, 0]).flat();
  return new Uint8Array([0xff, 0xd8, ...app, 0xff, 0xff, sof, 0, 8 + 3 * comps, 8, height >> 8, height & 255, width >> 8, width & 255, comps, ...comp, 0xff, 0xd9]);
}

const key = (over: Partial<AnswerKey> = {}): AnswerKey => ({
  세트: '가짜', 글: '가짜 글(지은이)', 학기: '2026 2학기', 대상: { 학년: 3, 반: [1, 2] },
  정량: [{ id: '1-1', 문항: 1, 설명: '', 정답: '가' }, { id: '2-1', 문항: 2, 설명: '', 정답: '나', 배점: 2 }, { id: '3-1', 문항: 3, 설명: '', 정답: '다' }],
  정성: [{ id: 'E1', 문항: 4, 설명: '' }, { id: 'E2', 문항: 5, 설명: '' }],
  답영역: { '1-1': { x: 0.1, y: 0.2, w: 0.1, h: 0.02 }, '2-1': { x: 0.1, y: 0.3, w: 0.8, h: 0.1 }, '3-1': { x: 0.1, y: 0.5, w: 0.1, h: 0.02 }, E1: { x: 0.1, y: 0.7, w: 0.1, h: 0.02 }, E2: { x: 0.1, y: 0.8, w: 0.1, h: 0.02 } },
  ...over,
});
const tr = (page: number, who: [number | null, number | null, number | null, string | null], over: Partial<Transcript> = {}): Transcript => ({
  page, 학년: who[0], 반: who[1], 번호: who[2], 이름: who[3], 식별확신: who[0] === null ? '불명' : '확실',
  정량: { '1-1': { 답: '가', 판정: 'O' }, '2-1': { 답: '틀림', 판정: 'X' }, '3-1': { 답: '', 판정: '빈칸' } },
  정성: { E1: { 응답: true, 답: '썼다' }, E2: { 응답: false, 답: '' } },
  비고: [], 확인완료: true, ...over,
});
const OPT: AnswerPdfOptions = { 표시: true, 점수: true, 미확인표시: false, 묶음: 'one', 순서: 'student' };

test('readJpegInfo: SOF에서 크기·성분 수, APP 조각과 채움 바이트를 건너뛴다', () => {
  assert.deepEqual(readJpegInfo(fakeJpeg(1654, 2339), 'p01'), { width: 1654, height: 2339, components: 3 });
  assert.deepEqual(readJpegInfo(fakeJpeg(800, 600, 1, 0xc2, false), 'p01'), { width: 800, height: 600, components: 1 });
});

test('readJpegInfo: JPEG가 아니거나 CMYK·무손실·잘린 파일은 장 이름을 적은 DataError', () => {
  const bad = (b: Uint8Array, re: RegExp) => assert.throws(() => readJpegInfo(b, 'p07 그림'), (e: unknown) => e instanceof DataError && /^p07 그림: /.test(e.message) && re.test(e.message));
  bad(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), /JPEG 파일이 아님/);
  bad(fakeJpeg(10, 10, 4), /성분 4개/);
  bad(fakeJpeg(10, 10, 3, 0xc3), /지원하지 않는 JPEG/);
  bad(fakeJpeg(10, 10).slice(0, 12), /크기를 읽지 못함/);
  bad(fakeJpeg(0, 10), /크기가 0/);
});

test('쪽 크기와 그림 자리: A4, 가로 그림은 가로 쪽, 비율을 지켜 가운데', () => {
  assert.deepEqual(pageSizeFor({ width: 1654, height: 2339 }), { w: A4.w, h: A4.h });
  assert.deepEqual(pageSizeFor({ width: 2339, height: 1654 }), { w: A4.h, h: A4.w });
  const b = fitImage({ w: 600, h: 800 }, { width: 100, height: 100 });
  assert.deepEqual(b, { x: 0, y: 100, w: 600, h: 600 });
  // 그림 위가 0인 비율 영역 → PDF(아래가 0) 좌표
  assert.deepEqual(regionBox({ x: 0, y: 100, w: 600, h: 600 }, { x: 0.5, y: 0, w: 0.5, h: 0.1 }), { x: 300, y: 640, w: 300, h: 60 });
});

test('markShape: 작은 칸은 살짝 감싸고, 큰 칸은 상한까지만, 빗금은 왼쪽 아래에서 오른쪽 위로', () => {
  const small = markShape('circle', { x: 100, y: 100, w: 30, h: 16 });
  assert.equal(small.kind, 'ellipse');
  if (small.kind !== 'ellipse') return;
  assert.equal(small.cx, 115); assert.equal(small.cy, 108);
  assert.ok(small.rx > 15 && small.rx < 25 && small.ry > 8 && small.ry < 16, JSON.stringify(small));
  const big = markShape('circle', { x: 0, y: 0, w: 480, h: 80 });
  assert.ok(big.kind === 'ellipse' && big.rx === MARK.rxMax && big.ry === MARK.ryMax && big.cx === 240);
  const tiny = markShape('circle', { x: 0, y: 0, w: 2, h: 2 });
  assert.ok(tiny.kind === 'ellipse' && tiny.rx === MARK.rxMin && tiny.ry === MARK.ryMin);
  const sl = markShape('slash', { x: 0, y: 0, w: 480, h: 16 });
  assert.equal(sl.kind, 'line');
  if (sl.kind !== 'line') return;
  assert.ok(sl.x1 < sl.x2 && sl.y1 < sl.y2, '왼쪽 아래 → 오른쪽 위');
  assert.equal((sl.x1 + sl.x2) / 2, 240); assert.equal((sl.y1 + sl.y2) / 2, 8);
  assert.ok((sl.y2 - sl.y1) / (sl.x2 - sl.x1) >= 1 / MARK.slope - 1e-9, '너무 눕지 않는다');
});

test('unitMarks: 정량 O → 동그라미, X·빈칸 → 빗금, 정성 응답 → 동그라미·없음 → 빗금, 답영역 없는 단위는 없음', () => {
  const k = key();
  assert.deepEqual(unitMarks(k, tr(1, [3, 1, 1, '가'])).map(m => [m.단위, m.표시]),
    [['1-1', 'circle'], ['2-1', 'slash'], ['3-1', 'slash'], ['E1', 'circle'], ['E2', 'slash']]);
  const partial = key({ 답영역: { '2-1': { x: 0, y: 0, w: 1, h: 1 }, 없는단위: { x: 0, y: 0, w: 1, h: 1 } } });
  assert.deepEqual(unitMarks(partial, tr(1, [3, 1, 1, '가'])).map(m => m.단위), ['2-1']);
  // 전사에 없는 단위는 엑셀처럼 빈칸 → 빗금
  assert.deepEqual(unitMarks(k, tr(1, [3, 1, 1, '가'], { 정량: {}, 정성: {} })).map(m => m.표시), ['slash', 'slash', 'slash', 'slash', 'slash']);
});

test('drawsMarks·pageShapes: 확인하지 않은 장은 고를 때만, 점수는 합계/만점을 오른쪽 위에', () => {
  const k = key(), info = { width: 1654, height: 2339 };
  const un = tr(1, [3, 1, 1, '가'], { 확인완료: false });
  assert.equal(drawsMarks(un, OPT), false);
  assert.equal(drawsMarks(un, { ...OPT, 미확인표시: true }), true);
  assert.equal(drawsMarks(tr(1, [3, 1, 1, '가']), { ...OPT, 표시: false }), false);
  assert.equal(drawsMarks(null, { ...OPT, 미확인표시: true }), false);
  assert.deepEqual(pageShapes(k, un, info, OPT), []);
  const shapes = pageShapes(k, tr(1, [3, 1, 1, '가']), info, OPT);
  assert.equal(shapes.length, 6);
  const score = shapes.at(-1)!;
  // 1-1(1점) + E1(1점) = 2, 만점 1+2+1+1+1 = 6
  assert.ok(score.kind === 'text' && score.text === '2/6');
  if (score.kind === 'text') assert.ok(Math.abs(score.x + textWidth('2/6', score.size) - (A4.w - MARK.scoreMargin)) < 1e-6 && score.y > A4.h - 60);
  assert.equal(pageShapes(k, tr(1, [3, 1, 1, '가']), info, { ...OPT, 점수: false }).length, 5);
  assert.ok(scoreShape(A4, '7.5/10').kind === 'text');
  assert.throws(() => textWidth('가', 10), DataError);
});

test('answerPdfSummary: 장 수, 확인하지 않은 장(전사 없는 장 포함), 답 칸을 잡은 단위 수', () => {
  const k = key({ 답영역: { '1-1': { x: 0, y: 0, w: 1, h: 1 }, E2: { x: 0, y: 0, w: 1, h: 1 } } });
  assert.deepEqual(answerPdfSummary(k, [tr(1, [3, 1, 1, null]), tr(2, [3, 1, 2, null], { 확인완료: false })], [1, 2, 3]), { 장수: 3, 미확인: 2, 답칸: 2, 단위: 5 });
});

test('answerPdfOptionsArg: 모르는 값은 기본값', () => {
  assert.deepEqual(answerPdfOptionsArg({ 표시: 'yes', 묶음: 'x', 순서: 'page', 점수: false }), { 표시: false, 점수: false, 미확인표시: false, 묶음: 'one', 순서: 'page' });
  assert.deepEqual(answerPdfOptionsArg(null), { 표시: false, 점수: true, 미확인표시: false, 묶음: 'one', 순서: 'student' });
});

test('orderPages: 학년·반·번호순, 알아보지 못한 장과 전사 없는 장은 뒤에 장 번호순', () => {
  const ts = [tr(1, [3, 2, 1, null]), tr(2, [null, null, null, null]), tr(3, [3, 1, 5, null]), tr(4, [3, 1, 2, null]), tr(6, [3, 1, 2, null])];
  const by = new Map(ts.map(t => [t.page, t]));
  assert.deepEqual(orderPages([6, 5, 4, 3, 2, 1], by, 'student'), [4, 6, 3, 1, 2, 5]);
  assert.deepEqual(orderPages([6, 5, 4, 3, 2, 1], by, 'page'), [1, 2, 3, 4, 5, 6]);
});

test('planAnswerPdf: 한 파일·반별·학생별 묶음과 이름(겹치면 번호)', () => {
  const k = key(), d = new Date(2026, 10, 23);
  const ts = [tr(1, [3, 2, 1, '김하나']), tr(2, [null, null, null, null]), tr(3, [3, 1, 5, '이:둘']), tr(4, [3, 1, 2, null]), tr(5, [3, 1, 2, null])];
  const one = planAnswerPdf(k, ts, [1, 2, 3, 4, 5], OPT, d);
  assert.equal(one.폴더, undefined);
  assert.deepEqual(one.files, [{ 이름: '2026-2학기_3학년_1·2반_가짜글_채점답안지_2026-11-23.pdf', pages: [4, 5, 3, 1, 2] }]);
  assert.equal(planAnswerPdf(k, ts, [1], { ...OPT, 표시: false }, d).files[0]!.이름, '2026-2학기_3학년_1·2반_가짜글_답안지_2026-11-23.pdf');

  const cls = planAnswerPdf(k, ts, [1, 2, 3, 4, 5], { ...OPT, 묶음: 'class', 순서: 'page' }, d);
  assert.equal(cls.폴더, '2026-2학기_3학년_1·2반_가짜글_채점답안지_2026-11-23');
  assert.deepEqual(cls.files.map(f => [f.이름.split('_')[2], f.pages]), [['1반', [3, 4, 5]], ['2반', [1]], ['반미확인', [2]]]);

  const st = planAnswerPdf(k, ts, [1, 2, 3, 4, 5], { ...OPT, 묶음: 'student' }, d);
  assert.deepEqual(st.files.map(f => f.이름), [
    '2026-2학기_3학년_1반02번_가짜글_채점답안지_2026-11-23.pdf',
    '2026-2학기_3학년_1반02번_가짜글_채점답안지_2026-11-23 (2).pdf', // 같은 번호 두 장
    '2026-2학기_3학년_1반05번_이-둘_가짜글_채점답안지_2026-11-23.pdf', // 파일 이름에 못 쓰는 글자
    '2026-2학기_3학년_2반01번_김하나_가짜글_채점답안지_2026-11-23.pdf',
    '2026-2학기_3학년_미확인-p02_가짜글_채점답안지_2026-11-23.pdf',
  ]);
  assert.ok(st.files.every(f => f.pages.length === 1));
  assert.deepEqual(planAnswerPdf(k, [], [], OPT, d).files, []);
});

test('names: 답안지 PDF 이름과 겹치지 않는 이름', () => {
  const k = key(), d = new Date(2026, 0, 5);
  assert.equal(answerPdfFileName(k, d, false, '1반'), '2026-2학기_3학년_1반_가짜글_답안지_2026-01-05.pdf');
  assert.equal(answerPdfFolderName(k, d, true), '2026-2학기_3학년_1·2반_가짜글_채점답안지_2026-01-05');
  const taken = new Set(['a.pdf', 'a (2).pdf']);
  assert.equal(uniqueName('a.pdf', n => taken.has(n)), 'a (3).pdf');
  assert.equal(uniqueName('폴더', n => n === '폴더'), '폴더 (2)');
});

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = (): Promise<PdfJs> => import('pdfjs-dist/legacy/build/pdf.mjs');

/** xref의 자리마다 'n 0 obj'가 있고 startxref가 xref를 가리키는지 */
function checkXref(bytes: Uint8Array): void {
  const s = Buffer.from(bytes).toString('latin1');
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
  assert.equal(s.slice(start, start + 4), 'xref');
  const m = /^xref\n0 (\d+)\n/.exec(s.slice(start))!;
  const count = Number(m[1]);
  const rows = s.slice(start + m[0].length).split('\n').slice(0, count);
  assert.equal(rows[0], '0000000000 65535 f\r');
  for (let id = 1; id < count; id++) {
    assert.equal(rows[id]!.length, 19); // 끝의 \n과 합쳐 20바이트
    const off = Number(rows[id]!.slice(0, 10));
    assert.equal(s.slice(off, off + `${id} 0 obj`.length), `${id} 0 obj`, `객체 ${id}`);
  }
  assert.match(s, new RegExp(`trailer\\n<< /Size ${count} /Root 1 0 R >>`));
}

test('PdfWriter: 쪽 수·쪽 크기·xref가 맞고 pdf.js로 다시 열린다', async () => {
  const sink = memorySink(), w = new PdfWriter(sink);
  const portrait = fakeJpeg(1654, 2339), land = fakeJpeg(2339, 1654, 1);
  await w.addPage({ jpeg: portrait, info: readJpegInfo(portrait, 'p01'), shapes: [{ kind: 'ellipse', cx: 100, cy: 100, rx: 10, ry: 8 }, { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 9 }, { kind: 'text', x: 500, y: 800, size: 20, text: '4.5/10' }] });
  await w.addPage({ jpeg: land, info: readJpegInfo(land, 'p02') });
  await w.finish();
  const bytes = sink.bytes();
  checkXref(bytes);
  const s = Buffer.from(bytes).toString('latin1');
  assert.match(s, /\/Width 1654 \/Height 2339 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 42 >>/); // 가짜 JPEG 42바이트
  assert.match(s, /\/ColorSpace \/DeviceGray/);
  assert.ok(s.includes(Buffer.from(portrait).toString('latin1')), 'JPEG를 다시 압축하지 않고 그대로 넣는다');
  const task = (await pdfjs()).getDocument({ data: bytes, verbosity: 0 }), doc = await task.promise;
  try {
    assert.equal(doc.numPages, 2);
    const p1 = await doc.getPage(1), p2 = await doc.getPage(2);
    assert.deepEqual(p1.view, [0, 0, A4.w, A4.h]);
    assert.deepEqual(p2.view, [0, 0, A4.h, A4.w]);
    assert.deepEqual((await p1.getTextContent()).items.map(i => ('str' in i ? i.str : '')), ['4.5/10']);
  } finally { await task.destroy(); } // pdf.js 6은 불러오기 작업을 닫는다
  await assert.rejects(new PdfWriter(memorySink()).finish(), DataError);
});

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));

test('exportAnswerPdf: 고른 폴더에 쓰고, 같은 이름은 덮어쓰지 않으며, 깨진 그림은 장을 적은 오류', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'geulnun-pdf-'));
  try {
    const set = path.join(root, '세트'), out = path.join(root, '받기');
    await cp(FX, set, { recursive: true });
    await mkdir(path.join(set, 'pages'), { recursive: true }); await mkdir(out);
    for (const p of [1, 2, 3]) await writeFile(path.join(set, 'pages', `p0${p}.jpg`), fakeJpeg(1654, 2339));
    const now = () => new Date(2026, 10, 23);
    const plain: AnswerPdfOptions = { 표시: false, 점수: true, 미확인표시: false, 묶음: 'one', 순서: 'student' };
    const a = await exportAnswerPdf(set, out, plain, { now });
    assert.equal(a.파일.length, 1); assert.equal(a.장수, 3); assert.equal(a.표시장수, 0); assert.equal(a.폴더, out);
    const b = await exportAnswerPdf(set, out, plain, { now });
    assert.notEqual(a.파일[0], b.파일[0]);
    assert.match(b.파일[0]!, / \(2\)\.pdf$/);
    const task = (await pdfjs()).getDocument({ data: new Uint8Array(await readFile(a.파일[0]!)), verbosity: 0 });
    assert.equal((await task.promise).numPages, 3); await task.destroy();

    // 반별: 하위 폴더에, 남은 임시 파일 없음
    const c = await exportAnswerPdf(set, out, { ...plain, 묶음: 'class' }, { now });
    assert.equal(path.dirname(c.폴더), out);
    assert.deepEqual((await readdir(c.폴더)).sort(), c.파일.map(f => path.basename(f)).sort());
    assert.equal(c.파일.length, 2); // 1반, 알아보지 못한 장

    // 답 칸이 없으면 표시를 넣을 수 없다
    await assert.rejects(exportAnswerPdf(set, out, { ...plain, 표시: true }, { now }), /답 칸을 잡은 단위가 없어/);

    await writeFile(path.join(set, 'pages', 'p02.jpg'), 'PNG가 아닌 글');
    await assert.rejects(exportAnswerPdf(set, out, plain, { now }), (e: unknown) => e instanceof DataError && /p02 그림/.test(e.message));
    assert.ok(!(await readdir(out)).some(n => n.endsWith('.part')), '실패해도 임시 파일을 남기지 않는다');
  } finally { await rm(root, { recursive: true, force: true }); }
});
