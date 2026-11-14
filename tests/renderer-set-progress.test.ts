import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, stages, type SetProgress } from '../src/renderer/lib/set-progress.js';

const set = (o: Partial<Omit<SetProgress, 'key'>> & { 확인됨?: boolean } = {}): SetProgress => ({
  key: o.확인됨 === false ? {} : { 확인: { 완료: true } }, 쪽수: 0, 전사수: 0, 확인수: 0, 미전사수: 0, ...o,
});

test('nextStep: 정답표 확인 → 답안지 올리기 → 전사 → 검토 → 엑셀 차례로 끝나지 않은 첫 일', () => {
  assert.equal(nextStep(set({ 확인됨: false, 쪽수: 30, 전사수: 30, 확인수: 30 })), 'key'); // 정답표를 고쳐 확인이 풀렸으면 전사·검토가 끝났어도 문항 설정부터
  assert.equal(nextStep({ ...set(), key: { 확인: { 완료: false } } }), 'key');
  assert.equal(nextStep(set()), 'upload');
  assert.equal(nextStep(set({ 쪽수: 30, 미전사수: 30 })), 'transcribe');
  assert.equal(nextStep(set({ 쪽수: 30, 전사수: 28, 확인수: 28, 미전사수: 2 })), 'transcribe'); // 새로 올린 장이 있으면 검토보다 전사가 먼저
  assert.equal(nextStep(set({ 쪽수: 30, 전사수: 30, 확인수: 12 })), 'review');
  assert.equal(nextStep(set({ 쪽수: 30, 전사수: 30, 확인수: 30 })), 'excel');
  assert.equal(nextStep(set({ 쪽수: 0, 전사수: 2, 확인수: 2 })), 'upload'); // 그림 없이 전사만 남은 세트
});

test('stages: 단계마다 끝났는지와 수. 전사는 그림이 있는 장, 검토 확인은 전사 파일 기준', () => {
  const s = stages(set({ 쪽수: 30, 전사수: 28, 확인수: 12, 미전사수: 2 }));
  assert.deepEqual(s.map(x => [x.id, x.done, x.n, x.total]), [
    ['key', true, 0, 0], ['pages', true, 30, 30], ['transcribe', false, 28, 30], ['review', false, 12, 28],
  ]);
  assert.deepEqual(stages(set()).map(x => x.done), [true, false, false, false]); // 장이 없으면 전사·검토도 끝난 것이 아니다
  assert.equal(stages(set({ 쪽수: 3, 미전사수: 5 }))[2]!.n, 0); // 수가 어긋나도 음수로 보이지 않게
});
