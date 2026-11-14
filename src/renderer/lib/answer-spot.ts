import type { AnswerKey, MaskRect, Transcript } from '../../core/types.js';

/** AI 위치(한 점)로 칠할 띠의 높이와, 그 점보다 위로 둘 여유(쪽 높이에 대한 비율). 모델이 대략으로 주는 값이라 넉넉하게 잡는다 */
export const SPOT_H = 0.06;
export const SPOT_LEAD = 0.015;

/** 답 자리(쪽 비율 영역)와 출처 */
export interface AnswerSpot extends MaskRect { 출처: '답칸' | 'AI' }

/**
 * 단위의 답 자리. 교사가 문항별 검토에서 잡은 답 칸(정답표 '답영역')이 먼저이고, 없으면 AI가 전사 때 돌려준 세로 위치(정량만)로
 * 쪽 너비의 띠를 만든다. 둘 다 없거나 위치가 0~1 밖이면 null(그림을 움직이지 않는다)
 */
export function answerSpot(key: Pick<AnswerKey, '답영역'>, t: Pick<Transcript, '정량'> | null | undefined, 단위: string): AnswerSpot | null {
  const r = key.답영역?.[단위];
  if (r) return { x: r.x, y: r.y, w: r.w, h: r.h, 출처: '답칸' };
  const y = t?.정량[단위]?.위치;
  if (typeof y !== 'number' || !(y >= 0 && y <= 1)) return null;
  return { x: 0, y: Math.min(Math.max(0, y - SPOT_LEAD), 1 - SPOT_H), w: 1, h: SPOT_H, 출처: 'AI' };
}

/**
 * 그림 칸을 내릴 자리(화소). 답 자리 윗변(top, 그림 칸 내용 좌표)이 가림 막대(bar, 위에 붙은 도구 막대 높이) 아래 보이는 칸의
 * lead만큼 아래에 오게 해 위쪽 글도 조금 보이게 하고, 0과 내릴 수 있는 끝(max) 사이로 자른다
 */
export function spotScrollTop(o: { top: number; view: number; max: number; bar?: number; lead?: number }): number {
  const bar = o.bar ?? 0, lead = o.lead ?? 0.2;
  return Math.round(Math.min(Math.max(0, o.top - bar - (o.view - bar) * lead), Math.max(0, o.max)));
}

/**
 * 가로로 옮길 자리(화소). 답 칸의 왼쪽 끝(left)이 보이는 칸(scroll ~ scroll+view) 안에 있으면 null(옮기지 않는다): 그림 칸을 가로로 옮기면
 * 확대·축소 막대도 함께 밀려나서다. AI 위치는 쪽 너비의 띠라 부르지 않는다
 */
export function spotScrollLeft(o: { left: number; scroll: number; view: number }): number | null {
  const margin = 16;
  return o.left >= o.scroll && o.left <= o.scroll + o.view - 3 * margin ? null : Math.max(0, Math.round(o.left - margin));
}
