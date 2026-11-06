import { pageTag } from '../../core/types.js';
import type { LeaveChoice } from '../../shared/ipc.js';

/** p07 같은 쪽 표시. 화면 셋이 같은 꼴을 쓴다 */
export const tag = pageTag;

/** "1-3,7" → [1,2,3,7]. 형식이 틀리거나 거꾸로 된 범위(5-3)면 null */
export function parsePageSpec(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (b < a) return null;
    for (let p = a; p <= b; p++) out.add(p);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

/** 오류를 화면 알림으로 돌리는 감싸기 */
export const makeGuard = (showError: (message: string) => void) => async (fn: () => Promise<void>): Promise<void> => {
  try { await fn(); } catch (e) { showError((e as Error).message); }
};

/** 저장하지 않은 변경이 있으면 운영체제 대화상자로 묻는다(저장 후 나가기/저장하지 않고 나가기/나가지 않기). 저장을 골랐는데 저장이 안 되면(검증 오류) 머문다 */
export function makeLeaveGuard(api: { askLeave(): Promise<LeaveChoice> }, s: { isDirty(): boolean; save(): Promise<void>; discard(): void }): () => Promise<boolean> {
  return async () => {
    if (!s.isDirty()) return true;
    const c = await api.askLeave();
    if (c === 'stay') return false;
    if (c === 'save') { await s.save(); return !s.isDirty(); }
    s.discard(); return true;
  };
}
