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

/** 한 단위의 상태: 사람이 잡은(또는 받은) 답 칸과, 아직 받지 않은 AI 제안 */
export interface Slot { region: MaskRect | null; ai: MaskRect | null }
/** 한 번의 고침. 여러 단위가 함께 바뀔 수 있다(AI 제안 받아 오기, 남은 제안 모두 받기). 단위: 되돌린 뒤 고를 단위 */
export interface RegionEdit { 단위: string; changes: { 단위: string; before: Slot; after: Slot }[] }
/** 잡는 중의 답 칸, 받지 않은 AI 제안, 되돌릴 고침들(마지막이 가장 최근). 저장은 regions만 한다 */
export interface RegionDraft { regions: Regions; ai: Regions; edits: RegionEdit[] }

export const startDraft = (initial: Regions | undefined): RegionDraft => ({ regions: { ...initial }, ai: {}, edits: [] });

const slotOf = (d: RegionDraft, id: string): Slot => ({ region: d.regions[id] ?? null, ai: d.ai[id] ?? null });
function put(map: Regions, id: string, r: MaskRect | null): void { if (r) map[id] = { ...r }; else delete map[id]; }

/** 단위들의 상태를 바꾸고 한 번의 고침으로 쌓는다. 바뀌는 것이 없으면 그대로 돌려준다(되돌리기에 빈 고침이 쌓이지 않게) */
function apply(d: RegionDraft, 단위: string, next: Record<string, Slot>): RegionDraft {
  const changes = Object.entries(next).map(([id, after]) => ({ 단위: id, before: slotOf(d, id), after }))
    .filter(c => !sameRect(c.before.region, c.after.region) || !sameRect(c.before.ai, c.after.ai));
  if (!changes.length) return d;
  const regions = { ...d.regions }, ai = { ...d.ai };
  for (const c of changes) { put(regions, c.단위, c.after.region); put(ai, c.단위, c.after.ai); }
  return { regions, ai, edits: [...d.edits, { 단위, changes }] };
}

/** 단위의 답 칸을 바꾼다(null이면 지운다). 사람이 끌어 잡거나 지우면 그 단위의 AI 제안은 사라진다 */
export const setRegion = (d: RegionDraft, 단위: string, rect: MaskRect | null): RegionDraft => apply(d, 단위, { [단위]: { region: rect, ai: null } });

/** AI 제안을 더한다(찾지 못한 단위 null은 건너뛴다). 이미 잡은 칸은 그대로 두고, 받을지는 사람이 정한다 */
export function addSuggestions(d: RegionDraft, found: Record<string, MaskRect | null>, 단위: string): RegionDraft {
  const next: Record<string, Slot> = {};
  for (const [id, r] of Object.entries(found)) if (r) next[id] = { region: d.regions[id] ?? null, ai: r };
  return apply(d, 단위, next);
}

/** 제안을 받는다: 제안이 그 단위의 답 칸이 된다 */
export function acceptSuggestion(d: RegionDraft, 단위: string): RegionDraft {
  const ai = d.ai[단위];
  return ai ? apply(d, 단위, { [단위]: { region: ai, ai: null } }) : d;
}

/** 목록에 든 단위의 남은 제안을 모두 받는다(한 번의 고침) */
export function acceptAllSuggestions(d: RegionDraft, order: string[]): RegionDraft {
  const ids = order.filter(id => d.ai[id]);
  return ids.length ? apply(d, ids[0]!, Object.fromEntries(ids.map(id => [id, { region: d.ai[id]!, ai: null }]))) : d;
}

/** 제안을 버린다. 이미 잡은 칸이 있으면 그대로 둔다 */
export const discardSuggestion = (d: RegionDraft, 단위: string): RegionDraft =>
  d.ai[단위] ? apply(d, 단위, { [단위]: { region: d.regions[단위] ?? null, ai: null } }) : d;

/** 받을 다음 제안의 단위: 지금 단위 뒤에서 첫 제안, 없으면 앞으로 돌아가 찾는다. 남은 제안이 없으면 null */
export function nextSuggestion(order: string[], ai: Regions, current: string): string | null {
  const i = order.indexOf(current);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k + order.length) % order.length]!;
    if (ai[id] && id !== current) return id;
  }
  return null;
}

/** 마지막 고침을 되돌린다. 되돌린 고침의 단위를 함께 돌려줘 그 단위를 다시 고르게 한다. 되돌릴 것이 없으면 null */
export function undoRegion(d: RegionDraft): { draft: RegionDraft; 단위: string } | null {
  const last = d.edits.at(-1);
  if (!last) return null;
  const regions = { ...d.regions }, ai = { ...d.ai };
  for (const c of last.changes) { put(regions, c.단위, c.before.region); put(ai, c.단위, c.before.ai); }
  return { draft: { regions, ai, edits: d.edits.slice(0, -1) }, 단위: last.단위 };
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
