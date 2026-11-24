import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCases, buildCriteria, criteriaOptionsArg, criteriaText, DEFAULT_CRITERIA_OPTIONS, type CriteriaBlock, type CriteriaDoc } from '../src/core/criteria.js';
import { criteriaHtml, escapeHtml } from '../src/core/criteria-html.js';
import { criteriaHwpx, escapeXml, sectionXml } from '../src/core/criteria-hwpx.js';
import { extractHwpxText, zipEntries, zipRead } from '../src/core/hwpx.js';
import { criteriaFileName } from '../src/core/names.js';
import { zipWrite } from '../src/core/zip-write.js';
import type { AnswerKey } from '../src/core/types.js';

const NOW = new Date(2026, 10, 24, 9, 0, 0);

/** 가짜 정답표: 순서 무관 묶음(2번), 요소형, 논술형, 응답형, 사례(쓰이는 것·쓰이지 않는 것) */
function fakeKey(): AnswerKey {
  return {
    세트: '가짜', 글: '가짜 글(작가)', 학기: '2026 2학기', 대상: { 학년: 2, 반: [3, 1] },
    정량: [
      { id: '1-1', 문항: 1, 설명: '인물 이름', 정답: '하늘', 허용: ['하늘이'], 유형: '단답형' },
      { id: '2-1', 문항: 2, 설명: '첫째 빈칸', 정답: '봄', 유형: '빈칸형', 순서무관: true },
      { id: '2-2', 문항: 2, 설명: '둘째 빈칸', 정답: '가을', 유형: '빈칸형', 순서무관: true },
      { id: '3-1', 문항: 3, 설명: '요소 1', 정답: '비가 온다', 유형: '요소형', 배점: 2 },
      { id: '4-1', 문항: 4, 설명: '인용 1', 정답: '바람이 분다', 유형: '논술형', 종류: '인용' },
      { id: '5-1', 문항: 5, 설명: '까닭', 정답: '여분으로', 핵심: ['여분'], 유형: '문장형' },
    ],
    정성: [{ id: 'E1', 문항: 6, 설명: '자기 생각', 배점: 3 }],
    채점규칙: { 넓은말: '인정' },
    사례: [
      { 단위: '5-1', 답: '남는 것', 판정: 'O', 일시: '2026-11-20T01:00:00Z', 출처: '검토 p07' },
      { 단위: '1-1', 답: '하늘이가', 판정: 'O', 일시: '2026-11-21T01:00:00Z', 출처: '검토 p03' },
      { 단위: '2-2', 답: '겨울', 판정: 'X', 일시: '2026-11-21T02:00:00Z', 출처: '검토 p04' }, // 자리 기준 X: 순서 무관이라 쓰지 않는다
      { 단위: '2-1', 답: '가을이', 판정: 'O', 일시: '2026-11-21T03:00:00Z', 출처: '검토 p05', 묶음: true },
    ],
  };
}
const tables = (d: CriteriaDoc) => d.blocks.filter((b): b is Extract<CriteriaBlock, { kind: 'table' }> => b.kind === 'table');
const headings = (d: CriteriaDoc) => d.blocks.filter(b => b.kind === 'heading').map(b => (b as { text: string }).text);
const all = { 정답: true, 규칙: true, 사례: true };

