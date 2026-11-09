import { estimateRun, projectRemaining, statKey, type RunStat } from '../../shared/estimate.js';
import type { EffortLevel, Profile } from '../../shared/ipc.js';
import { priceOf, type Price } from '../../shared/prices.js';
import { t } from './i18n.js';

/** 걸릴 시간 글: 1분 이내, 약 n분, 90분부터는 n시간 m분 */
export function durationText(sec: number): string {
  if (sec < 60) return t('run.est.underMinute');
  const min = Math.round(sec / 60);
  return min < 90 ? t('run.est.minutes', { n: min }) : t('run.est.hours', { h: Math.floor(min / 60), m: min % 60 });
}

/** 세트에 노력 단계를 정했으면 그 값으로 바꾼 프로필. 예상 기록은 노력 단계별로 쌓이므로 세트에서 쓸 값으로 찾는다 */
export const withSetEffort = (p: Profile | undefined, 노력: EffortLevel | undefined): Profile | undefined => (p && 노력 ? { ...p, 노력 } : p);

/**
 * 전사 시작 전의 예상 한 줄: 이 AI 설정으로 최근 전사한 장당 시간(단가를 아는 API면 비용)으로 어림한다.
 * 기록이 없으면 '한 장 채점해 보기'를 권하는 글, 할 장이 없거나 프로필이 없으면 빈 글. 동시: 한꺼번에 전사하는 장 수(설정)
 */
export function estimateLine(profile: Profile | undefined, stats: Record<string, RunStat> | undefined, pages: number, 동시 = 1): string {
  if (!profile || pages <= 0) return '';
  const est = estimateRun(stats?.[statKey(profile)], pages, priceOf(profile), 동시);
  if (!est) return t('run.est.unknown');
  return t('run.est.line', { time: durationText(est.초), cost: est.비용 === undefined ? '' : t('run.est.cost', { cost: est.비용.toFixed(2) }), n: est.근거장 });
}

/**
 * 전사 중 진행 글에 덧붙일 남은 시간과(단가를 아는 API면) 다 했을 때의 비용. 이번 실행에서 잰 장당 평균으로 어림한다.
 * 아직 끝난 장이 없거나 남은 장이 없으면 빈 글(다 끝난 뒤 '1분 이내'가 남지 않게)
 */
export function liveEstimateText(meter: { stat: RunStat; 처리: number }, toDo: number, price: Price | null, spent: number, 동시 = 1): string {
  if (toDo - meter.처리 <= 0) return '';
  const p = projectRemaining(meter, toDo, price, spent, 동시);
  if (!p) return '';
  return t('run.est.live', { time: durationText(p.남은초) }) + (p.총비용 === undefined ? '' : t('run.est.liveCost', { cost: p.총비용.toFixed(2) }));
}
