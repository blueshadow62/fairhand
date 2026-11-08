import { addCase, findCase, keyMatch, normalizeAnswer, pagesWithSameAnswer, removeCase } from './rejudge.js';
import { DataError, pageTag, type AnswerKey, type Case, type Panjeong, type Transcript } from './types.js';

/** 답안지별 검토에서 기록할 사례 하나: 한 단위의 답과 선생님이 정한 판정 */
export interface CaseInput { 단위: string; 답: string; 판정: 'O' | 'X' }
/** 사례 기록으로 바뀐 한 장의 한 단위 판정. 되돌리기는 이것으로 이전 값을 안다 */
export interface CaseChange { page: number; 단위: string; 이전: Panjeong; 이후: Panjeong }
/** 기록 전 확인 창에 보일 것: 함께 바뀔 다른 장, 정답·허용과 맞는 답을 X로 기록하는지(논술형은 들어 있는지) */
export interface CasePreview extends CaseInput { 바뀔장: CaseChange[]; 경고: '정답' | '허용' | null; 논술형: boolean }
/** 되돌리기 요청: 기록한 사례(그 기록이 바꿔 쓴 같은 답의 사례가 있으면 함께)와 다른 장의 바뀐 판정 */
export interface CaseRevertRequest { 사례: (CaseInput & { 이전사례?: Case })[]; 변경: CaseChange[] }

export const MAX_REVERT_CASES = 500;
export const MAX_REVERT_CHANGES = 20000;
const VERDICTS: readonly unknown[] = ['O', 'X', '빈칸'];

/** 판정이 O·X로 바뀐 정량 단위(답이 있을 때만)가 사례 후보다. 빈칸으로 바꾼 것은 사례로 남기지 않는다 */
export function caseCandidates(key: AnswerKey, before: Transcript | undefined, after: Transcript): CaseInput[] {
  const out: CaseInput[] = [];
  for (const u of key.정량) {
    const v = after.정량[u.id];
    if (!v || !v.답.trim() || (v.판정 !== 'O' && v.판정 !== 'X') || before?.정량[u.id]?.판정 === v.판정) continue;
    out.push({ 단위: u.id, 답: v.답, 판정: v.판정 });
  }
  return out;
}

/** 사례 하나가 바꿀 장: 같은 단위에 같은(정규화한) 답을 쓴 장 중 판정이 사례와 다른 장 */
export function caseEffects(transcripts: Transcript[], c: CaseInput, exceptPage?: number): CaseChange[] {
  const same = new Set(pagesWithSameAnswer(transcripts, c.단위, c.답, exceptPage));
  return transcripts.flatMap(t => {
    const 이전 = t.정량[c.단위]?.판정 ?? '빈칸';
    return same.has(t.page) && 이전 !== c.판정 ? [{ page: t.page, 단위: c.단위, 이전, 이후: c.판정 }] : [];
  });
}

/**
 * 사례가 정답표와 어긋나는지: 정답·허용과 글자로 맞는 답(논술형은 그 표기가 들어 있는 답)을 X로 정했으면 맞은 쪽('정답'·'허용').
 * 판정은 사례를 정답보다 먼저 보므로 그 답은 X가 된다. 선생님이 알고 정한 예외일 수 있어 막지는 않고 알리기만 한다
 */
export function caseConflict(key: Pick<AnswerKey, '정량'>, c: Pick<Case, '단위' | '답' | '판정'>): '정답' | '허용' | null {
  if (c.판정 !== 'X') return null;
  const u = key.정량.find(x => x.id === c.단위);
  return u ? keyMatch(u, c.답) : null;
}

export function previewCases(key: AnswerKey, transcripts: Transcript[], cases: CaseInput[], page: number): CasePreview[] {
  return cases.map(c => ({ ...c, 바뀔장: caseEffects(transcripts, c, page), 경고: caseConflict(key, c), 논술형: key.정량.find(x => x.id === c.단위)?.유형 === '논술형' }));
}

/** 다른 장이 바뀌거나 정답표와 맞는 답을 X로 기록할 때만 묻는다. 이 장만 바뀌는 보통의 저장은 묻지 않는다 */
export const needsCaseConfirm = (ps: CasePreview[]): boolean => ps.some(p => p.바뀔장.length > 0 || p.경고 !== null);

