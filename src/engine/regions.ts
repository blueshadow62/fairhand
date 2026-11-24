import type { AnswerKey, MaskRect, Transcript } from '../core/types.js';
import { EngineError, withRetry, type Effort, type StructuredProvider, type StructuredRequest } from './provider.js';
import { loadRules, type Rules } from './rules.js';
import { unitListSchema } from './schema.js';

/** 답 칸 찾기: 답안지 한 장(신원 영역은 칠해 보낸다)과 그 장의 전사, 찾을 단위 id */
export interface RegionFindInput { imageJpegBase64: string; key: AnswerKey; transcript: Transcript; 단위: string[]; effort: Effort }
/** 단위 id → 쪽 비율 답 칸. 찾지 못했거나 값이 틀리면 null */
export type FoundRegions = Record<string, MaskRect | null>;

const coord = { type: ['integer', 'null'] };

/** 단위 수와 상관없는 목록으로 받는다(단위마다 칸을 두면 API가 양식을 거절한 적이 있다, schema.ts) */
export function regionSchema(ids: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: { boxes: unitListSchema(ids, { x0: coord, y0: coord, x1: coord, y1: coord }) },
    required: ['boxes'], additionalProperties: false,
  };
}

/** 단위마다 한 줄: id, 문항, 유형, 설명, 이 장에서 학생이 쓴 답. 쓴 글을 알면 모델이 그 글자를 찾아 자리를 잡는다 */
export function regionRequest(input: RegionFindInput, rules: Rules): StructuredRequest {
  const want = new Set(input.단위);
  const qty = input.key.정량.filter(u => want.has(u.id)).map(u => {
    const a = input.transcript.정량[u.id];
    const written = !a || a.판정 === '빈칸' || !a.답.trim() ? '(빈칸)' : JSON.stringify(a.답);
    return `- ${u.id} (문항 ${u.문항}, ${u.유형 ?? '빈칸형'}): ${u.설명 || '(설명 없음)'} | 이 장의 답: ${written}`;
  });
  const qual = input.key.정성.filter(u => want.has(u.id)).map(u => {
    const a = input.transcript.정성[u.id];
    const written = !a || !a.응답 || !a.답.trim() ? '(빈칸)' : JSON.stringify(a.답.length > 80 ? `${a.답.slice(0, 80)}…` : a.답);
    return `- ${u.id} (문항 ${u.문항}, 응답형): ${u.설명 || '(설명 없음)'} | 이 장의 답: ${written}`;
  });
  const user = ['# 찾을 단위', ...qty, ...qual, '', '첨부한 답안지 한 장에서 위 단위마다 답 칸을 찾아 boxes에 낸다.'].join('\n');
  return { system: rules.본문.trimEnd(), user, imageJpegBase64: input.imageJpegBase64, schema: regionSchema(input.단위), effort: input.effort };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000;

/** 0~1000 정수 상자를 쪽 비율로. 범위 밖·뒤집힌 상자는 null */
export function toRect(b: Record<string, unknown>): MaskRect | null {
  const { x0, y0, x1, y1 } = b;
  if (!inRange(x0) || !inRange(y0) || !inRange(x1) || !inRange(y1) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0 / 1000, y: y0 / 1000, w: (x1 - x0) / 1000, h: (y1 - y0) / 1000 };
}

/** 모양이 틀리면 invalid-output. 단위마다의 값이 틀리면 그 단위만 null(빠짐·두 번 나옴·목록 밖 id 포함) */
export function fromRegionOutput(raw: unknown, ids: string[]): FoundRegions {
  if (!isObj(raw) || !Array.isArray(raw.boxes)) throw new EngineError('invalid-output', '답 칸 출력 검증 실패: boxes 목록이 없음');
  const seen = new Map<string, number>(), first = new Map<string, Record<string, unknown>>();
  for (const b of raw.boxes) {
    if (!isObj(b) || typeof b.id !== 'string') continue;
    seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
    if (!first.has(b.id)) first.set(b.id, b);
  }
  return Object.fromEntries(ids.map(id => {
    const b = first.get(id);
    return [id, b && seen.get(id) === 1 ? toRect(b) : null]; // 두 번 나온 단위는 어느 쪽이 맞는지 몰라 버린다
  }));
}

export async function findRegions(provider: StructuredProvider, input: RegionFindInput, signal: AbortSignal, rules?: Rules): Promise<FoundRegions> {
  const r = rules ?? await loadRules('regions-v1');
  const raw = await withRetry(() => provider.complete(regionRequest(input, r), signal), signal);
  return fromRegionOutput(raw.output, input.단위);
}
