import { caseConflict } from './cases.js';
import { mergeCases, normalizeAnswer } from './rejudge.js';
import type { AnswerKey, Case, MaskRect, QtyUnit, QualUnit } from './types.js';

// 문항 설정은 저장할 때마다 단위 id를 행 순서로 다시 매긴다(문항마다 1-1, 1-2…, 응답형은 E1, E2…).
// 행을 끼우거나 지우면 같은 id가 다른 단위를 가리키게 되므로, 정답표 밖에서 id로 단위를 가리키는 자료는 뜻으로 따라가야 한다

type Units = Pick<AnswerKey, '정량' | '정성'>;
const norm = (s: string | undefined): string => (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * 단위의 내용 서명: 어느 문항에서 무엇을(설명) 무엇으로(정답·유형·종류) 채점하는지. 허용·핵심·배점은 같은 단위를 고치는 일이라 넣지 않는다.
 * 요소형·논술형의 설명(요소 1, 인용 2…)은 행 안의 순서로 붙는 이름이라 넣지 않는다.
 * 빈칸형·단답형·문장형은 같은 칸을 달리 부르는 것이라 가르지 않는다(옛 정답표에는 유형이 없다)
 */
export function unitMeaning(u: QtyUnit | QualUnit, section: '정량' | '정성'): string {
  if (section === '정성') return JSON.stringify(['정성', u.문항, norm(u.설명)]);
  const q = u as QtyUnit;
  const 유형 = q.유형 === '요소형' || q.유형 === '논술형' ? q.유형 : '';
  return JSON.stringify(['정량', q.문항, 유형, q.종류 ?? '', 유형 ? '' : norm(q.설명), norm(q.정답)]);
}

/**
 * 단위의 설명 서명: 선생님이 쓴 설명으로 가리키는 단위(문항·설명). 정답을 넣지 않아, 정답의 오타만 고친 단위도 같은 단위로 따라간다.
 * 설명이 비었거나 요소형·논술형이면(설명이 순서 이름) null: 그런 단위는 정답이 곧 그 단위다. 그래서 유형은 늘 빈칸형·단답형·문장형이라
 * 넣지 않는다. 정성은 내용 서명이 이미 설명뿐이라 null
 */
export function unitLabel(u: QtyUnit | QualUnit, section: '정량' | '정성'): string | null {
  if (section === '정성') return null;
  const q = u as QtyUnit, 설명 = norm(q.설명);
  return 설명 && q.유형 !== '요소형' && q.유형 !== '논술형' ? JSON.stringify(['정량', q.문항, 설명]) : null;
}

interface Sig { id: string; 내용: string; 설명: string | null }
const sigs = (k: Units): Sig[] => [
  ...k.정량.map(u => ({ id: u.id, 내용: unitMeaning(u, '정량'), 설명: unitLabel(u, '정량') })),
  ...k.정성.map(u => ({ id: u.id, 내용: unitMeaning(u, '정성'), 설명: null })),
];

/** 옛 단위 id → 같은 뜻의 새 단위 id. null이면 옮길 곳이 없다 */
export type UnitMap = ReadonlyMap<string, string | null>;

/**
 * 옛 정답표의 단위마다 새 정답표에서 같은 단위를 찾는다. 차례로 같은 id의 내용이 그대로면 그 id, 옛 내용과 같은 새 단위가 정확히 하나면
 * 그 id(행을 끼우거나 지워 번호만 바뀐 단위), 설명이 같은 새 단위가 정확히 하나면 그 id(정답을 고친 단위), 아니면 null.
 * 옛 정답표에서도 그 내용·설명이 하나뿐일 때만 옮겨, 두 단위의 자료가 한 단위로 모이지 않게 한다.
 * 설명이 같은 단위가 둘 이상이면 설명으로 가릴 수 없어 정답까지 본다
 */
export function mapUnits(old: Units, next: Units): UnitMap {
  const before = sigs(old), after = sigs(next);
  const count = (list: (string | null)[]) => { const m = new Map<string, number>(); for (const s of list) if (s !== null) m.set(s, (m.get(s) ?? 0) + 1); return m; };
  const 내용 = [count(before.map(s => s.내용)), count(after.map(s => s.내용))] as const;
  const 설명 = [count(before.map(s => s.설명)), count(after.map(s => s.설명))] as const;
  const once = (s: string | null, [a, b]: readonly [Map<string, number>, Map<string, number>]): s is string => s !== null && a.get(s) === 1 && b.get(s) === 1;
  const byId = new Map(after.map(s => [s.id, s.내용])), by내용 = new Map(after.map(s => [s.내용, s.id]));
  const by설명 = new Map(after.flatMap(s => (s.설명 === null ? [] : [[s.설명, s.id] as const])));
  const map = new Map<string, string | null>();
  for (const s of before) {
    if (byId.get(s.id) === s.내용) map.set(s.id, s.id);
    else if (once(s.내용, 내용)) map.set(s.id, by내용.get(s.내용)!);
    else if (once(s.설명, 설명)) map.set(s.id, by설명.get(s.설명)!);
    else map.set(s.id, null);
  }
  return map;
}

/** 두 정답표에 모두 있는데 다른 단위를 가리키게 된 id(mapUnits가 그 id로 따라가지 않는 단위). 이미 전사한 장에서 이 id의 답은 다른 단위의 답으로 읽힌다 */
export function changedUnitIds(old: Units, next: Units): string[] {
  const now = new Set([...next.정량, ...next.정성].map(u => u.id));
  return [...mapUnits(old, next)].filter(([id, to]) => now.has(id) && to !== id).map(([id]) => id);
}

/** 저장 한 번에 같은 뜻의 새 id로 옮긴 수와, 같은 뜻의 단위가 없어 지운 수 */
export interface MoveCount { 옮김: number; 지움: number }

/** 답 칸(단위 id → 영역)을 새 id로 옮긴다. 옮길 곳이 없는 칸은 버리고, 남는 것이 없으면 답영역을 두지 않는다 */
export function remapRegions(regions: Record<string, MaskRect> | undefined, map: UnitMap): MoveCount & { 답영역?: Record<string, MaskRect> } {
  const out: Record<string, MaskRect> = {};
  let 옮김 = 0, 지움 = 0;
  for (const [id, rect] of Object.entries(regions ?? {})) {
    const to = map.get(id) ?? null;
    if (to === null) { 지움++; continue; }
    if (to !== id) 옮김++;
    out[to] = rect;
  }
  return { 옮김, 지움, ...(Object.keys(out).length ? { 답영역: out } : {}) };
}

/**
 * 저장할 사례. 파일의 사례가 기준이다: 옛 id로 적혀 있어 같은 뜻의 새 id로 옮기고, 옮길 곳이 없으면 지운다.
 * 화면이 보낸 사례 중 파일에도 있는 것(같은 단위·같은 정규화 답)은 세트를 열 때 읽은 옛 id의 사본이라 버리고,
 * 파일에 없는 것(가져온 정답표의 사례)만 새 정답표의 id로 보고 더한다. 합치는 규칙은 mergeCases와 같다
 */
export function remapCases(file: Case[] | undefined, sent: Case[] | undefined, map: UnitMap, key: Pick<AnswerKey, '정량'>): MoveCount & { 사례: Case[] } {
  const keyOf = (c: Case) => `${c.단위}\u0000${normalizeAnswer(c.답)}`;
  const inFile = new Set((file ?? []).map(keyOf));
  const moved: Case[] = [];
  let 옮김 = 0, 지움 = 0;
  for (const c of file ?? []) {
    const to = map.get(c.단위) ?? null;
    if (to === null) { 지움++; continue; }
    if (to !== c.단위) 옮김++;
    moved.push(to === c.단위 ? c : { ...c, 단위: to });
  }
  return { 옮김, 지움, 사례: mergeCases(moved, (sent ?? []).filter(c => !inFile.has(keyOf(c))), key) };
}

/** 정답·허용이 바뀐 단위의 사례 하나. 어긋남: 새 정답·허용과 맞는 답을 X로 정한 사례(caseConflict) */
export interface ChangedAnswerCase { 단위: string; 답: string; 판정: 'O' | 'X'; 어긋남: boolean }

/**
 * 저장으로 정답·허용이 바뀐 단위(map으로 이은 옛 단위와 견준다)의 사례. 설명으로 따라간 단위는 정답을 고쳐도 사례가 그대로라
 * 새 정답과 맞지 않는 사례가 남을 수 있다(정답이 '은영'일 때 '혜미'를 X로 정한 사례는 정답을 '혜미'로 바꿔도 '혜미'를 X로 만든다).
 * 사례를 지우는 길은 removeCase 하나라 여기서는 고르기만 하고, 선생님이 보고 정한다. 글자 비교는 판정과 같은 정규화(normalizeAnswer)로
 */
export function casesOnChangedAnswers(old: Pick<AnswerKey, '정량'>, next: Pick<AnswerKey, '정량' | '사례'>, map: UnitMap): ChangedAnswerCase[] {
  const allowed = (u: QtyUnit) => [...new Set((u.허용 ?? []).map(normalizeAnswer).filter(Boolean))].sort().join('\u0000');
  const changed = new Set<string>();
  for (const o of old.정량) {
    const u = next.정량.find(x => x.id === map.get(o.id));
    if (u && (normalizeAnswer(o.정답) !== normalizeAnswer(u.정답) || allowed(o) !== allowed(u))) changed.add(u.id);
  }
  return (next.사례 ?? []).filter(c => changed.has(c.단위)).map(c => ({ 단위: c.단위, 답: c.답, 판정: c.판정, 어긋남: caseConflict(next, c) !== null }));
}