/** 사례 때문에 바뀐 장의 비고 한 줄. 되돌릴 때 같은 줄을 찾아 지운다 */
export const caseNote = (c: CaseChange): string => `재판정: ${c.단위} ${c.이전}→${c.이후} (사례)`;

const record = (raw: unknown, what: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DataError(what);
  return raw as Record<string, unknown>;
};

function caseInput(raw: unknown): CaseInput {
  const o = record(raw, '사례 요청이 잘못되었습니다');
  if (typeof o.단위 !== 'string' || !o.단위) throw new DataError('단위가 없습니다');
  if (typeof o.답 !== 'string' || !o.답.trim()) throw new DataError('빈 답은 사례로 기록하지 않습니다');
  if (o.판정 !== 'O' && o.판정 !== 'X') throw new DataError('사례의 판정은 O 또는 X여야 합니다');
  return { 단위: o.단위, 답: o.답, 판정: o.판정 };
}

/** 렌더러가 보낸 사례 기록 요청 검사. 다른 칸은 버린다 */
export function caseRequest(raw: unknown): CaseInput & { page: number } {
  const c = caseInput(raw), page = (raw as Record<string, unknown>).page;
  if (!Number.isInteger(page) || (page as number) < 1) throw new DataError('잘못된 장 번호입니다');
  return { ...c, page: page as number };
}

/**
 * 사례를 정답표에 넣고, 같은 단위에 같은 답을 쓴 장만 사례 판정으로 바꾼다. 다른 단위·다른 답은 건드리지 않는다:
 * 전체 재판정은 묻지 않은 장(빈 답 등)까지 바꿔, 확인 창에 보인 장과 실제로 바뀐 장이 달라진다
 */
export function planApplyCase(key: AnswerKey, transcripts: Transcript[], c: CaseInput & { page: number }, now: Date): { key: AnswerKey; 쓸전사: Transcript[]; 변경: CaseChange[]; 이전사례?: Case } {
  if (!key.정량.some(u => u.id === c.단위)) throw new DataError(`정답표에 단위 ${c.단위}가 없습니다`);
  const 이전사례 = findCase(key, c.단위, c.답);
  const next = addCase(key, { 단위: c.단위, 답: c.답, 판정: c.판정, 일시: now.toISOString(), 출처: `검토 ${pageTag(c.page)}` });
  const 변경 = caseEffects(transcripts, c);
  const byPage = new Map(transcripts.map(t => [t.page, t]));
  const 쓸전사 = 변경.map(ch => {
    const t = byPage.get(ch.page)!;
    return { ...t, 정량: { ...t.정량, [ch.단위]: { ...t.정량[ch.단위]!, 판정: ch.이후 } }, 비고: [...t.비고, caseNote(ch)] };
  });
  return { key: next, 쓸전사, 변경, ...(이전사례 ? { 이전사례 } : {}) };
}

/**
 * 렌더러가 보낸 되돌리기 요청 검사. 되돌릴 판정은 요청한 사례의 단위이고 '이후'가 그 사례의 판정이어야 한다:
 * 아무 판정이나 바꾸는 통로가 되지 않게
 */
