import { mergeCases, normalizeAnswer } from './rejudge.js';
import type { AnswerKey, Case, MaskRect, QtyUnit, QualUnit } from './types.js';

// 문항 설정은 저장할 때마다 단위 id를 행 순서로 다시 매긴다(문항마다 1-1, 1-2…, 응답형은 E1, E2…).
// 행을 끼우거나 지우면 같은 id가 다른 단위를 가리키게 되므로, 정답표 밖에서 id로 단위를 가리키는 자료는 뜻으로 따라가야 한다

type Units = Pick<AnswerKey, '정량' | '정성'>;
const norm = (s: string | undefined): string => (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * 단위의 뜻 서명: 어느 문항에서 무엇을(설명) 무엇으로(정답·유형·종류) 채점하는지. 허용·핵심·배점은 같은 단위를 고치는 일이라 넣지 않는다.
 * 요소형·논술형의 설명(요소 1, 인용 2…)은 행 안의 순서로 붙는 이름이라 넣지 않는다.
 * 빈칸형·단답형·문장형은 같은 칸을 달리 부르는 것이라 가르지 않는다(옛 정답표에는 유형이 없다)
 */
export function unitMeaning(u: QtyUnit | QualUnit, section: '정량' | '정성'): string {
  if (section === '정성') return JSON.stringify(['정성', u.문항, norm(u.설명)]);
  const q = u as QtyUnit;
  const 유형 = q.유형 === '요소형' || q.유형 === '논술형' ? q.유형 : '';
  return JSON.stringify(['정량', q.문항, 유형, q.종류 ?? '', 유형 ? '' : norm(q.설명), norm(q.정답)]);
}

const meanings = (k: Units): [string, string][] =>
  [...k.정량.map(u => [u.id, unitMeaning(u, '정량')] as [string, string]), ...k.정성.map(u => [u.id, unitMeaning(u, '정성')] as [string, string])];

/** 옛 단위 id → 같은 뜻의 새 단위 id. null이면 옮길 곳이 없다 */
export type UnitMap = ReadonlyMap<string, string | null>;

/**
 * 옛 정답표의 단위마다 새 정답표에서 같은 뜻의 단위를 찾는다. 같은 id의 뜻이 그대로면 그 id, 바뀌었으면 옛 뜻과 같은 새 단위가
 * 정확히 하나일 때 그 id, 아니면 null. 옛 정답표에서도 그 뜻이 하나뿐일 때만 옮겨, 두 단위의 자료가 한 단위로 모이지 않게 한다
 */
export function mapUnits(old: Units, next: Units): UnitMap {
  const before = meanings(old), after = meanings(next);
  const count = (list: [string, string][]) => { const m = new Map<string, number>(); for (const [, s] of list) m.set(s, (m.get(s) ?? 0) + 1); return m; };
  const nOld = count(before), nNew = count(after);
  const byId = new Map(after), bySig = new Map(after.map(([id, s]) => [s, id]));
  const map = new Map<string, string | null>();
  for (const [id, s] of before) {
    if (byId.get(id) === s) map.set(id, id);
    else map.set(id, nOld.get(s) === 1 && nNew.get(s) === 1 ? bySig.get(s)! : null);
  }
  return map;
}

/** 두 정답표에 모두 있는데 뜻이 바뀐 단위 id. 이미 전사한 장에서 이 id의 답은 다른 단위의 답으로 읽힌다 */
export function changedUnitIds(old: Units, next: Units): string[] {
  const now = new Map(meanings(next));
  return meanings(old).filter(([id, s]) => now.has(id) && now.get(id) !== s).map(([id]) => id);
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
