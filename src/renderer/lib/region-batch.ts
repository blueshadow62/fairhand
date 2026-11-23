import type { AnswerKey, MaskRect } from '../../core/types.js';

/** 단위 id → 답 칸(쪽 비율). 정답표 `답영역`과 같은 꼴 */
export type Regions = Record<string, MaskRect>;
/** 저장할 변경: 단위 id → 새 답 칸, null이면 지우기 */
export type RegionChanges = Record<string, MaskRect | null>;

/** 단위 목록 순서: 정답표 순서대로 정량 다음 정성 */
export const unitOrder = (key: Pick<AnswerKey, '정량' | '정성'>): string[] => [...key.정량, ...key.정성].map(u => u.id);

export const sameRect = (a: MaskRect | null | undefined, b: MaskRect | null | undefined): boolean =>
  !a || !b ? !a && !b : a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * 답 칸을 잡은 뒤 고를 단위: 지금 단위 뒤에서 답 칸이 없는 첫 단위, 없으면 앞으로 돌아가 찾는다.
 * 모두 잡았으면 목록의 다음 단위(마지막이면 그대로)
 */
export function nextUnit(order: string[], regions: Regions, current: string): string {
  const i = order.indexOf(current);
  for (let k = 1; k < order.length; k++) {
    const id = order[(i + k) % order.length]!;
    if (!regions[id]) return id;
  }
  return order[Math.min(i + 1, order.length - 1)] ?? current;
}

/** 위·아래 키로 옮길 단위. 끝에서 멈춘다 */
export function stepUnit(order: string[], current: string, step: number): string {
  const i = order.indexOf(current);
  if (i < 0) return order[0] ?? current;
  return order[Math.min(order.length - 1, Math.max(0, i + step))]!;
}

/** 누른 곳(쪽 비율)에 있는 답 칸의 단위. 칸이 겹치면 작은 칸이 먼저(큰 칸 안의 작은 빈칸을 고를 수 있게), 같으면 목록 앞 단위 */
export function regionAt(order: string[], regions: Regions, p: { x: number; y: number }): string | null {
  let best: { id: string; area: number } | null = null;
  for (const id of order) {
    const r = regions[id];
    if (!r || p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
    const area = r.w * r.h;
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id ?? null;
}

/** 한 번의 고침: 단위의 답 칸이 before에서 after로 */
export interface RegionEdit { 단위: string; before: MaskRect | null; after: MaskRect | null }
/** 잡는 중의 답 칸과 되돌릴 고침들(마지막이 가장 최근) */
export interface RegionDraft { regions: Regions; edits: RegionEdit[] }

export const startDraft = (initial: Regions | undefined): RegionDraft => ({ regions: { ...initial }, edits: [] });

/** 단위의 답 칸을 바꾼다(null이면 지운다). 바뀌는 것이 없으면 그대로 돌려준다(되돌리기에 빈 고침이 쌓이지 않게) */
export function setRegion(d: RegionDraft, 단위: string, rect: MaskRect | null): RegionDraft {
  const before = d.regions[단위] ?? null;
  if (sameRect(before, rect)) return d;
  const regions = { ...d.regions };
  if (rect) regions[단위] = { ...rect }; else delete regions[단위];
  return { regions, edits: [...d.edits, { 단위, before, after: rect ? { ...rect } : null }] };
}

/** 마지막 고침을 되돌린다. 되돌린 단위를 함께 돌려줘 그 단위를 다시 고르게 한다. 되돌릴 것이 없으면 null */
export function undoRegion(d: RegionDraft): { draft: RegionDraft; 단위: string } | null {
  const last = d.edits.at(-1);
  if (!last) return null;
  const regions = { ...d.regions };
  if (last.before) regions[last.단위] = last.before; else delete regions[last.단위];
  return { draft: { regions, edits: d.edits.slice(0, -1) }, 단위: last.단위 };
}

/** 저장할 변경: 처음 값과 달라진 단위만(잡았다가 되돌려 같아진 단위는 넣지 않는다) */
export function regionChanges(initial: Regions | undefined, now: Regions): RegionChanges {
  const out: RegionChanges = {};
  const before = initial ?? {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const a = before[id] ?? null, b = now[id] ?? null;
    if (!sameRect(a, b)) out[id] = b;
  }
  return out;
}

/** 목록에 든 단위 가운데 답 칸을 잡은 수 */
export const regionCount = (order: string[], regions: Regions | undefined): number => order.filter(id => regions?.[id]).length;
