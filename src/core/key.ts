import { DataError, type AnswerKey, type GradingRules, type MaskRect } from './types.js';

export const DEFAULT_RULES: GradingRules = { 맞춤법: '인정', 넓은말: '불인정', 핵심어: '모두' };
const RULE_VALUES: Record<string, string[]> = { 맞춤법: ['인정', '불인정'], 넓은말: ['인정', '불인정'], 핵심어: ['모두', '하나라도'] };
export const gradingRules = (k: AnswerKey): GradingRules => ({ ...DEFAULT_RULES, ...(k.채점규칙 ?? {}) });

/** 구조화 출력(모델 도구 스키마)의 속성 이름 제한. 한글 키를 못 쓰므로 단위 id는 영문·숫자·_ . - */
export const UNIT_ID = /^[a-zA-Z0-9_.-]{1,64}$/;

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
    if (!UNIT_ID.test(u.id)) p.push(`id '${u.id}'는 영문·숫자·_ . -만 쓸 수 있습니다(예: 1-1, E1)`);
    if (u.문항 !== undefined && !Number.isInteger(u.문항)) p.push(`${u.id}: 문항 번호가 숫자가 아닙니다`);
    if (u.배점 !== undefined && !(typeof u.배점 === 'number' && Number.isFinite(u.배점) && u.배점 > 0 && u.배점 <= 100)) p.push(`${u.id}: 배점은 0보다 크고 100 이하인 수여야 합니다`);
  }
  const strList = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');
  for (const u of Array.isArray(o.정량) ? o.정량 : []) {
    if (typeof u?.정답 !== 'string') p.push(`${u?.id}: 정답이 없습니다`);
    if (u?.허용 !== undefined && !strList(u.허용)) p.push(`${u?.id}: 허용은 글자 목록이어야 합니다`);
    if (u?.핵심 !== undefined && !strList(u.핵심)) p.push(`${u?.id}: 핵심은 글자 목록이어야 합니다`);
    if (u?.유형 === '논술형' && u.종류 !== '인용' && u.종류 !== '용어') p.push(`${u?.id}: 논술형 단위의 종류는 '인용' 또는 '용어'여야 합니다`);
  }
  if (o.채점규칙 !== undefined) {
    if (typeof o.채점규칙 !== 'object' || o.채점규칙 === null || Array.isArray(o.채점규칙)) p.push('채점규칙은 객체여야 합니다');
    else for (const [k, v] of Object.entries(o.채점규칙)) if (!RULE_VALUES[k]?.includes(v as string)) p.push(`채점규칙.${k} 값이 잘못됨 (${String(v)})`);
  }
  if (o.사례 !== undefined) {
    const qty = new Set((Array.isArray(o.정량) ? o.정량 : []).map((u: any) => u?.id));
    if (!Array.isArray(o.사례)) p.push('사례는 목록이어야 합니다');
    else o.사례.forEach((c: any, i: number) => {
      if (!qty.has(c?.단위)) p.push(`사례 ${i + 1}: 단위 '${c?.단위}'가 정량에 없습니다`);
      if (c?.판정 !== 'O' && c?.판정 !== 'X') p.push(`사례 ${i + 1}: 판정은 O 또는 X여야 합니다`);
      if (typeof c?.답 !== 'string' || !c.답.trim()) p.push(`사례 ${i + 1}: 답이 비었습니다`);
    });
  }
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  const badMask = (m: any) => !m || ![m.x, m.y, m.w, m.h].every(ok) || m.w <= 0 || m.h <= 0 || m.x + m.w > 1 + 1e-9 || m.y + m.h > 1 + 1e-9;
  for (const f of ['이름가림', '신원가림']) if (o[f] !== undefined && badMask(o[f])) p.push(`${f} 영역이 쪽을 벗어나거나 잘못되었습니다`);
  if (o.답영역 !== undefined) {
    if (!o.답영역 || typeof o.답영역 !== 'object' || Array.isArray(o.답영역)) p.push('답영역은 단위 id를 키로 하는 객체여야 합니다');
    else for (const [id, m] of Object.entries(o.답영역)) {
      if (!ids.has(id)) p.push(`답영역: 정답표에 없는 단위 ${id}`);
      if (badMask(m)) p.push(`답영역 ${id}: 영역이 쪽을 벗어나거나 잘못되었습니다`);
    }
  }
  return p;
}

/** 정답표에 남은 단위의 답 칸만 고른다. 문항 설정 저장으로 단위가 빠지면 그 영역도 버린다. 남는 것이 없으면 undefined */
export function keptRegions(regions: Record<string, MaskRect> | undefined, key: Pick<AnswerKey, '정량' | '정성'>): Record<string, MaskRect> | undefined {
  if (!regions) return undefined;
  const ids = new Set([...key.정량, ...key.정성].map(u => u.id));
  const kept = Object.fromEntries(Object.entries(regions).filter(([id]) => ids.has(id)));
  return Object.keys(kept).length ? kept : undefined;
}

/** 문항별 검토의 그림 보기에서 칠하는 기본 영역: 쪽 위 15%(머리 줄의 학년·반·번호·이름이 드는 자리) */
export const DEFAULT_IDENTITY_MASK: Readonly<MaskRect> = Object.freeze({ x: 0, y: 0, w: 1, h: 0.15 });
export const identityMask = (k: AnswerKey): MaskRect => k.신원가림 ?? DEFAULT_IDENTITY_MASK;

/** 렌더러가 보낸 가림 영역에서 네 수만 꺼낸다(다른 칸이 정답표에 들어가지 않게). 범위는 keyProblems가 본다. null·undefined는 끄기 */
export function maskRectArg(raw: unknown): MaskRect | null {
  if (raw === null || raw === undefined) return null;
  const o = raw as Record<string, unknown>;
  if (typeof raw !== 'object' || ![o.x, o.y, o.w, o.h].every(v => typeof v === 'number')) throw new DataError('가릴 영역 값이 잘못되었습니다');
  return { x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number };
}

export function parseKey(text: string, where = '정답표.json'): AnswerKey {
  let k: unknown;
  try { k = JSON.parse(text); } catch (e) { throw new DataError(`${where}: JSON 오류 ${(e as Error).message}`); }
  const problems = keyProblems(k);
  if (problems.length) throw new DataError(`${where}: ${problems.join('; ')}`);
  return k as AnswerKey;
}

export const isConfirmed = (k: AnswerKey): boolean => k.확인?.완료 === true;
/** 단위 배점(없으면 1점) */
export const unitPoints = (u: { 배점?: number }): number => u.배점 ?? 1;
/** 0.1점 단위 배점을 더할 때 생기는 부동소수 찌꺼기(0.30000000000000004)를 없앤다 */
export const roundScore = (n: number): number => Math.round(n * 100) / 100;
export const fullScore = (k: AnswerKey): number => roundScore([...k.정량, ...k.정성].reduce((s, u) => s + unitPoints(u), 0));

/** 반별 인원(선택). JSON 키는 문자열이지만 숫자 키로 적힌 것도 받는다. */
export function headcount(k: AnswerKey, 반: number): number | undefined {
  const v = (k.대상.인원 as Record<string | number, number> | undefined)?.[String(반)];
  return typeof v === 'number' ? v : undefined;
}
