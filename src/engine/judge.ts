import { decide, type Change } from '../core/rejudge.js';
import { DataError, type AnswerKey, type Panjeong, type Transcript } from '../core/types.js';
import { EngineError, withRetry, type Effort, type StructuredProvider, type StructuredRequest } from './provider.js';
import { systemPrompt, type Rules } from './rules.js';
import { unitListSchema, unitsById } from './schema.js';

const TAG = '모델 재판정';
const VERDICTS: Panjeong[] = ['O', 'X', '빈칸'];

/** { quant: [{ id, verdict }] }. 빠진 단위는 fromJudgeOutput이 거절한다 */
export function judgeSchema(key: AnswerKey): Record<string, unknown> {
  return {
    type: 'object',
    properties: { quant: unitListSchema(key.정량.map(u => u.id), { verdict: { type: 'string', enum: VERDICTS } }) },
    required: ['quant'], additionalProperties: false,
  };
}

/** 그림 없이 전사된 답 글만 보내 판정만 다시 받는다 */
export function judgeRequest(key: AnswerKey, rules: Rules, t: Transcript, effort: Effort = 'medium'): StructuredRequest {
  const system = `${systemPrompt(rules, key)}\n\n# 작업: 재판정\n그림은 없다. 아래는 이미 전사된 한 장의 단위별 답이다. 각 답을 정답표·채점 규칙·판정 사례에 따라 다시 판정만 하라. 답을 바꾸거나 단위를 빼지 않는다.`;
  const user = JSON.stringify({ page: t.page, quant: Object.fromEntries(key.정량.map(u => [u.id, t.정량[u.id]?.답 ?? ''])) });
  return { system, user, schema: judgeSchema(key), effort };
}

export function fromJudgeOutput(raw: unknown, key: AnswerKey): Record<string, Panjeong> {
  let q: Record<string, Record<string, unknown>>;
  try { q = unitsById((raw as { quant?: unknown } | null)?.quant, '재판정 출력의 quant'); }
  catch (e) { if (e instanceof DataError) throw new EngineError('invalid-output', e.message); throw e; }
  const out: Record<string, Panjeong> = {};
  for (const u of key.정량) {
    const v = q[u.id]?.verdict;
    if (!VERDICTS.includes(v as Panjeong)) throw new EngineError('invalid-output', `재판정 출력의 ${u.id} 판정이 없거나 잘못됨 (${String(v)})`);
    out[u.id] = v as Panjeong;
  }
  return out;
}

export async function judgePage(provider: StructuredProvider, key: AnswerKey, rules: Rules, t: Transcript, signal: AbortSignal, effort?: Effort)
  : Promise<{ transcript: Transcript; changes: Change[]; inputTokens?: number; outputTokens?: number }> {
  const raw = await withRetry(() => provider.complete(judgeRequest(key, rules, t, effort), signal), signal);
  const verdicts = fromJudgeOutput(raw.output, key);
  const changes: Change[] = [];
  const 정량 = { ...t.정량 };
  for (const u of key.정량) {
    const v = 정량[u.id];
    if (!v) continue;
    const d = decide(key, u.id, v.답); // 빈칸·선생님 사례·정답 글자 일치는 모델보다 우선한다(전사 저장 때와 같은 규칙)
    const next = d ? d.판정 : verdicts[u.id]!;
    if (next !== v.판정) { changes.push({ 단위: u.id, 이전: v.판정, 이후: next, 근거: d ? d.근거 : '모델' }); 정량[u.id] = { ...v, 판정: next }; }
  }
  const tokens = { inputTokens: raw.inputTokens, outputTokens: raw.outputTokens };
  if (!changes.length) return { transcript: t, changes, ...tokens };
  const line = `${TAG}: ${changes.map(c => `${c.단위} ${c.이전}→${c.이후}${c.근거 === '모델' ? '' : ` (${c.근거})`}`).join(', ')}`;
  return { transcript: { ...t, 정량, 비고: [...t.비고.filter(b => !b.startsWith(`${TAG}:`)), line] }, changes, ...tokens };
}
