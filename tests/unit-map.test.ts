import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKey } from '../src/core/key.js';
import { loadSet } from '../src/core/setio.js';
import type { AnswerKey, Case } from '../src/core/types.js';
import { casesOnChangedAnswers, changedUnitIds, mapUnits, remapCases, remapRegions, unitLabel, unitMeaning } from '../src/core/unit-map.js';
import { EngineBridge } from '../src/main/engine-bridge.js';
import { SecretStore } from '../src/main/secrets.js';
import { SettingsStore } from '../src/main/settings.js';
import { emptyRow, rowsToKey, type UnitRow } from '../src/renderer/lib/key-form.js';

const meta = { 글: '봄비 오는 날', 학기: '2026 2학기', 학년: 1, 반: [1], 인원: {} };
const row = (문항: number, 유형: UnitRow['유형'], 설명: string, 정답: string, more: Partial<UnitRow> = {}): UnitRow => ({ ...emptyRow(문항, 유형), 설명, 정답, ...more });
const base: UnitRow[] = [
  row(1, '빈칸형', '최 __ 과장', '은영'), row(1, '빈칸형', '__ 대리', '혜미'), row(2, '단답형', '건넨 물건', '수건'),
  row(1, '응답형', '파견의 문제점', ''), row(2, '응답형', '느낀 점', ''),
];
const keyOf = (rows: UnitRow[]): AnswerKey => rowsToKey(meta, rows);
const c = (단위: string, 답: string, 판정: 'O' | 'X' = 'O'): Case => ({ 단위, 답, 판정, 일시: '2026-11-08T00:00:00.000Z', 출처: '검토' });

test('unitMeaning: 허용·핵심·배점·id는 뜻이 아니고, 문항·설명·정답·요소형 여부는 뜻이다', () => {
  const [u] = keyOf([row(1, '빈칸형', '최 __ 과장', '은영')]).정량;
  const m = unitMeaning(u!, '정량');
  assert.equal(unitMeaning({ ...u!, id: '9-9', 허용: ['최은영'], 배점: 2 }, '정량'), m);
  assert.equal(unitMeaning({ ...u!, 유형: '단답형' }, '정량'), m); // 빈칸형·단답형·문장형은 가르지 않는다(옛 정답표엔 유형이 없다)
  assert.equal(unitMeaning({ ...u!, 정답: ' 은영 ', 설명: '최  __ 과장' }, '정량'), m); // 공백만 다른 것은 같은 뜻
  for (const other of [{ ...u!, 문항: 2 }, { ...u!, 설명: '김 __ 과장' }, { ...u!, 정답: '은영이' }, { ...u!, 유형: '요소형' as const }])
    assert.notEqual(unitMeaning(other, '정량'), m, JSON.stringify(other));
  // 요소형·논술형의 설명(요소 1…)은 행 안의 순서로 붙는 이름이라 보지 않는다
  const [e1] = keyOf([row(4, '요소형', '', '', { 요소: '집\n학교' })]).정량;
  assert.equal(unitMeaning({ ...e1!, 설명: '요소 2' }, '정량'), unitMeaning(e1!, '정량'));
  // 정량과 정성은 섞이지 않는다
  assert.notEqual(unitMeaning({ id: 'E1', 문항: 1, 설명: '은영' }, '정성'), unitMeaning({ id: 'E1', 문항: 1, 설명: '은영', 정답: '' }, '정량'));
});

test('mapUnits: 행을 끼우면 뒤 단위의 자료가 같은 뜻의 새 id를 따라간다(응답형 E 번호 포함)', () => {
  const old = keyOf(base);
  const next = keyOf([base[0]!, row(1, '빈칸형', '__ 사원', '민수'), base[1]!, base[2]!, row(1, '응답형', '새 질문', ''), base[3]!, base[4]!]);
  assert.deepEqual(next.정량.map(u => `${u.id}:${u.정답}`), ['1-1:은영', '1-2:민수', '1-3:혜미', '2-1:수건']);
  assert.deepEqual([...mapUnits(old, next)], [['1-1', '1-1'], ['1-2', '1-3'], ['2-1', '2-1'], ['E1', 'E2'], ['E2', 'E3']]);
  assert.deepEqual(changedUnitIds(old, next), ['1-2', 'E1', 'E2']); // 이미 전사한 장의 1-2 답은 이제 민수 칸으로 읽힌다
  assert.deepEqual(changedUnitIds(old, keyOf(base)), []);
});

