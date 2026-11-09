import test from 'node:test';
import assert from 'node:assert/strict';
import { runMeter } from '../src/shared/estimate.js';
import type { Profile } from '../src/shared/ipc.js';
import { PRICES } from '../src/shared/prices.js';
import { t } from '../src/renderer/lib/i18n.js';
import { durationText, estimateLine, liveEstimateText, withSetEffort } from '../src/renderer/lib/run-estimate.js';

const api: Profile = { id: 'p', 이름: 'API', 종류: 'api', 모델: 'claude-opus-5-5' };
const cli: Profile = { id: 'cli-default', 이름: 'Claude Code', 종류: 'cli' };
const stats = {
  'api|claude-opus-5-5|medium': { 장: 10, 초: 400, 토큰장: 10, 입력: 30000, 출력: 8000 }, // 장당 40초, 입력 3000·출력 800
  'cli||medium': { 장: 4, 초: 180, 토큰장: 0, 입력: 0, 출력: 0 },                     // 장당 45초, 토큰 모름
};

test('durationText: 1분 이내, 약 n분, 90분부터는 시간과 분', () => {
  assert.deepEqual([durationText(59), durationText(90), durationText(89 * 60), durationText(95 * 60)], ['1분 이내', '약 2분', '약 89분', '약 1시간 35분']);
});

test('estimateLine: 이 AI 설정의 장당 기록으로 시간(단가를 아는 API는 비용도), 기록이 없으면 시험 한 장을 권하고, 할 장이 없으면 빈 글', () => {
  assert.equal(estimateLine(api, stats, 30), '예상: 약 20분 · 비용 약 $0.84 (이 AI 설정으로 최근 전사한 10장 기준)');
  assert.equal(estimateLine(cli, stats, 10), '예상: 약 8분 (이 AI 설정으로 최근 전사한 4장 기준)'); // 구독은 비용 없음
  assert.equal(estimateLine({ ...cli, 노력: 'high' }, stats, 10), t('run.est.unknown')); // 노력이 다르면 다른 기록
  assert.equal(estimateLine(cli, undefined, 10), t('run.est.unknown'));
  assert.deepEqual([estimateLine(cli, stats, 0), estimateLine(undefined, stats, 5)], ['', '']);
});

test('withSetEffort: 세트에 노력 단계를 정했으면 그 값의 예상 기록을 찾는다', () => {
  assert.deepEqual(withSetEffort(cli, 'high'), { ...cli, 노력: 'high' });
  assert.equal(withSetEffort(cli, undefined), cli);
  assert.equal(withSetEffort(undefined, 'high'), undefined);
  assert.equal(estimateLine(withSetEffort(cli, 'high'), stats, 10), t('run.est.unknown')); // high로 전사한 기록이 아직 없다
  assert.equal(estimateLine(withSetEffort(cli, undefined), stats, 10), '예상: 약 8분 (이 AI 설정으로 최근 전사한 4장 기준)');
});

test('estimateLine·liveEstimateText: 동시에 전사할 장 수만큼 나눠 어림한다(비용은 그대로)', () => {
  assert.equal(estimateLine(api, stats, 30, 3), '예상: 약 7분 · 비용 약 $0.84 (이 AI 설정으로 최근 전사한 10장 기준)'); // 10묶음 × 40초
  let now = 0;
  const m = runMeter(() => now);
  now = 40000; m.add({ ms: 40000 });
  assert.equal(liveEstimateText(m, 7, null, 0, 3), ' · 남은 시간 약 1분'); // 남은 6장은 2묶음 × 40초
});

test('liveEstimateText: 첫 장이 끝나면 남은 시간과(API는) 다 했을 때의 비용, 끝난 장이나 남은 장이 없으면 빈 글', () => {
  let now = 0;
  const m = runMeter(() => now);
  assert.equal(liveEstimateText(m, 5, null, 0), '');
  now = 40000; m.add({ inputTokens: 3000, outputTokens: 800 });
  assert.equal(liveEstimateText(m, 5, null, 0), ' · 남은 시간 약 3분'); // 남은 4장 × 40초
  const spent = (3000 * 4 + 800 * 20) / 1e6;
  assert.equal(liveEstimateText(m, 5, PRICES['claude-opus-5-5']!, spent), ' · 남은 시간 약 3분 · 다 하면 약 $0.14');
  assert.equal(liveEstimateText(m, 1, null, 0), ''); // 다 끝난 뒤 '1분 이내'가 남지 않게
});
