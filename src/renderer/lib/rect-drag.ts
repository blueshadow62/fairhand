import type { MaskRect } from '../../core/types.js';

type Point = { x: number; y: number };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 끌어 잡은 두 점(쪽 비율) → 사각형 */
export const rectFrom = (a: Point, b: Point): MaskRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
/** 그냥 누른 것(아주 작은 사각형)은 영역으로 치지 않는다 */
export const bigEnough = (r: MaskRect): boolean => r.w > 0.01 && r.h > 0.005;

/**
 * 캔버스 위를 끌어 쪽 비율(0~1) 사각형을 잡는다. 채점 실행의 이름 칸 가리기와 문항별 검토의 신원 영역이 같이 쓴다.
 * 끄는 동안 onMove로 그리게 하고, 놓으면 충분히 큰 사각형만 onDone에 넘긴다(아니면 null)
 */
export function attachRectDrag(canvas: HTMLCanvasElement, h: { enabled(): boolean; onMove(r: MaskRect): void; onDone(r: MaskRect | null): void }): void {
  const point = (e: PointerEvent): Point => { const b = canvas.getBoundingClientRect(); return { x: clamp01((e.clientX - b.left) / b.width), y: clamp01((e.clientY - b.top) / b.height) }; };
  let from: Point | null = null, last: MaskRect | null = null;
  canvas.addEventListener('pointerdown', e => {
    if (!h.enabled() || e.button !== 0) return;
    e.preventDefault(); // 끄는 동안 글자가 선택되지 않게
    from = point(e); last = null;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => { if (from) { last = rectFrom(from, point(e)); h.onMove(last); } });
  canvas.addEventListener('pointerup', () => { if (!from) return; from = null; h.onDone(last && bigEnough(last) ? last : null); });
  canvas.addEventListener('pointercancel', () => { if (!from) return; from = null; h.onDone(null); });
}