test('buildCriteria: 머리 정보·문항 표·응답형·규칙·사례·끝 줄', () => {
  const d = buildCriteria(fakeKey(), all, 'ko', NOW);
  assert.equal(d.제목, '가짜 글(작가) 채점 기준 안내');
  assert.deepEqual(d.머리, [['학기', '2026 2학기'], ['대상', '2학년 1·3반'], ['만점', '10점']]);
  assert.deepEqual(headings(d), ['문항별 채점 기준', '응답형 문항', '채점 규칙', '판정 사례']);
  const [qty, qual, cases] = tables(d);
  assert.deepEqual(qty!.columns.map(c => c.label), ['문항', '유형', '설명', '정답', '허용 답', '핵심어', '배점']);
  assert.ok(Math.abs(qty!.columns.reduce((s, c) => s + c.width, 0) - 1) < 1e-9);
  assert.deepEqual(qty!.rows[0], ['1', '단답형', '인물 이름', '하늘', '하늘이', '', '1']);
  assert.deepEqual(qty!.rows[3], ['3', '요소형', '요소 1', '비가 온다', '', '', '2']); // 요소형은 단위마다 한 줄
  assert.equal(qty!.rows[4]![1], '논술형 (인용)');
  assert.equal(qty!.rows[5]![5], '여분');
  assert.deepEqual(qual!.rows, [['6', '응답형', '자기 생각', '3']]);
  const list = d.blocks.find(b => b.kind === 'list') as { items: string[] };
  assert.deepEqual(list.items, ['맞춤법이 다르지만 뜻이 같은 답은 맞게(O) 봅니다.', '정답보다 넓은 말로 쓴 답은 맞게(O) 봅니다.', '핵심어가 여럿인 문장형 문항은 핵심어가 모두 있어야 맞습니다.']);
  assert.match(criteriaText(d), /응답형 문항은 내용과 관계없이 답을 쓰면 배점을 인정합니다/);
  assert.equal(d.끝, '만든 날: 2026-11-24 · 글눈으로 만듦');
  assert.doesNotMatch(criteriaText(d), /Claude/);
  assert.ok(cases);
});

test('buildCriteria: 순서 무관 묶음은 유형 칸에 표시하고 표 아래에 풀이', () => {
  const d = buildCriteria(fakeKey(), all, 'ko', NOW);
  const [qty] = tables(d);
  assert.equal(qty!.rows[1]![1], '빈칸형\n순서 무관');
  assert.equal(qty!.rows[2]![1], '빈칸형\n순서 무관');
  assert.equal(qty!.rows[0]![1], '단답형');
  const i = d.blocks.indexOf(qty!);
  assert.deepEqual(d.blocks[i + 1], { kind: 'note', text: "'순서 무관' 표시가 있는 칸: 같은 문항의 순서 무관 칸은 어느 칸에 어떤 순서로 써도 인정하고, 같은 정답은 한 번만 인정합니다." });
  const k = fakeKey();
  for (const u of k.정량) delete u.순서무관;
  assert.doesNotMatch(criteriaText(buildCriteria(k, all, 'ko', NOW)), /순서 무관/);
});

test('buildCriteria: 사례는 지금 쓰이는 것만, 정답표 단위 순서로, 출처·일시 없이', () => {
  const k = fakeKey();
  assert.deepEqual(activeCases(k).map(c => c.단위), ['1-1', '2-1', '5-1']);
  const d = buildCriteria(k, all, 'ko', NOW);
  const cases = tables(d)[2]!;
  assert.deepEqual(cases.columns.map(c => c.label), ['문항', '설명', '답', '판정']);
  assert.deepEqual(cases.rows, [['1', '인물 이름', '하늘이가', 'O'], ['2', '첫째 빈칸', '가을이', 'O'], ['5', '까닭', '남는 것', 'O']]);
  const text = criteriaText(d);
  assert.doesNotMatch(text, /겨울/); // 쓰이지 않는 사례
  assert.doesNotMatch(text, /검토 p0|p07|2026-11-2[01]T/); // 출처·일시
});

test('buildCriteria: 정답을 끄면 문항·유형·설명·배점만, 사례도 없다', () => {
  const d = buildCriteria(fakeKey(), { 정답: false, 규칙: true, 사례: true }, 'ko', NOW);
  const [qty] = tables(d);
  assert.deepEqual(qty!.columns.map(c => c.label), ['문항', '유형', '설명', '배점']);
  assert.deepEqual(qty!.rows[0], ['1', '단답형', '인물 이름', '1']);
  assert.ok(!headings(d).includes('판정 사례'));
  const text = criteriaText(d);
  for (const secret of ['하늘이', '비가 온다', '바람이 분다', '여분', '남는 것', '가을']) assert.ok(!text.includes(secret), secret);
});