export function caseRevertRequest(raw: unknown): CaseRevertRequest {
  const o = record(raw, '되돌리기 요청이 잘못되었습니다');
  if (!Array.isArray(o.사례) || !o.사례.length || o.사례.length > MAX_REVERT_CASES) throw new DataError('되돌릴 사례 목록이 잘못되었습니다');
  if (!Array.isArray(o.변경) || o.변경.length > MAX_REVERT_CHANGES) throw new DataError('되돌릴 판정 목록이 잘못되었습니다');
  const seen = new Set<string>(), verdicts = new Map<string, Set<Panjeong>>();
  const 사례 = (o.사례 as unknown[]).map(raw => {
    const c = caseInput(raw), k = `${c.단위}\u0000${normalizeAnswer(c.답)}`;
    if (seen.has(k)) throw new DataError('같은 사례가 두 번 들어 있습니다');
    seen.add(k);
    verdicts.set(c.단위, (verdicts.get(c.단위) ?? new Set<Panjeong>()).add(c.판정));
    const prev = (raw as Record<string, unknown>).이전사례;
    if (prev === undefined || prev === null) return c;
    const p = record(prev, '이전 사례가 잘못되었습니다');
    if (p.단위 !== c.단위 || typeof p.답 !== 'string' || normalizeAnswer(p.답) !== normalizeAnswer(c.답) || (p.판정 !== 'O' && p.판정 !== 'X')
      || typeof p.일시 !== 'string' || typeof p.출처 !== 'string') throw new DataError('이전 사례가 잘못되었습니다');
    return { ...c, 이전사례: { 단위: p.단위, 답: p.답, 판정: p.판정, 일시: p.일시, 출처: p.출처 } as Case };
  });
  const pairs = new Set<string>();
  const 변경 = (o.변경 as unknown[]).map(raw => {
    const x = record(raw, '되돌릴 판정이 잘못되었습니다');
    if (!Number.isInteger(x.page) || (x.page as number) < 1) throw new DataError('잘못된 장 번호가 있습니다');
    if (typeof x.단위 !== 'string' || !verdicts.has(x.단위)) throw new DataError('되돌릴 판정의 단위가 사례와 맞지 않습니다');
    if (!VERDICTS.includes(x.이전) || x.이전 === x.이후 || !verdicts.get(x.단위)!.has(x.이후 as Panjeong)) throw new DataError('되돌릴 판정 값이 잘못되었습니다');
    const k = `${x.page}\u0000${x.단위}`;
    if (pairs.has(k)) throw new DataError('같은 장의 같은 단위가 두 번 들어 있습니다');
    pairs.add(k);
    return { page: x.page as number, 단위: x.단위, 이전: x.이전 as Panjeong, 이후: x.이후 as Panjeong };
  });
  return { 사례, 변경 };
}

/** 한 장의 바뀐 판정을 되돌린다. 지금 판정이 '이후'일 때만 '이전'으로 돌리고 그때 남긴 비고 한 줄도 지운다. 그사이 바뀐 판정은 그대로 둔다 */
export function revertTranscript(t: Transcript, changes: CaseChange[]): { transcript: Transcript; 복원: number; 건너뜀: number } {
  let next = t, 복원 = 0, 건너뜀 = 0;
  for (const ch of changes) {
    if (ch.page !== t.page) continue;
    const v = next.정량[ch.단위];
    if (!v || v.판정 !== ch.이후) { 건너뜀++; continue; }
    const i = next.비고.lastIndexOf(caseNote(ch));
    next = { ...next, 정량: { ...next.정량, [ch.단위]: { ...v, 판정: ch.이전 } }, 비고: i < 0 ? next.비고 : next.비고.filter((_, j) => j !== i) };
    복원++;
  }
  return { transcript: next, 복원, 건너뜀 };
}

/**
 * 되돌리기 계획. 사례는 기록한 판정 그대로 남아 있을 때만 지우고, 그 기록이 바꿔 쓴 사례가 있었으면 되살린다.
 * 복원·건너뜀은 판정 수(장 × 단위). 전사가 없어진 장의 판정은 건너뛴다
 */
export function planCaseRevert(key: AnswerKey, transcripts: Transcript[], req: CaseRevertRequest): { key: AnswerKey | null; 쓸전사: Transcript[]; 사례: number; 복원: number; 건너뜀: number } {
  for (const c of req.사례) if (!key.정량.some(u => u.id === c.단위)) throw new DataError(`정답표에 단위 ${c.단위}가 없습니다`);
  let next = key, 사례 = 0;
  for (const c of req.사례) {
    if (findCase(next, c.단위, c.답)?.판정 !== c.판정) continue;
    next = removeCase(next, c.단위, c.답);
    if (c.이전사례) next = addCase(next, c.이전사례);
    사례++;
  }
  if (next !== key && !next.사례?.length) { const { 사례: _empty, ...rest } = next; next = rest; } // 남는 사례가 없으면 칸을 두지 않는다
  const byPage = new Map(transcripts.map(t => [t.page, t]));
  const 쓸전사: Transcript[] = [];
  let 복원 = 0, 건너뜀 = 0;
  for (const page of new Set(req.변경.map(c => c.page))) {
    const mine = req.변경.filter(c => c.page === page), t = byPage.get(page);
    if (!t) { 건너뜀 += mine.length; continue; }
    const r = revertTranscript(t, mine);
    복원 += r.복원; 건너뜀 += r.건너뜀;
    if (r.복원) 쓸전사.push(r.transcript);
  }
  return { key: next === key ? null : next, 쓸전사, 사례, 복원, 건너뜀 };
}
