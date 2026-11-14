import test from 'node:test';
import assert from 'node:assert/strict';
import { SPOT_H, SPOT_LEAD, answerSpot, spotScrollLeft, spotScrollTop } from '../src/renderer/lib/answer-spot.js';

const t = { 정량: { '1-1': { 답: 'a', 판정: 'O' as const, 위치: 0.4 }, '2-1': { 답: '', 판정: '빈칸' as const }, '3-1': { 답: 'b', 판정: 'X' as const, 위치: 0.99 } } };

test('answerSpot: 교사가 잡은 답 칸이 먼저, 없으면 AI 위치로 쪽 너비의 띠, 둘 다 없으면 null', () => {
  const region = { x: 0.1, y: 0.5, w: 0.8, h: 0.2 };
  assert.deepEqual(answerSpot({ 답영역: { '1-1': region } }, t, '1-1'), { ...region, 출처: '답칸' });
  assert.deepEqual(answerSpot({}, t, '1-1'), { x: 0, y: 0.4 - SPOT_LEAD, w: 1, h: SPOT_H, 출처: 'AI' });
  assert.equal(answerSpot({}, t, '2-1'), null); // 위치를 받지 않은 단위(옛 전사·설정 꺼짐)
  assert.equal(answerSpot({}, null, '1-1'), null); // 전사 없는 장
  assert.deepEqual(answerSpot({ 답영역: { E1: region } }, t, 'E1'), { ...region, 출처: '답칸' }); // 정성도 답 칸이 있으면
  // 쪽 끝 가까운 위치는 띠가 쪽 밖으로 나가지 않게 올린다
  const low = answerSpot({}, t, '3-1')!;
  assert.ok(Math.abs(low.y + low.h - 1) < 1e-9, JSON.stringify(low));
  assert.equal(answerSpot({}, { 정량: { a: { 답: '', 판정: 'X', 위치: Number.NaN } } }, 'a'), null);
});

test('spotScrollTop: 답 자리 윗변이 도구 막대 아래 보이는 칸의 위쪽 20% 자리에 오게, 0과 끝 사이로 자른다', () => {
  assert.equal(spotScrollTop({ top: 1000, view: 600, max: 5000 }), 880);
  assert.equal(spotScrollTop({ top: 1000, view: 600, max: 5000, bar: 40 }), 1000 - 40 - 112);
  assert.equal(spotScrollTop({ top: 50, view: 600, max: 5000 }), 0);
  assert.equal(spotScrollTop({ top: 9000, view: 600, max: 5000 }), 5000);
  assert.equal(spotScrollTop({ top: 300, view: 600, max: -10 }), 0); // 내릴 것이 없는 짧은 그림
});

test('spotScrollLeft: 답 칸 왼쪽 끝이 보이는 칸 안이면 가로로 옮기지 않고(막대가 밀려나지 않게), 밖이면 조금 여유를 두고 옮긴다', () => {
  assert.equal(spotScrollLeft({ left: 75, scroll: 0, view: 480 }), null);
  assert.equal(spotScrollLeft({ left: 600, scroll: 0, view: 480 }), 584);
  assert.equal(spotScrollLeft({ left: 100, scroll: 300, view: 480 }), 84);
  assert.equal(spotScrollLeft({ left: 10, scroll: 300, view: 480 }), 0);
  assert.equal(spotScrollLeft({ left: 460, scroll: 0, view: 480 }), 444); // 오른쪽 끝에 겨우 걸린 것도 옮긴다
});
