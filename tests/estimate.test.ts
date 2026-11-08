import test from 'node:test';
import assert from 'node:assert/strict';
import { addRun, emptyStat, estimateRun, projectRemaining, runMeter, STAT_PAGES, statKey } from '../src/shared/estimate.js';
import { PRICES } from '../src/shared/prices.js';

const OPUS = PRICES['claude-opus-5-5']!; // 백만 토큰당 입력 $4, 출력 $20
const stat10 = { 장: 10, 초: 400, 토큰장: 10, 입력: 30000, 출력: 8000 }; // 장당 40초, 입력 3000·출력 800

test('statKey: 종류·모델·노력. 모델이 비면 빈 칸, 노력이 비면 전사 기본값(medium)', () => {
  assert.equal(statKey({ 종류: 'api', 모델: 'claude-opus-5-5', 노력: 'high' }), 'api|claude-opus-5-5|high');
  assert.equal(statKey({ 종류: 'cli' }), 'cli||medium');
});

test('runMeter: 성공한 장만 앞 알림부터 걸린 시간을 재고 토큰은 알려 준 장만 센다. 건너뛴 장은 처리에도 넣지 않는다', () => {
  let now = 1000;
  const m = runMeter(() => now);
  now = 1500; m.add({ skipped: true });                          // 이미 전사한 장
  now = 41500; m.add({ inputTokens: 3000, outputTokens: 800 });  // 40초
  now = 61500; m.add({ error: '거절' });                         // 실패: 처리는 하나, 시간·토큰은 넣지 않는다
  now = 91500; m.add({});                                         // 30초, 토큰을 알려 주지 않는 도구
  assert.deepEqual(m.stat, { 장: 2, 초: 70, 토큰장: 1, 입력: 3000, 출력: 800 });
  assert.equal(m.처리, 3);
});

test('addRun: 더하고, STAT_PAGES장을 넘으면 같은 비율로 줄여 장당 평균은 그대로 두고 최근 기록의 무게를 키운다', () => {
  assert.deepEqual(addRun(undefined, stat10), stat10);
  const b = addRun({ 장: 30, 초: 1200, 토큰장: 30, 입력: 90000, 출력: 24000 }, { 장: 10, 초: 200, 토큰장: 0, 입력: 0, 출력: 0 });
  assert.equal(b.장, STAT_PAGES);
  assert.equal(b.초 / b.장, 1400 / 40); // 합친 40장의 평균 35초
  assert.deepEqual([b.토큰장, b.입력, b.출력], [30, 90000, 24000]); // 토큰은 알려 준 장만 세므로 그대로
});

test('estimateRun: 장당 평균으로 시간, 단가와 토큰 기록이 있을 때만 비용. 기록이나 할 장이 없으면 null', () => {
  const e = estimateRun(stat10, 30, OPUS)!;
  assert.deepEqual([e.초, e.근거장], [1200, 10]);
  assert.ok(Math.abs(e.비용! - 0.84) < 1e-9); // 입력 9만×$4 + 출력 2만4천×$20, 백만 토큰당
  assert.equal(estimateRun(stat10, 30, null)!.비용, undefined); // 구독은 비용을 어림하지 않는다
  assert.equal(estimateRun({ ...stat10, 토큰장: 0, 입력: 0, 출력: 0 }, 30, OPUS)!.비용, undefined);
  for (const [s, n] of [[undefined, 30], [emptyStat(), 30], [stat10, 0]] as const) assert.equal(estimateRun(s, n, OPUS), null);
});

test('projectRemaining: 이번 실행의 장당 평균으로 남은 시간, 다 했을 때의 비용은 쓴 비용에 남은 장의 어림을 더한다', () => {
  let now = 0;
  const m = runMeter(() => now);
  assert.equal(projectRemaining(m, 5, OPUS), null); // 아직 끝난 장이 없다
  now = 40000; m.add({ inputTokens: 3000, outputTokens: 800 });
  const spent = (3000 * 4 + 800 * 20) / 1e6;
  const p = projectRemaining(m, 5, OPUS, spent)!;
  assert.equal(p.남은초, 160); // 남은 4장 × 40초
  assert.ok(Math.abs(p.총비용! - spent * 5) < 1e-9);
  assert.deepEqual(projectRemaining(m, 1, null), { 남은초: 0 }); // 남은 장이 없고, 구독은 비용 없음
});