test('unitLabel: 설명을 쓴 단위는 문항·설명으로 가리키고(정답·허용·배점·빈칸형/단답형/문장형은 보지 않음), 설명이 없거나 순서 이름이면 null', () => {
  const [u] = keyOf([row(1, '빈칸형', '최 __ 과장', '은영')]).정량;
  const label = unitLabel(u!, '정량');
  assert.ok(label);
  for (const same of [{ ...u!, 정답: '은영이', 허용: ['최은영'], 배점: 2, id: '9-9' }, { ...u!, 유형: '단답형' as const }, { ...u!, 설명: ' 최  __ 과장 ' }])
    assert.equal(unitLabel(same, '정량'), label, JSON.stringify(same));
  for (const other of [{ ...u!, 문항: 2 }, { ...u!, 설명: '김 __ 과장' }]) assert.notEqual(unitLabel(other, '정량'), label, JSON.stringify(other));
  assert.equal(unitLabel({ ...u!, 설명: '  ' }, '정량'), null);
  const [e1] = keyOf([row(4, '요소형', '', '', { 요소: '집' })]).정량;
  const [q1] = keyOf([row(5, '논술형', '', '', { 요소: '배움은 함께 짓는 것이다' })]).정량;
  assert.deepEqual([unitLabel(e1!, '정량'), unitLabel(q1!, '정량'), unitLabel({ id: 'E1', 문항: 1, 설명: '느낀 점' }, '정성')], [null, null, null]);
});

test('mapUnits: 행을 지우거나 순서를 바꾸면 따라가고, 같은 뜻이 둘인 단위는 옮길 곳이 없다', () => {
  const old = keyOf(base);
  assert.deepEqual([...mapUnits(old, keyOf([base[1]!, base[2]!, base[3]!, base[4]!]))], [['1-1', null], ['1-2', '1-1'], ['2-1', '2-1'], ['E1', 'E1'], ['E2', 'E2']]);
  assert.deepEqual([...mapUnits(old, keyOf([base[1]!, base[0]!, ...base.slice(2)]))].slice(0, 2), [['1-1', '1-2'], ['1-2', '1-1']]);
  assert.equal(mapUnits(old, keyOf([{ ...base[0]!, 허용: '최은영', 배점: '2' }, ...base.slice(1)])).get('1-1'), '1-1'); // 허용·배점만 고치면 그대로
  // 같은 뜻의 단위가 둘이면 어느 쪽인지 알 수 없어 옮기지 않는다(같은 id에 같은 뜻이 남은 것만 그대로)
  const twins = keyOf([row(1, '빈칸형', '', 'O'), row(1, '빈칸형', '', 'O')]);
  assert.deepEqual([...mapUnits(twins, keyOf([row(1, '빈칸형', '', '새'), row(1, '빈칸형', '', 'O'), row(1, '빈칸형', '', 'O')]))], [['1-1', null], ['1-2', '1-2']]);
});

test('mapUnits: 설명을 쓴 단위는 정답의 오타만 고쳐도 같은 단위다(사례·답 칸 유지, 확인 창 없음). 번호가 함께 바뀌어도 설명으로 따라간다', () => {
  const old = keyOf(base);
  const fixed = keyOf([{ ...base[0]!, 정답: '은영이' }, ...base.slice(1)]);
  assert.deepEqual([...mapUnits(old, fixed)], [['1-1', '1-1'], ['1-2', '1-2'], ['2-1', '2-1'], ['E1', 'E1'], ['E2', 'E2']]);
  assert.deepEqual(changedUnitIds(old, fixed), []); // 문항 설정은 이 목록이 비면 묻지 않는다
  const file = [c('1-1', '은영'), c('2-1', '수건이', 'X')], r1 = { x: 0, y: 0.2, w: 1, h: 0.1 };
  assert.deepEqual(remapCases(file, file, mapUnits(old, fixed), fixed), { 옮김: 0, 지움: 0, 사례: file });
  assert.deepEqual(remapRegions({ '1-1': r1 }, mapUnits(old, fixed)), { 옮김: 0, 지움: 0, 답영역: { '1-1': r1 } });
  // 맨 앞에 행을 끼우고 '__ 대리'의 정답도 고쳤다: 내용이 같은 1-1은 내용으로, 정답을 고친 1-2는 설명으로 새 번호를 따라간다
  const moved = keyOf([row(1, '빈칸형', '__ 사원', '민수'), base[0]!, { ...base[1]!, 정답: '혜미씨' }, ...base.slice(2)]);
  assert.deepEqual([...mapUnits(old, moved)].slice(0, 2), [['1-1', '1-2'], ['1-2', '1-3']]);
  assert.deepEqual(changedUnitIds(old, moved).slice(0, 2), ['1-1', '1-2']); // 이미 전사한 장의 1-1 답은 이제 민수 칸으로 읽힌다
});

