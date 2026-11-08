import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKey } from '../src/core/key.js';
import { draftToRows, emptyRow, keyToRows, parseClasses, rowsHaveContent, rowsToKey, validateRows, type UnitRow } from '../src/renderer/lib/key-form.js';

const key = parseKey(readFileSync(new URL('../../tests/fixtures/세트샘플/정답표.json', import.meta.url), 'utf-8'));
const meta = { 글: '알바생 자르기(장강명)', 학기: '2026 2학기', 학년: 3, 반: [1, 3], 인원: {} };

test('rowsToKey: 유형별 id 부여와 허용·핵심 쉼표 나누기', () => {
  const rows: UnitRow[] = [
    { 문항: 1, 유형: '빈칸형', 설명: '최 __ 과장', 정답: '은영', 허용: '최은영, 최 은영', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' },
    { 문항: 1, 유형: '빈칸형', 설명: '__ 대리', 정답: '혜미', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' },
    { 문항: 3, 유형: '문장형', 설명: '조직 ___', 정답: '붙임성이 있어야 한다', 허용: '', 핵심: '붙임성', 요소: '', 배점: '1', 용어배점: '1' },
    { 문항: 4, 유형: '요소형', 설명: '요소', 정답: '', 허용: '', 핵심: '', 요소: '집\n학교', 배점: '1', 용어배점: '1' },
    { 문항: 1, 유형: '응답형', 설명: '파견의 문제점', 정답: '', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' },
  ];
  const k = rowsToKey(meta, rows);
  assert.deepEqual(k.정량.map(u => u.id), ['1-1', '1-2', '3-1', '4-1', '4-2']);
  assert.deepEqual(k.정량.map(u => u.유형), ['빈칸형', '빈칸형', '문장형', '요소형', '요소형']);
  assert.deepEqual(k.정량[0]!.허용, ['최은영', '최 은영']);
  assert.deepEqual(k.정량[2]!.핵심, ['붙임성']);
  assert.deepEqual(k.정량.slice(3).map(u => u.정답), ['집', '학교']);
  assert.deepEqual(k.정성, [{ id: 'E1', 문항: 1, 설명: '파견의 문제점' }]);
  assert.equal(k.세트, '2026 2학기 3학년 알바생 자르기(장강명)');
  assert.deepEqual(k.대상, { 학년: 3, 반: [1, 3] });
  assert.equal(k.확인, undefined);
});

test('keyToRows → rowsToKey 왕복이 같다', () => {
  const { meta: m, rows } = keyToRows(key);
  const back = rowsToKey(m, rows, key.확인);
  assert.deepEqual(back.정량.map(({ 유형: _t, ...u }) => u), key.정량); // 픽스처(옛 양식)에는 유형이 없다
  assert.deepEqual(back.정성, key.정성);
  assert.deepEqual(back.대상, key.대상);
});

test('validateRows: 비었거나 틀린 것을 한글로', () => {
  const errs = validateRows({ ...meta, 글: '', 반: [] }, [{ 문항: 0, 유형: '단답형', 설명: '', 정답: '', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' }, { 문항: 2, 유형: '문장형', 설명: '', 정답: 'x', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' }]);
  assert.ok(errs.some(e => e.includes('글')) && errs.some(e => e.includes('반')));
  assert.ok(errs.some(e => e.includes('문항 번호')) && errs.some(e => e.includes('정답')) && errs.some(e => e.includes('핵심')));
  assert.deepEqual(validateRows(meta, [{ 문항: 1, 유형: '단답형', 설명: 'x', 정답: 'y', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' }]), []);
});

test('rowsHaveContent: 번호·유형·배점만 있는 빈 행이나 공백은 내용이 아니다', () => {
  assert.equal(rowsHaveContent([]), false);
  assert.equal(rowsHaveContent([emptyRow(), emptyRow(2, '요소형'), { ...emptyRow(3), 설명: '  ', 배점: '2' }]), false);
  assert.equal(rowsHaveContent([emptyRow(), { ...emptyRow(2), 허용: '세' }]), true);
  assert.equal(rowsHaveContent([{ ...emptyRow(1, '요소형'), 요소: '집\n학교' }]), true);
});

test('draftToRows: 초안을 편집 행으로', () => {
  const rows = draftToRows({ 정량: [{ id: '1-1', 문항: 1, 설명: 'a', 정답: 'b', 허용: ['c'] }, { id: '3-1', 문항: 3, 설명: 'd', 정답: 'e', 핵심: ['f'] }], 정성: [{ id: 'E1', 문항: 1, 설명: 'g' }], 주의: [] });
  assert.equal(rows[0]!.허용, 'c'); assert.equal(rows[1]!.유형, '문장형'); assert.equal(rows[2]!.유형, '응답형');
});

test('채점규칙·사례: 기본값이면 필드 없음, 바꾸면 들어가고, 왕복 보존', () => {
  const rows: UnitRow[] = [{ 문항: 1, 유형: '단답형', 설명: 'x', 정답: 'y', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' }];
  assert.equal(rowsToKey({ ...meta, 채점규칙: { 맞춤법: '인정', 넓은말: '불인정', 핵심어: '모두' } }, rows).채점규칙, undefined);
  const k = rowsToKey({ ...meta, 채점규칙: { 맞춤법: '인정', 넓은말: '인정', 핵심어: '모두' } }, rows, undefined, [{ 단위: '1-1', 답: 'z', 판정: 'X', 일시: 'a', 출처: 'b' }]);
  assert.equal(k.채점규칙?.넓은말, '인정');
  assert.equal(k.사례?.length, 1);
  const back = keyToRows(k);
  assert.deepEqual(back.meta.채점규칙, { 맞춤법: '인정', 넓은말: '인정', 핵심어: '모두' });
  assert.deepEqual(rowsToKey(back.meta, back.rows, undefined, k.사례), k);
});

test('parseClasses: 범위(1~6, 1-6)와 섞어 쓰기, 겹침은 하나로', () => {
  assert.deepEqual(parseClasses('1~6'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseClasses('1-3, 5'), [1, 2, 3, 5]);
  assert.deepEqual(parseClasses('3 1 3'), [1, 3]);
  assert.deepEqual(parseClasses('가, 0'), []);
});

test('배점: 기본 1점은 쓰지 않고, 바꾼 배점은 단위마다(요소형은 요소마다) 들어가고 왕복된다', () => {
  const rows: UnitRow[] = [
    { 문항: 1, 유형: '단답형', 설명: 'a', 정답: 'b', 허용: '', 핵심: '', 요소: '', 배점: '1', 용어배점: '1' },
    { 문항: 2, 유형: '요소형', 설명: '', 정답: '', 허용: '', 핵심: '', 요소: '집\n학교', 배점: '2', 용어배점: '1' },
    { 문항: 3, 유형: '응답형', 설명: 'c', 정답: '', 허용: '', 핵심: '', 요소: '', 배점: '0.5', 용어배점: '1' },
  ];
  const k = rowsToKey(meta, rows);
  assert.equal(k.정량[0]!.배점, undefined);
  assert.deepEqual(k.정량.slice(1).map(u => u.배점), [2, 2]);
  assert.equal(k.정성[0]!.배점, 0.5);
  assert.deepEqual(keyToRows(k).rows.map(r => r.배점), ['1', '2', '0.5']);
  assert.ok(validateRows(meta, [{ ...rows[0]!, 배점: '0', 용어배점: '1' }]).some(e => e.includes('배점')));
  assert.ok(validateRows(meta, [{ ...rows[0]!, 배점: '', 용어배점: '1' }]).some(e => e.includes('배점')));
});

test('논술형: 인용할 문장(줄마다)·써야 할 용어(쉼표, 다른 표기 /)를 단위로 나누고 인용·용어 배점을 따로, 왕복된다', () => {
  const essay: UnitRow = { 문항: 5, 유형: '논술형', 설명: '', 정답: '', 허용: '', 핵심: '구성주의, 학습자 중심/학습자중심', 요소: '배움은 삶이다\n앎은 함께 만든다', 배점: '2', 용어배점: '1' };
  const k = rowsToKey(meta, [essay]);
  assert.deepEqual(k.정량.map(u => [u.id, u.설명, u.정답, u.종류, u.배점]), [
    ['5-1', '인용 1', '배움은 삶이다', '인용', 2], ['5-2', '인용 2', '앎은 함께 만든다', '인용', 2],
    ['5-3', '용어 1', '구성주의', '용어', undefined], ['5-4', '용어 2', '학습자 중심', '용어', undefined]]);
  assert.deepEqual(k.정량[3]!.허용, ['학습자중심']);
  assert.ok(k.정량.every(u => u.유형 === '논술형'));
  const back = keyToRows(k).rows;
  assert.equal(back.length, 1);
  assert.deepEqual([back[0]!.유형, back[0]!.요소, back[0]!.핵심, back[0]!.배점, back[0]!.용어배점],
    ['논술형', '배움은 삶이다\n앎은 함께 만든다', '구성주의, 학습자 중심/학습자중심', '2', '1']);
  assert.deepEqual(rowsToKey(meta, back), k);
  assert.ok(validateRows(meta, [{ ...essay, 요소: '', 핵심: '' }]).some(e => e.includes('논술형')));
  assert.ok(validateRows(meta, [{ ...essay, 용어배점: '0' }]).some(e => e.includes('배점')));
  assert.deepEqual(validateRows(meta, [essay]), []);
});
