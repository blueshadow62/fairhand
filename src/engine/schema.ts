import { DataError, type AnswerKey } from '../core/types.js';

const intOrNull = { type: ['integer', 'null'] };
/** 구조화 출력(도구 input_schema)의 속성 이름 제한. 한글 키를 못 쓰므로 스키마는 영문 키, 전사 파일은 한글 키. */
const PROPERTY_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;

/** 정답표에서 만든 전사 JSON 스키마(영문 키). 모든 단위가 필수라 '단위 누락'이 엔진 쪽에서 생길 수 없다. */
export function transcriptSchema(key: AnswerKey): Record<string, unknown> {
  for (const u of [...key.정량, ...key.정성]) {
    if (!PROPERTY_NAME.test(u.id)) throw new DataError(`정답표 단위 id '${u.id}'는 영문·숫자·_ . -만 쓸 수 있습니다(모델 출력 스키마 제한)`);
  }
  const qty = Object.fromEntries(key.정량.map(u => [u.id, {
    type: 'object',
    properties: { answer: { type: 'string' }, verdict: { type: 'string', enum: ['O', 'X', '빈칸'] } },
    required: ['answer', 'verdict'], additionalProperties: false,
  }]));
  const qual = Object.fromEntries(key.정성.map(u => [u.id, {
    type: 'object',
    properties: { responded: { type: 'boolean' }, answer: { type: 'string' } },
    required: ['responded', 'answer'], additionalProperties: false,
  }]));
  return {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      grade: intOrNull, class: intOrNull, number: intOrNull,
      name: { type: ['string', 'null'] },
      id_confidence: { type: 'string', enum: ['확실', '추정', '불명'] },
      quant: { type: 'object', properties: qty, required: key.정량.map(u => u.id), additionalProperties: false },
      qual: { type: 'object', properties: qual, required: key.정성.map(u => u.id), additionalProperties: false },
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['page', 'grade', 'class', 'number', 'name', 'id_confidence', 'quant', 'qual', 'notes'],
    additionalProperties: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function renameUnits(units: unknown, names: Record<string, string>): unknown {
  if (!isObj(units)) return units;
  return Object.fromEntries(Object.entries(units).map(([id, u]) =>
    [id, isObj(u) ? Object.fromEntries(Object.entries(u).map(([k, v]) => [names[k] ?? k, v])) : u]));
}

/** 모델 출력(영문 키)을 전사 양식(한글 키)으로. 객체가 아니면 그대로 돌려 parseTranscript가 거절하게 한다. */
export function fromModelOutput(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  return {
    page: raw.page, 학년: raw.grade, 반: raw.class, 번호: raw.number, 이름: raw.name, 식별확신: raw.id_confidence,
    정량: renameUnits(raw.quant, { answer: '답', verdict: '판정' }),
    정성: renameUnits(raw.qual, { responded: '응답', answer: '답' }),
    비고: raw.notes,
  };
}