test('mapUnits: 행을 끼워 설명이 다른 단위가 그 id로 오면, 옛 단위는 같은 설명의 단위로 옮기고 없으면 지운다(정답이 같아도)', () => {
  const old = keyOf(base);
  // 새 1-1은 정답이 옛 1-1과 같지만 설명이 다르다. 옛 1-1은 정답을 고쳐 1-2로 갔다
  const inserted = keyOf([row(1, '빈칸형', '__ 부장', '은영'), { ...base[0]!, 정답: '은영이' }, ...base.slice(1)]);
  assert.deepEqual([...mapUnits(old, inserted)].slice(0, 2), [['1-1', '1-2'], ['1-2', '1-3']]);
  // 옛 1-1의 행을 지우고 그 자리에 설명이 다른 행을 넣었다
  const replaced = keyOf([row(1, '빈칸형', '__ 부장', '은영'), ...base.slice(1)]);
  assert.equal(mapUnits(old, replaced).get('1-1'), null);
  assert.deepEqual(changedUnitIds(old, replaced), ['1-1']);
  assert.deepEqual(remapCases([c('1-1', '은영')], [], mapUnits(old, replaced), replaced), { 옮김: 0, 지움: 1, 사례: [] });
});

test('mapUnits: 설명이 빈 단위와 설명이 겹치는 단위는 정답으로 판단한다', () => {
  // 설명이 비면 정답이 곧 그 단위다: 정답을 고치면 다른 단위
  const blank = keyOf([row(1, '빈칸형', '', '은영'), row(1, '빈칸형', '', '혜미')]);
  const blankFixed = keyOf([row(1, '빈칸형', '', '은영이'), row(1, '빈칸형', '', '혜미')]);
  assert.deepEqual([...mapUnits(blank, blankFixed)], [['1-1', null], ['1-2', '1-2']]);
  assert.deepEqual(changedUnitIds(blank, blankFixed), ['1-1']);
  assert.deepEqual([...mapUnits(blank, keyOf([row(1, '빈칸형', '', '민수'), row(1, '빈칸형', '', '은영'), row(1, '빈칸형', '', '혜미')]))], [['1-1', '1-2'], ['1-2', '1-3']]);
  // 설명이 같은 단위가 둘이면 설명으로 가릴 수 없다: 정답을 고친 단위는 옮길 곳이 없고, 번호만 바뀐 단위는 내용으로 따라간다
  const dup = keyOf([row(1, '빈칸형', '빈칸', '은영'), row(1, '빈칸형', '빈칸', '혜미')]);
  assert.deepEqual([...mapUnits(dup, keyOf([row(1, '빈칸형', '빈칸', '은영이'), row(1, '빈칸형', '빈칸', '혜미')]))], [['1-1', null], ['1-2', '1-2']]);
  assert.deepEqual([...mapUnits(dup, keyOf([row(1, '빈칸형', '새 빈칸', '민수'), row(1, '빈칸형', '빈칸', '은영이'), row(1, '빈칸형', '빈칸', '혜미')]))], [['1-1', null], ['1-2', '1-3']]);
});

