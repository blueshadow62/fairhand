import { essayQuestions } from '../core/key.js';
import { DataError, type AnswerKey } from '../core/types.js';

const intOrNull = { type: ['integer', 'null'] };
// 스키마는 영문 키, 전사 파일은 한글 키. 단위 id 형식은 정답표를 읽을 때(key.ts UNIT_ID) 이미 검사한다.

/** 단위 목록 스키마. 단위마다 칸을 두면 API가 양식을 컴파일할 때 'grammar is too large'로 거절해(2학년 25단위) 단위 수와 상관없는 목록으로 받는다. 빠진 단위·중복은 양식이 막지 못하므로 받은 뒤 검사한다. */
export function unitListSchema(ids: string[], fields: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: { id: ids.length ? { type: 'string', enum: ids } : { type: 'string' }, ...fields },
      required: ['id', ...Object.keys(fields)], additionalProperties: false,
    },
  };
}

/** 논술형 문항마다 학생 글 전체 하나: [{ question: 문항 번호(글자), text }]. 빠진 문항·중복은 양식이 막지 못해 받은 뒤 정리한다 */
const essayListSchema = (questions: string[]): Record<string, unknown> => ({
  type: 'array',
  items: { type: 'object', properties: { question: { type: 'string', enum: questions }, text: { type: 'string' } }, required: ['question', 'text'], additionalProperties: false },
});

/** 위치: 정량 단위마다 답의 세로 위치(y)도 받는다(설정 '답 위치 받기') */
export interface TranscriptOptions { 위치?: boolean }

/**
 * 정답표에서 만든 전사 JSON 스키마(영문 키). 논술형 세트에만 essays(글 전체)를 quant 앞에 둔다: 글을 먼저 옮긴 뒤 단위마다 그 글에서 찾게 하고,
 * 논술형이 없는 세트의 양식은 그대로 둔다(잰 정확도·토큰이 유지된다). y는 위치를 켰을 때만 붙인다.
 * y의 0~1 범위는 양식에 적지 않는다(Anthropic 구조화 출력이 숫자 범위 제한을 받지 않는다). 받은 뒤 parseTranscript가 범위 밖 값을 버린다
 */
export function transcriptSchema(key: AnswerKey, opts: TranscriptOptions = {}): Record<string, unknown> {
  const essays = essayQuestions(key).map(String);
  return {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      grade: intOrNull, class: intOrNull, number: intOrNull,
      name: { type: ['string', 'null'] },
      id_confidence: { type: 'string', enum: ['확실', '추정', '불명'] },
      ...(essays.length ? { essays: essayListSchema(essays) } : {}),
      quant: unitListSchema(key.정량.map(u => u.id), { answer: { type: 'string' }, verdict: { type: 'string', enum: ['O', 'X', '빈칸'] }, ...(opts.위치 ? { y: { type: ['number', 'null'] } } : {}) }),
      qual: unitListSchema(key.정성.map(u => u.id), { responded: { type: 'boolean' }, answer: { type: 'string' } }),
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['page', 'grade', 'class', 'number', 'name', 'id_confidence', ...(essays.length ? ['essays'] : []), 'quant', 'qual', 'notes'],
    additionalProperties: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 모델이 낸 단위 목록을 id별 객체로. 같은 id가 또 나오면 앞 답이 조용히 사라지므로 거절한다 */
export function unitsById(list: unknown, what: string): Record<string, Record<string, unknown>> {
  if (!Array.isArray(list)) throw new DataError(`${what}이 목록이 아님`);
  const units = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    if (!isObj(item) || typeof item.id !== 'string') throw new DataError(`${what}에 id 없는 항목이 있음`);
    if (units.has(item.id)) throw new DataError(`${what}에 단위 ${item.id}가 두 번 나옴`);
    const { id, ...fields } = item;
    units.set(id as string, fields);
  }
  return Object.fromEntries(units);
}

function renameUnits(list: unknown, what: string, names: Record<string, string>): unknown {
  return Object.fromEntries(Object.entries(unitsById(list, what)).map(([id, u]) =>
    [id, Object.fromEntries(Object.entries(u).map(([k, v]) => [names[k] ?? k, v]))]));
}

/** 모델이 낸 글 전체 목록을 문항 번호별로. 채점에 쓰지 않는 칸이라 전사를 실패로 보지 않는다: 모양이 틀린 항목은 버리고, 같은 문항이 또 나오면 앞의 것을 쓴다 */
function essaysByQuestion(list: unknown): Record<string, string> {
  const out = new Map<string, string>();
  for (const e of Array.isArray(list) ? list : []) if (isObj(e) && typeof e.question === 'string' && typeof e.text === 'string' && !out.has(e.question)) out.set(e.question, e.text);
  return Object.fromEntries(out);
}

/** 모델 출력(영문 키)을 전사 양식(한글 키)으로. 객체가 아니면 그대로 돌려 parseTranscript가 거절하게 한다. */
export function fromModelOutput(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  return {
    page: raw.page, 학년: raw.grade, 반: raw.class, 번호: raw.number, 이름: raw.name, 식별확신: raw.id_confidence,
    정량: renameUnits(raw.quant, 'quant', { answer: '답', verdict: '판정', y: '위치' }),
    정성: renameUnits(raw.qual, 'qual', { responded: '응답', answer: '답' }),
    비고: raw.notes,
    ...(raw.essays !== undefined ? { 논술글: essaysByQuestion(raw.essays) } : {}),
  };
}
