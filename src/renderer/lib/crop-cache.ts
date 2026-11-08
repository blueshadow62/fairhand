import type { MaskRect } from '../../core/types.js';
import { MASK_FILL, toPixels } from './answer-crop.js';

const MAX_W = 640;   // 잘라낸 그림의 최대 폭. 칸은 화면에서 300~400px이라 화면 배율 150%에서도 또렷하다
const LIMIT = 160;   // 기억해 둘 잘라낸 그림 수. 넘으면 가장 오래 쓰지 않은 것부터 버린다
const PARALLEL = 3;  // 원본 그림을 한꺼번에 읽는 수

const cache = new Map<string, HTMLCanvasElement>();
const pending = new Map<string, Promise<HTMLCanvasElement>>();
const waiting: (() => void)[] = [];
let active = 0;

/** 원본 읽기는 한꺼번에 PARALLEL개까지. 끝난 자리는 기다리던 일에 넘긴다 */
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < PARALLEL) active++; else await new Promise<void>(res => waiting.push(res));
  try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}

export const cropKey = (url: string, crop: MaskRect, hide: MaskRect | null): string =>
  `${url}|${[crop.x, crop.y, crop.w, crop.h].join(',')}|${hide ? [hide.x, hide.y, hide.w, hide.h].join(',') : ''}`;

/** 이미 잘라 둔 그림(없으면 undefined). 쓴 것은 가장 최근으로 옮긴다 */
export function cachedCrop(key: string): HTMLCanvasElement | undefined {
  const c = cache.get(key);
  if (c) { cache.delete(key); cache.set(key, c); }
  return c;
}

/**
 * 쪽 그림에서 crop(쪽 비율)을 잘라 hide(잘라낸 그림 안의 비율, 신원 영역과 겹친 곳)를 칠한 작은 그림.
 * 원본은 장당 디코드가 무거워(1650px, 약 60ms) 칸이 화면에 들어올 때만 부르고, 다 그린 뒤 원본 참조는 놓는다.
 * 자르기와 칠하기는 문서에 붙지 않은 캔버스에서 한 번에 하므로 칠하기 전 모습은 화면에 나가지 않는다
 */
export function loadCrop(url: string, crop: MaskRect, hide: MaskRect | null): Promise<HTMLCanvasElement> {
  const key = cropKey(url, crop, hide);
  const hit = cachedCrop(key);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(key);
  if (running) return running;
  const p = slot(async () => {
    const img = new Image();
    img.src = url;
    try {
      await img.decode(); // 디코드를 화면 그리기 밖에서
      const src = toPixels(crop, img.naturalWidth, img.naturalHeight), scale = Math.min(1, MAX_W / src.w);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(src.w * scale)); out.height = Math.max(1, Math.round(src.h * scale));
      const g = out.getContext('2d')!;
      g.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, out.width, out.height);
      if (hide) { const h = toPixels(hide, out.width, out.height); g.fillStyle = MASK_FILL; g.fillRect(h.x, h.y, h.w, h.h); }
      cache.set(key, out);
      if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
      return out;
    } finally { img.src = ''; } // 원본 디코드를 붙들고 있지 않게
  }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** 세트를 바꾸거나 답 칸을 고치면 옛 그림은 다시 쓰지 않으므로 비운다 */
export function clearCrops(): void { cache.clear(); }
