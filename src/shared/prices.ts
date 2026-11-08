import { DEFAULT_MODEL, DEFAULT_OPENAI_MODEL, type Profile } from './ipc.js';

export interface Price { 입력: number; 출력: number }

/**
 * API 요금(백만 토큰당 달러). 전사 중 비용 추정과 설정 화면의 모델 안내가 이 표 하나를 쓴다(둘이 따로 적혀 어긋났었다).
 * 기준: Anthropic 가격표(2026-10-06), OpenAI 모델 안내(2026-11, 추론 토큰은 출력으로 과금). Gemini는 앱에 단가가 없어 두지 않는다
 */
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': { 입력: 4, 출력: 20 },
  'claude-sonnet-5-5': { 입력: 2, 출력: 10 },
  'gpt-6-astra': { 입력: 10, 출력: 50 },
  'gpt-6.1-sol': { 입력: 2, 출력: 10 },
};

/** 쓴 토큰만큼 청구되는 API 프로필(Anthropic·OpenAI)의 단가. 구독(Claude Code·Codex)과 단가를 모르는 Gemini·모델은 null */
export function priceOf(p: Pick<Profile, '종류' | '모델'> | undefined): Price | null {
  if (p?.종류 === 'api') return PRICES[p.모델 ?? DEFAULT_MODEL] ?? null;
  if (p?.종류 === 'openai') return PRICES[p.모델 ?? DEFAULT_OPENAI_MODEL] ?? null;
  return null;
}

export const costUsd = (price: Price, inputTokens: number, outputTokens: number): number => (inputTokens * price.입력 + outputTokens * price.출력) / 1e6;

/** 설정 화면 모델 안내 글(settings.modelHelp·settings.openai.modelHelp)의 단가 자리 */
export function priceVars(): Record<string, number> {
  const v = (model: string) => PRICES[model]!;
  return {
    opusIn: v('claude-opus-5-5').입력, opusOut: v('claude-opus-5-5').출력, sonnetIn: v('claude-sonnet-5-5').입력, sonnetOut: v('claude-sonnet-5-5').출력,
    astraIn: v('gpt-6-astra').입력, astraOut: v('gpt-6-astra').출력, solIn: v('gpt-6.1-sol').입력, solOut: v('gpt-6.1-sol').출력,
  };
}
