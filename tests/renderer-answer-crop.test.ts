import test from 'node:test';
import assert from 'node:assert/strict';
import { A4_ASPECT, CROP_PAD, cropAspect, cropRect, gridColumns, identityInCrop, overlap, toPixels } from '../src/renderer/lib/answer-crop.js';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const sameRect = (a: { x: number; y: number; w: number; h: number } | null, b: { x: number; y: number; w: number; h: number }) =>
  !!a && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);

test('cropRect: 사방으로 쪽의 2%씩 넓히고 쪽 밖으로는 넘지 않는다', () => {
  assert.equal(CROP_PAD, 0.02);
  assert.ok(sameRect(cropRect({ x: 0.1, y: 0.2, w: 0.8, h: 0.05 }), { x: 0.08, y: 0.18, w: 0.84, h: 0.09 }));
  assert.ok(sameRect(cropRect({ x: 0, y: 0.99, w: 1, h: 0.01 }), { x: 0, y: 0.97, w: 1, h: 0.03 })); // 왼쪽·오른쪽·아래 끝
  assert.ok(sameRect(cropRect({ x: 0.01, y: 0, w: 0.98, h: 0.5 }), { x: 0, y: 0, w: 1, h: 0.52 }));
});

test('overlap·identityInCrop: 머리 줄까지 잡으면 겹친 곳을 잘라낸 그림 안의 비율로', () => {
  const identity = { x: 0, y: 0, w: 1, h: 0.15 };
  assert.equal(overlap({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, identity), null);
  assert.equal(identityInCrop(cropRect({ x: 0.1, y: 0.2, w: 0.8, h: 0.05 }), identity), null); // 넓혀도 머리 줄(15%)에 닿지 않음
  const crop = cropRect({ x: 0.05, y: 0.05, w: 0.9, h: 0.2 }); // y 0.03~0.27
  const inCrop = identityInCrop(crop, identity)!;
  assert.ok(sameRect(inCrop, { x: 0, y: 0, w: 1, h: (0.15 - 0.03) / 0.24 }), JSON.stringify(inCrop)); // 위쪽 절반(0.12/0.24)
  assert.ok(sameRect(identityInCrop({ x: 0.5, y: 0.1, w: 0.2, h: 0.1 }, { x: 0.6, y: 0, w: 0.4, h: 0.15 })!, { x: 0.5, y: 0, w: 0.5, h: 0.5 }));
});

test('toPixels: 바깥쪽으로 올리고 그림 밖으로는 넘지 않는다', () => {
  assert.deepEqual(toPixels({ x: 0.101, y: 0.2, w: 0.5, h: 0.0333 }, 1000, 1000), { x: 101, y: 200, w: 500, h: 34 });
  assert.deepEqual(toPixels({ x: 0.9, y: 0.95, w: 0.2, h: 0.2 }, 100, 100), { x: 90, y: 95, w: 10, h: 5 });
});

test('cropAspect·gridColumns: 칸은 답 칸 모양을 따르고 열은 2~4', () => {
  assert.ok(near(cropAspect({ x: 0, y: 0, w: 0.5, h: 0.5 }), A4_ASPECT));
  const wide = cropAspect(cropRect({ x: 0.1, y: 0.2, w: 0.8, h: 0.05 })); // 가로로 긴 답 줄
  assert.ok(wide > 4);
  assert.equal(gridColumns(800, wide), 2);
  assert.equal(gridColumns(1400, wide), 4);
  assert.equal(gridColumns(800, 1), 4);
  assert.equal(gridColumns(300, 1), 2);
  assert.equal(gridColumns(700, 3), 2);
  assert.equal(gridColumns(800, 3), 3);
});