test('mapUnits: 요소형 요소의 순서를 바꾸거나 논술형에 인용을 끼워도 같은 요소를 따라간다', () => {
  const el = keyOf([row(4, '요소형', '', '', { 요소: '집\n학교' })]);
  assert.deepEqual([...mapUnits(el, keyOf([row(4, '요소형', '', '', { 요소: '학교\n집' })]))], [['4-1', '4-2'], ['4-2', '4-1']]);
  const essay = keyOf([row(5, '논술형', '', '', { 요소: '배움은 함께 짓는 것이다', 핵심: '구성주의, 비계/스캐폴딩' })]);
  const more = keyOf([row(5, '논술형', '', '', { 요소: '앎은 쌓인다\n배움은 함께 짓는 것이다', 핵심: '구성주의, 비계/스캐폴딩/발판' })]);
  assert.deepEqual([...mapUnits(essay, more)], [['5-1', '5-2'], ['5-2', '5-3'], ['5-3', '5-4']]);
});

test('remapCases: 파일의 사례를 새 id로 옮기고, 화면이 보낸 옛 id 사본은 버리고, 가져온 사례는 더한다', () => {
  const old = keyOf(base);
  const next = keyOf([base[0]!, row(1, '빈칸형', '__ 사원', '민수'), base[1]!, { ...base[2]!, 설명: '받은 물건' }, ...base.slice(3)]); // 2-1은 설명이 바뀌어 다른 단위
  const map = mapUnits(old, next);
  const file = [c('1-2', '혜미씨'), c('1-1', '은 영'), c('2-1', '수건이', 'X')];
  const sent = [c('1-2', ' 혜미씨.'), c('1-2', '민수씨')]; // 앞은 세트를 열 때 읽은 사본(옛 1-2), 뒤는 가져온 정답표의 사례(새 1-2)
  assert.deepEqual(remapCases(file, sent, map, next), { 옮김: 1, 지움: 1, 사례: [c('1-3', '혜미씨'), c('1-1', '은 영'), c('1-2', '민수씨')] });
  assert.deepEqual(remapCases(undefined, sent, mapUnits({ 정량: [], 정성: [] }, next), next), { 옮김: 0, 지움: 0, 사례: sent }); // 파일이 없으면 화면의 사례 그대로
  assert.deepEqual(remapRegions({ '1-2': { x: 0, y: 0.5, w: 1, h: 0.1 }, '2-1': { x: 0, y: 0.6, w: 1, h: 0.1 }, E1: { x: 0, y: 0.8, w: 1, h: 0.1 } }, map),
    { 옮김: 1, 지움: 1, 답영역: { '1-3': { x: 0, y: 0.5, w: 1, h: 0.1 }, E1: { x: 0, y: 0.8, w: 1, h: 0.1 } } });
});

test('casesOnChangedAnswers: 정답·허용이 바뀐 단위의 사례만 고르고, 새 정답·허용과 같은 답을 X로 정한 사례는 어긋남', () => {
  const old = keyOf(base);
  const cases = [c('1-1', '혜미', 'X'), c('1-1', '최은영'), c('1-2', '혜미 씨'), c('2-1', '손수건', 'X')];
  // 1-1의 정답을 '혜미'로 바꾸고(설명이 같아 사례가 그대로다) 2-1에 허용 '손수건'을 더했다. 1-2는 그대로
  const next = { ...keyOf([{ ...base[0]!, 정답: '혜미' }, base[1]!, { ...base[2]!, 허용: '손수건' }, ...base.slice(3)]), 사례: cases };
  assert.deepEqual(casesOnChangedAnswers(old, next, mapUnits(old, next)), [
    { 단위: '1-1', 답: '혜미', 판정: 'X', 어긋남: true }, { 단위: '1-1', 답: '최은영', 판정: 'O', 어긋남: false }, { 단위: '2-1', 답: '손수건', 판정: 'X', 어긋남: true }]);
  // 판정에 쓰는 정규화로 같으면(공백·끝 문장부호) 바뀐 것이 아니고, 허용은 순서를 보지 않는다
  const withAllow = keyOf([{ ...base[0]!, 허용: '최은영, 은영씨' }, ...base.slice(1)]);
  const same = { ...keyOf([{ ...base[0]!, 정답: ' 은영. ', 허용: '은영씨,최은영' }, ...base.slice(1)]), 사례: cases };
  assert.deepEqual(casesOnChangedAnswers(withAllow, same, mapUnits(withAllow, same)), []);
  // 행을 끼워 번호만 바뀐 단위는 정답이 그대로라 고르지 않고, 정답을 고쳐 설명으로 따라간 단위는 새 번호로 고른다
  const moved = { ...keyOf([row(1, '빈칸형', '__ 사원', '민수'), base[0]!, { ...base[1]!, 정답: '혜미씨' }, ...base.slice(2)]), 사례: [c('1-2', '은영'), c('1-3', '혜미씨', 'X')] };
  assert.deepEqual(casesOnChangedAnswers(old, moved, mapUnits(old, moved)), [{ 단위: '1-3', 답: '혜미씨', 판정: 'X', 어긋남: true }]);
});