test('buildCriteria: 규칙·사례를 끄면 그 절이 없고, 쓰이는 사례가 없으면 안내 한 줄', () => {
  const off = buildCriteria(fakeKey(), { 정답: true, 규칙: false, 사례: false }, 'ko', NOW);
  assert.deepEqual(headings(off), ['문항별 채점 기준', '응답형 문항']);
  const k = fakeKey(); k.사례 = [k.사례![2]!];
  const d = buildCriteria(k, all, 'ko', NOW);
  assert.ok(headings(d).includes('판정 사례'));
  assert.match(criteriaText(d), /지금 판정에 쓰는 사례가 없습니다/);
  assert.equal(tables(d).length, 2);
});

test('buildCriteria: 유형이 없는 옛 정답표는 화면과 같게 본다, 영어 표 머리', () => {
  const k = fakeKey();
  k.정량 = [{ id: '1-1', 문항: 1, 설명: 'a', 정답: 'x' }, { id: '2-1', 문항: 2, 설명: 'b', 정답: 'y' }, { id: '2-2', 문항: 2, 설명: 'c', 정답: 'z' }, { id: '3-1', 문항: 3, 설명: 'd', 정답: 'w', 핵심: ['w'] }];
  k.사례 = [];
  const d = buildCriteria(k, all, 'en', NOW);
  assert.deepEqual(tables(d)[0]!.rows.map(r => r[1]), ['Short', 'Blank', 'Blank', 'Sentence']);
  assert.deepEqual(tables(d)[0]!.columns.map(c => c.label), ['Q', 'Type', 'Description', 'Key', 'Also accept', 'Keywords', 'Points']);
  assert.equal(d.제목, '가짜 글(작가) Grading criteria');
  assert.equal(d.끝, 'Made on 2026-11-24 · Made with Geulnun');
});

test('criteriaOptionsArg: 모르는 값은 기본값, 정답을 끄면 사례도 끈다', () => {
  assert.deepEqual(criteriaOptionsArg(undefined), DEFAULT_CRITERIA_OPTIONS);
  assert.deepEqual(criteriaOptionsArg('x'), DEFAULT_CRITERIA_OPTIONS);
  assert.deepEqual(criteriaOptionsArg([1]), DEFAULT_CRITERIA_OPTIONS);
  assert.deepEqual(criteriaOptionsArg({ 형식: 'docx', 정답: 'yes', 규칙: 0, 사례: null, 경로: 'C:\\x' }), DEFAULT_CRITERIA_OPTIONS);
  assert.deepEqual(criteriaOptionsArg({ 형식: 'hwpx', 정답: false, 규칙: false, 사례: true }), { 형식: 'hwpx', 정답: false, 규칙: false, 사례: false });
  assert.deepEqual(criteriaOptionsArg({ 형식: 'pdf', 정답: true, 규칙: true, 사례: false }), { 형식: 'pdf', 정답: true, 규칙: true, 사례: false });
});

