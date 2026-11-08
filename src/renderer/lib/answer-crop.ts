import type { MaskRect } from '../../core/types.js';

/** 장마다 스캔 위치가 조금씩 달라 답이 잘리지 않게, 자를 때 사방으로 넓히는 몫(쪽 크기에 대한 비율) */
export const CROP_PAD = 0.02;
/** 그림을 받기 전 칸 높이를 잡을 때 쓰는 쪽 모양(A4 세로, 가로/세로) */
export const A4_ASPECT = 1 / Math.SQRT2;

/** 답 칸을 사방으로 pad만큼 넓힌 자르기 영역. 쪽 밖으로는 넘지 않는다 */
export function cropRect(r: MaskRect, pad = CROP_PAD): MaskRect {
  const x0 = Math.max(0, r.x - pad), y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(1, r.x + r.w + pad), y1 = Math.min(1, r.y + r.h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 두 영역이 겹친 곳(쪽 비율). 겹치지 않으면 null */
export function overlap(a: MaskRect, b: MaskRect): MaskRect | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * 잘라낸 그림 위에 칠할 신원 영역(잘라낸 그림 안의 비율). 교사가 머리 줄까지 잡아도 학생 정보가 보이지 않게 한다.
 * 겹치지 않으면 null
 */
export function identityInCrop(crop: MaskRect, identity: MaskRect): MaskRect | null {
  const o = overlap(crop, identity);
  return o ? { x: (o.x - crop.x) / crop.w, y: (o.y - crop.y) / crop.h, w: o.w / crop.w, h: o.h / crop.h } : null;
}

/** 비율 영역 → 화소 사각형. 바깥쪽으로 올려 경계의 한 줄도 새지 않게 하고, 그림 밖으로는 넘지 않는다 */
export function toPixels(r: MaskRect, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.floor(r.x * W)), y = Math.max(0, Math.floor(r.y * H));
  return { x, y, w: Math.min(W, Math.ceil((r.x + r.w) * W)) - x, h: Math.min(H, Math.ceil((r.y + r.h) * H)) - y };
}

/** 잘라낸 칸의 가로/세로(화소 기준). 쪽 모양을 모르면 A4로 본다 */
export const cropAspect = (crop: MaskRect, pageAspect = A4_ASPECT): number => (crop.w / crop.h) * pageAspect;

/** 손글씨 격자의 열 수(2~4). 칸이 답 칸 모양을 따르므로 가로로 긴 답 칸일수록 칸을 넓게(열을 적게) 잡는다 */
export function gridColumns(width: number, aspect: number): number {
  const cell = aspect >= 4 ? 320 : aspect >= 2 ? 260 : 200;
  return Math.min(4, Math.max(2, Math.floor(width / cell)));
}