const FX = fileURLToPath(new URL('../../tests/fixtures/세트샘플/', import.meta.url));
const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

test('saveKey: 단위를 끼운 저장은 사례·답 칸을 같은 뜻의 새 id로 옮기고, 정답만 고친 단위는 그대로, 설명을 바꾼 단위의 것은 지우며 그 수를 돌려준다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'geulnun-unitmap-'));
  try {
    const set = path.join(dir, '세트A');
    await cp(FX, set, { recursive: true });
    const key = parseKey(readFileSync(path.join(FX, '정답표.json'), 'utf-8')); // 정량 1-1·3-1, 정성 E1
    const r1 = { x: 0.1, y: 0.2, w: 0.8, h: 0.05 }, r3 = { x: 0.1, y: 0.5, w: 0.8, h: 0.1 };
    await writeFile(path.join(set, '정답표.json'), JSON.stringify({ ...key, 사례: [c('1-1', '가나다라')], 답영역: { '1-1': r1, '3-1': r3 } }), 'utf-8');
    const bridge = new EngineBridge({ settings: new SettingsStore(path.join(dir, 'settings.json')), secrets: new SecretStore(path.join(dir, 'secrets.json'), storage), version: 't', env: {} });
    // 화면은 세트를 열 때 읽은 사례(옛 id)를 그대로 보낸다
    const screen = { ...key, 정량: [{ id: '1-1', 문항: 1, 설명: '새 빈칸', 정답: '다라' }, { ...key.정량[0]!, id: '1-2' }, key.정량[1]!], 사례: [c('1-1', '가나다라')] };
    const r = await bridge.saveKey(set, screen);
    assert.deepEqual(r.key.사례, [c('1-2', '가나다라')]);
    assert.deepEqual(r.key.답영역, { '1-2': r1, '3-1': r3 });
    assert.deepEqual(r.정리, { 사례: { 옮김: 1, 지움: 0 }, 답칸: { 옮김: 1, 지움: 0 } });
    assert.deepEqual((await loadSet(set)).key.답영역, { '1-2': r1, '3-1': r3 });
    // 설명('샘플 빈칸')이 있는 단위의 정답 오타만 고치면 사례·답 칸이 그대로다
    const typo = await bridge.saveKey(set, { ...r.key, 정량: r.key.정량.map(u => u.id === '1-2' ? { ...u, 정답: '가나라' } : u) });
    assert.deepEqual(typo.정리, { 사례: { 옮김: 0, 지움: 0 }, 답칸: { 옮김: 0, 지움: 0 } });
    assert.deepEqual([typo.key.사례, typo.key.답영역], [[c('1-2', '가나다라')], { '1-2': r1, '3-1': r3 }]);
    assert.deepEqual([r.정답바뀐사례, typo.정답바뀐사례], [[], [{ 단위: '1-2', 답: '가나다라', 판정: 'O', 어긋남: false }]]); // 정답을 고친 단위의 사례는 확인하라고 돌려준다
    // 설명을 바꾸면 다른 단위로 보고 그 단위의 답 칸을 지운다
    const again = await bridge.saveKey(set, { ...typo.key, 정량: typo.key.정량.map(u => u.id === '3-1' ? { ...u, 설명: '다른 문장' } : u) });
    assert.deepEqual(again.정리, { 사례: { 옮김: 0, 지움: 0 }, 답칸: { 옮김: 0, 지움: 1 } });
    assert.deepEqual(again.key.답영역, { '1-2': r1 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