test('criteriaHtml: 답의 <·&·따옴표를 이스케이프한다', () => {
  assert.equal(escapeHtml(`<b a="1">&'`), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
  const k = fakeKey();
  k.글 = '<script>alert(1)</script>';
  k.사례 = [{ 단위: '1-1', 답: `<img src=x onerror="a()"> & 'b'`, 판정: 'O', 일시: '', 출처: '' }];
  const html = criteriaHtml(buildCriteria(k, all, 'ko', NOW), 'geulnun://app/criteria.css');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;'));
  assert.ok(html.includes('<link rel="stylesheet" href="geulnun://app/criteria.css">'));
  assert.ok(html.includes('<thead>')); // 여러 쪽 표의 머리 줄 반복
  assert.doesNotMatch(html, /style=|<style/); // CSP가 막는 인라인 꾸밈을 쓰지 않는다
  assert.ok(html.includes('빈칸형<br>순서 무관'));
});

test('zipWrite: zipEntries·zipRead로 다시 읽힌다(mimetype이 첫 항목·무압축)', () => {
  const big = '가나다'.repeat(2000);
  const zip = zipWrite([{ name: 'mimetype', data: 'application/hwp+zip', store: true }, { name: 'Contents/본문.xml', data: big }, { name: 'b.bin', data: Buffer.from([0, 1, 2, 255]) }], NOW);
  const es = zipEntries(zip);
  assert.deepEqual(es.map(e => e.name), ['mimetype', 'Contents/본문.xml', 'b.bin']);
  assert.equal(es[0]!.method, 0);
  assert.equal(es[0]!.localOffset, 0);
  assert.equal(zip.subarray(30, 38).toString(), 'mimetype'); // 파일 머리 바로 뒤에 이름, 그 뒤에 형식 글
  assert.equal(zip.subarray(38, 57).toString(), 'application/hwp+zip');
  assert.equal(es[1]!.method, 8);
  assert.ok(es[1]!.compressedSize < es[1]!.uncompressedSize);
  assert.equal(zipRead(zip, es[1]!).toString('utf8'), big);
  assert.deepEqual([...zipRead(zip, es[2]!)], [0, 1, 2, 255]);
});

test('criteriaHwpx: 저장소의 hwpx 글 뽑기로 표의 글이 나온다', () => {
  const k = fakeKey();
  k.사례 = [{ 단위: '1-1', 답: `<하늘> & "별"`, 판정: 'X', 일시: '', 출처: '' }];
  const buf = criteriaHwpx(buildCriteria(k, all, 'ko', NOW), NOW);
  const es = zipEntries(buf);
  assert.equal(es[0]!.name, 'mimetype');
  assert.equal(es[0]!.method, 0);
  assert.equal(zipRead(buf, es[0]!).toString(), 'application/hwp+zip');
  for (const n of ['version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf', 'META-INF/container.xml']) assert.ok(es.some(e => e.name === n), n);
  const text = extractHwpxText(buf);
  for (const s of ['가짜 글(작가) 채점 기준 안내', '문항별 채점 기준', '허용 답', '하늘이', '빈칸형', '순서 무관', '바람이 분다', '응답형 문항', '자기 생각', '채점 규칙', '판정 사례', '<하늘> & "별"', '만든 날: 2026-11-24 · 글눈으로 만듦']) assert.ok(text.includes(s), s);
  const sec = zipRead(buf, es.find(e => e.name === 'Contents/section0.xml')!).toString('utf8');
  assert.ok(sec.includes('&lt;하늘&gt; &amp; &quot;별&quot;'));
  assert.match(sec, /repeatHeader="1"/); // 쪽을 넘으면 머리 줄을 반복
  assert.match(sec, /treatAsChar="0"/); // 글자처럼 취급하면 쪽을 넘어 나뉘지 않는다
  assert.match(sec, /<hp:pagePr landscape="WIDELY" width="59528" height="84188"/); // A4
});

test('criteriaHwpx: 표 칸 수와 칸 너비 합이 맞고, XML에 못 넣는 글자는 버린다', () => {
  assert.equal(escapeXml('a\u0001b\u000bc<'), 'abc&lt;');
  const sec = sectionXml(buildCriteria(fakeKey(), all, 'ko', NOW));
  for (const m of sec.matchAll(/<hp:tbl [^>]*rowCnt="(\d+)" colCnt="(\d+)"[\s\S]*?<\/hp:tbl>/g)) {
    const rows = [...m[0].matchAll(/<hp:tr>([\s\S]*?)<\/hp:tr>/g)];
    assert.equal(rows.length, Number(m[1]));
    const tblW = Number(/<hp:sz width="(\d+)"/.exec(m[0])![1]);
    for (const r of rows) {
      const ws = [...r[1]!.matchAll(/<hp:cellSz width="(\d+)"/g)].map(x => Number(x[1]));
      assert.equal(ws.length, Number(m[2]));
      assert.equal(ws.reduce((s, w) => s + w, 0), tblW);
    }
  }
});

test('criteriaFileName: 학기_학년_글_채점기준.확장자', () => {
  const k = fakeKey();
  assert.equal(criteriaFileName(k, 'pdf'), '2026-2학기_2학년_가짜글_채점기준.pdf');
  assert.equal(criteriaFileName(k, 'hwpx'), '2026-2학기_2학년_가짜글_채점기준.hwpx');
});
