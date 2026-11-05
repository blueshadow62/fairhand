import { DataError, type AnswerKey } from './types.js';

export function keyProblems(k: unknown): string[] {
  const p: string[] = [];
  const o = (k ?? {}) as Record<string, any>;
  if (typeof o.학기 !== 'string' || !o.학기.trim()) p.push('학기가 없습니다. 예: "학기": "2026 2학기"');
  if (!Number.isInteger(o.대상?.학년)) p.push('대상.학년이 없거나 숫자가 아닙니다');
  if (!Array.isArray(o.대상?.반) || o.대상.반.length === 0) p.push('대상.반이 없습니다');
  // "1"처럼 글자로 쓰면 학생과 맞지 않아 멈추지 않고 0행이 된다
  else if (!o.대상.반.every(Number.isInteger)) p.push(`대상.반은 숫자 목록이어야 합니다 (${JSON.stringify(o.대상.반)})`);
  for (const sec of ['정량', '정성']) if (!Array.isArray(o[sec])) p.push(`${sec}이 목록이 아닙니다`);
  const ids = new Set<string>();
  for (const u of [...(Array.isArray(o.정량) ? o.정량 : []), ...(Array.isArray(o.정성) ? o.정성 : [])]) {
    if (typeof u?.id !== 'string' || !u.id) { p.push('id 없는 단위가 있습니다'); continue; }
    if (ids.has(u.id)) p.push(`id 중복: ${u.id}`);
    ids.add(u.id);
  }
  for (const u of Array.isArray(o.정량) ? o.정량 : []) if (typeof u?.정답 !== 'string') p.push(`${u?.id}: 정답이 없습니다`);
  return p;
}

export function parseKey(text: string, where = '정답표.json'): AnswerKey {
  let k: unknown;
  try { k = JSON.parse(text); } catch (e) { throw new DataError(`${where}: JSON 오류 ${(e as Error).message}`); }
  const problems = keyProblems(k);
  if (problems.length) throw new DataError(`${where}: ${problems.join('; ')}`);
  return k as AnswerKey;
}

export const isConfirmed = (k: AnswerKey): boolean => k.확인?.완료 === true;
export const fullScore = (k: AnswerKey): number => k.정량.length + k.정성.length;

/** 반별 인원(선택). JSON 키는 문자열이지만 숫자 키로 적힌 것도 받는다. */
export function headcount(k: AnswerKey, 반: number): number | undefined {
  const v = (k.대상.인원 as Record<string | number, number> | undefined)?.[String(반)];
  return typeof v === 'number' ? v : undefined;
}
