import type { AnswerKey } from '../core/types.js';

const intOrNull = { type: ['integer', 'null'] };

/** 정답표에서 만든 전사 JSON 스키마. 모든 단위가 필수라 '단위 누락'이 엔진 쪽에서 생길 수 없다. */
export function transcriptSchema(key: AnswerKey): Record<string, unknown> {
  const qty = Object.fromEntries(key.정량.map(u => [u.id, {
    type: 'object',
    properties: { 답: { type: 'string' }, 판정: { type: 'string', enum: ['O', 'X', '빈칸'] } },
    required: ['답', '판정'], additionalProperties: false,
  }]));
  const qual = Object.fromEntries(key.정성.map(u => [u.id, {
    type: 'object',
    properties: { 응답: { type: 'boolean' }, 답: { type: 'string' } },
    required: ['응답', '답'], additionalProperties: false,
  }]));
  return {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      학년: intOrNull, 반: intOrNull, 번호: intOrNull,
      이름: { type: ['string', 'null'] },
      식별확신: { type: 'string', enum: ['확실', '추정', '불명'] },
      정량: { type: 'object', properties: qty, required: key.정량.map(u => u.id), additionalProperties: false },
      정성: { type: 'object', properties: qual, required: key.정성.map(u => u.id), additionalProperties: false },
      비고: { type: 'array', items: { type: 'string' } },
    },
    required: ['page', '학년', '반', '번호', '이름', '식별확신', '정량', '정성', '비고'],
    additionalProperties: false,
  };
}
