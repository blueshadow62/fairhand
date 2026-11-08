import test from 'node:test';
import assert from 'node:assert/strict';
import { bigEnough, rectFrom } from '../src/renderer/lib/rect-drag.js';

test('rectFrom·bigEnough: 거꾸로 끌어도 같은 사각형, 그냥 누른 것은 영역이 아니다', () => {
  const r = rectFrom({ x: 0.6, y: 0.25 }, { x: 0.1, y: 0.05 });
  assert.deepEqual([r.x, r.y], [0.1, 0.05]);
  assert.ok(Math.abs(r.w - 0.5) < 1e-9 && Math.abs(r.h - 0.2) < 1e-9, JSON.stringify(r));
  assert.equal(bigEnough(rectFrom({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 })), false);
  assert.equal(bigEnough(rectFrom({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.503 })), false);
  assert.equal(bigEnough(rectFrom({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 })), true);
});
