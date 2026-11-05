import type { QtyUnit, QualUnit } from '../core/types.js';
import { EngineError, withRetry, type Effort, type StructuredProvider, type StructuredRequest } from './provider.js';
import { loadRules, type Rules } from './rules.js';

export interface KeyDraftInput { 글: string; 문제: string; 지문?: string; effort?: Effort }
export interface KeyDraft { 정량: QtyUnit[]; 정성: QualUnit[]; 주의: string[] }

const ID = /^[a-zA-Z0-9_.-]{1,64}$/;
const str = { type: 'string' }, strs = { type: 'array', items: { type: 'string' } };

export function keyDraftSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      quant: { type: 'array', items: { type: 'object',
        properties: { id: str, question: { type: 'integer' }, description: str, answer: str, accepted: strs, keywords: strs },
        required: ['id', 'question', 'description', 'answer', 'accepted', 'keywords'], additionalProperties: false } },
      qual: { type: 'array', items: { type: 'object',
        properties: { id: str, question: { type: 'integer' }, description: str },
        required: ['id', 'question', 'description'], additionalProperties: false } },
      cautions: strs,
    },
    required: ['quant', 'qual', 'cautions'], additionalProperties: false,
  };
}

export function keyDraftRequest(input: KeyDraftInput, rules: Rules): StructuredRequest {
  const user = ['# 글', input.글, '', '# 문항지', input.문제, '', '# 지문', input.지문?.trim() ? input.지문 : '(지문 없음: 답은 추정이며 cautions에 적는다)'].join('\n');
  return { system: rules.본문.trimEnd(), user, schema: keyDraftSchema(), effort: input.effort ?? 'high' };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (m: string): never => { throw new EngineError('invalid-output', `정답 초안 출력 검증 실패: ${m}`); };

export function fromKeyDraftOutput(raw: unknown): KeyDraft {
  if (!isObj(raw) || !Array.isArray(raw.quant) || !Array.isArray(raw.qual) || !Array.isArray(raw.cautions)) return bad('모양이 다름');
  const ids = new Set<string>();
  const takeId = (v: unknown) => { if (typeof v !== 'string' || !ID.test(v)) return bad(`id 형식: ${String(v)}`); if (ids.has(v)) return bad(`id 중복: ${v}`); ids.add(v); return v; };
  const int = (v: unknown, what: string) => (typeof v === 'number' && Number.isInteger(v) ? v : bad(`${what}가 정수가 아님`));
  const text = (v: unknown, what: string, allowEmpty = false) => (typeof v === 'string' && (allowEmpty || v.trim()) ? v.trim() : bad(`${what}가 비었거나 글이 아님`));
  const list = (v: unknown, what: string) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]).map(s => s.trim()).filter(Boolean) : bad(`${what}가 글 목록이 아님`));
  const 정량: QtyUnit[] = raw.quant.map((u: unknown) => {
    if (!isObj(u)) return bad('quant 항목이 객체가 아님');
    const unit: QtyUnit = { id: takeId(u.id), 문항: int(u.question, 'question'), 설명: text(u.description, 'description', true), 정답: text(u.answer, 'answer') };
    const 허용 = list(u.accepted, 'accepted'), 핵심 = list(u.keywords, 'keywords');
    if (허용.length) unit.허용 = 허용;
    if (핵심.length) unit.핵심 = 핵심;
    return unit;
  });
  const 정성: QualUnit[] = raw.qual.map((u: unknown) => {
    if (!isObj(u)) return bad('qual 항목이 객체가 아님');
    return { id: takeId(u.id), 문항: int(u.question, 'question'), 설명: text(u.description, 'description', true) };
  });
  return { 정량, 정성, 주의: list(raw.cautions, 'cautions') };
}

export async function draftKey(provider: StructuredProvider, input: KeyDraftInput, signal: AbortSignal, rules?: Rules): Promise<KeyDraft> {
  const r = rules ?? await loadRules('keydraft-v1');
  const raw = await withRetry(() => provider.complete(keyDraftRequest(input, r), signal), signal);
  return fromKeyDraftOutput(raw.output);
}
