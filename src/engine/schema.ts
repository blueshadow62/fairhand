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

/** 정답표에서 만든 전사 JSON 스키마(영문 키) */
export function transcriptSchema(key: AnswerKey): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      grade: intOrNull, class: intOrNull, number: intOrNull,
      name: { type: ['string', 'null'] },
      id_confidence: { type: 'string', enum: ['확실', '추정', '불명'] },
      quant: unitListSchema(key.정량.map(u => u.id), { answer: { type: 'string' }, verdict: { type: 'string', enum: ['O', 'X', '빈칸'] } }),
      qual: unitListSchema(key.정성.map(u => u.id), { responded: { type: 'boolean' }, answer: { type: 'string' } }),
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['page', 'grade', 'class', 'number', 'name', 'id_confidence', 'quant', 'qual', 'notes'],
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

/** 모델 출력(영문 키)을 전사 양식(한글 키)으로. 객체가 아니면 그대로 돌려 parseTranscript가 거절하게 한다. */
export function fromModelOutput(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  return {
    page: raw.page, 학년: raw.grade, 반: raw.class, 번호: raw.number, 이름: raw.name, 식별확신: raw.id_confidence,
    정량: renameUnits(raw.quant, 'quant', { answer: '답', verdict: '판정' }),
    정성: renameUnits(raw.qual, 'qual', { responded: '응답', answer: '답' }),
    비고: raw.notes,
  };
}
