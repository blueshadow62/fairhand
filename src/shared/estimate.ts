import { DEFAULT_EFFORT, type Profile } from './ipc.js';
import { costUsd, type Price } from './prices.js';

/**
 * 이 PC에서 같은 AI 설정(종류·모델·노력)으로 전사한 기록. 장·초: 성공한 장의 수와 걸린 시간의 합,
 * 토큰장·입력·출력: 토큰을 알려 준 장의 수와 토큰 합(구독 도구는 알려 주지 않을 수 있어 따로 센다)
 */
export interface RunStat { 장: number; 초: number; 토큰장: number; 입력: number; 출력: number }

/** 최근 이만큼의 장만 반영한다. 모델이나 회선 사정이 바뀌어도 옛 기록이 예상을 오래 붙잡지 않게 */
export const STAT_PAGES = 30;

/** 기록을 나누는 열쇠. 모델·노력이 비었으면 그 종류의 기본값으로 돈다(노력은 전사와 같은 기본값) */
export const statKey = (p: Pick<Profile, '종류' | '모델' | '노력'>): string => `${p.종류}|${p.모델 ?? ''}|${p.노력 ?? DEFAULT_EFFORT}`;

export const emptyStat = (): RunStat => ({ 장: 0, 초: 0, 토큰장: 0, 입력: 0, 출력: 0 });

/** 한 번의 전사 기록을 더한다. 장 수가 STAT_PAGES를 넘으면 합을 같은 비율로 줄여, 평균은 그대로 두고 최근 기록의 무게를 키운다 */
export function addRun(prev: RunStat | undefined, run: RunStat): RunStat {
  const p = prev ?? emptyStat();
  const s: RunStat = { 장: p.장 + run.장, 초: p.초 + run.초, 토큰장: p.토큰장 + run.토큰장, 입력: p.입력 + run.입력, 출력: p.출력 + run.출력 };
  if (s.장 > STAT_PAGES) { const f = STAT_PAGES / s.장; s.장 = STAT_PAGES; s.초 *= f; }
  if (s.토큰장 > STAT_PAGES) { const f = STAT_PAGES / s.토큰장; s.토큰장 = STAT_PAGES; s.입력 *= f; s.출력 *= f; }
  return s;
}

/** 진행 알림 중 재는 데 쓰는 칸. 건너뛴 장(이미 전사함)과 실패한 장(error)은 시간·토큰에 넣지 않는다. ms: 그 장의 처리 시간 */
export interface MeterEvent { skipped?: boolean; error?: string; inputTokens?: number; outputTokens?: number; ms?: number }

/**
 * 전사 진행 알림으로 장마다 걸린 시간과 토큰을 잰다. 알림에 그 장의 처리 시간(ms)이 실려 있으면 그것을 쓴다(여러 장을 동시에 하면 알림 사이 간격이 장당 시간이 아니다).
 * 없으면(한 장씩 차례로 하던 때의 알림) 앞 알림(처음에는 만든 때)부터 이 알림까지를 그 장의 시간으로 본다.
 * 처리: 건너뛰지 않은 장(실패 포함) 수. 남은 장을 셀 때 쓴다
 */
export function runMeter(now: () => number = Date.now): { add(e: MeterEvent): void; readonly stat: RunStat; readonly 처리: number } {
  const stat = emptyStat();
  let last = now(), 처리 = 0;
  return {
    stat,
    get 처리() { return 처리; },
    add(e) {
      const t = now();
      if (!e.skipped) {
        처리++;
        if (!e.error) {
          stat.장++; stat.초 += Math.max(0, typeof e.ms === 'number' ? e.ms : t - last) / 1000;
          if (typeof e.inputTokens === 'number' && typeof e.outputTokens === 'number') { stat.토큰장++; stat.입력 += e.inputTokens; stat.출력 += e.outputTokens; }
        }
      }
      last = t;
    },
  };
}

/** 예상: 초(걸릴 시간), 비용(단가를 아는 API의 달러), 근거장(기록에 든 장 수) */
export interface Estimate { 초: number; 비용?: number; 근거장: number }

/**
 * 기록의 장당 평균으로 pages장의 시간과 비용을 어림한다. 기록이 없거나 할 장이 없으면 null. 비용은 단가와 토큰 기록이 있을 때만.
 * 동시: 한꺼번에 전사하는 장 수. 장마다 걸리는 시간이 비슷하다고 보고 ⌈pages/동시⌉ 장만큼 걸린다고 어림한다(비용은 장 수 그대로)
 */
export function estimateRun(stat: RunStat | undefined, pages: number, price: Price | null, 동시 = 1): Estimate | null {
  if (!stat || stat.장 <= 0 || pages <= 0) return null;
  const 비용 = price && stat.토큰장 > 0 ? costUsd(price, stat.입력 / stat.토큰장 * pages, stat.출력 / stat.토큰장 * pages) : undefined;
  return { 초: stat.초 / stat.장 * Math.ceil(pages / Math.max(1, 동시)), ...(비용 === undefined ? {} : { 비용 }), 근거장: Math.round(stat.장) };
}

/**
 * 전사 중 남은 시간과 다 했을 때의 비용: 이번 실행에서 잰 장당 평균으로. toDo는 이번에 실제로 전사할 장 수(건너뛸 장 제외),
 * 지금까지 쓴 비용(spent)에 남은 장의 어림을 더한다. 동시는 estimateRun과 같다. 아직 끝난 장이 없으면 null
 */
export function projectRemaining(meter: { stat: RunStat; 처리: number }, toDo: number, price: Price | null, spent = 0, 동시 = 1): { 남은초: number; 총비용?: number } | null {
  const est = estimateRun(meter.stat, Math.max(0, toDo - meter.처리), price, 동시);
  if (meter.stat.장 <= 0) return null;
  const 총비용 = price && meter.stat.토큰장 > 0 ? spent + (est?.비용 ?? 0) : undefined;
  return { 남은초: est?.초 ?? 0, ...(총비용 === undefined ? {} : { 총비용 }) };
}
