import type { AnswerKey, Hwaksin, Student, Transcript } from '../../core/types.js';

export interface ReviewItem { page: number; 학년: number | null; 반: number | null; 번호: number | null; 이름: string | null; 식별확신: Hwaksin; 비고수: number; 확인완료: boolean; 중복: boolean }
export interface Filter { 비고만: boolean; 문제먼저: boolean; 반: number | null; 검색: string; 미확인만: boolean }

const sid = (t: { 학년: number | null; 반: number | null; 번호: number | null }) => (t.학년 === null || t.반 === null || t.번호 === null ? null : `${t.학년}-${t.반}-${t.번호}`);

/** 중복 = 같은 학년·반·번호가 다른 장에도 있음(식별 불명은 세지 않는다) */
export function toItems(transcripts: Transcript[]): ReviewItem[] {
  const count = new Map<string, number>();
  for (const t of transcripts) { const k = sid(t); if (k && t.식별확신 !== '불명') count.set(k, (count.get(k) ?? 0) + 1); }
  return transcripts.map(t => {
    const k = sid(t);
    return { page: t.page, 학년: t.학년, 반: t.반, 번호: t.번호, 이름: t.이름, 식별확신: t.식별확신, 비고수: t.비고.length, 확인완료: t.확인완료 === true,
      중복: !!k && t.식별확신 !== '불명' && (count.get(k) ?? 0) > 1 };
  });
}

export const isProblem = (i: ReviewItem): boolean => i.중복 || i.식별확신 !== '확실';

/** 문제먼저: 중복·불명·추정 → 비고 있음 → 나머지, 묶음 안은 page 순. 검색: 번호(숫자 일치) 또는 이름 부분 일치 */
export function applyFilter(items: ReviewItem[], f: Filter): ReviewItem[] {
  const q = f.검색.trim();
  const out = items.filter(i => (!f.비고만 || i.비고수 > 0) && (f.반 === null || i.반 === f.반) && (!f.미확인만 || !i.확인완료)
    && (!q || (/^\d+$/.test(q) ? i.번호 === Number(q) : (i.이름 ?? '').includes(q))));
  const group = (i: ReviewItem) => (!f.문제먼저 ? 0 : isProblem(i) ? 0 : i.비고수 > 0 ? 1 : 2);
  return out.sort((a, b) => group(a) - group(b) || a.page - b.page);
}

/** 명단이 있으면 명단(대상 학년·반) 중 전사에 없는 학생, 없으면 반별 인원 기준(1..인원 중 없는 번호) */
export function missingStudents(key: AnswerKey, transcripts: Transcript[], roster: Student[] | null): Student[] {
  const have = new Set(transcripts.filter(t => t.식별확신 !== '불명').map(sid).filter((k): k is string => !!k));
  const 학년 = key.대상.학년;
  let candidates: Student[];
  if (roster) candidates = roster.filter(s => s.학년 === 학년 && key.대상.반.includes(s.반));
  else {
    candidates = [];
    for (const 반 of key.대상.반) {
      const n = (key.대상.인원 as Record<string, number> | undefined)?.[String(반)];
      if (typeof n === 'number') for (let 번호 = 1; 번호 <= n; 번호++) candidates.push({ 학년, 반, 번호, 이름: null });
    }
  }
  return candidates.filter(s => !have.has(`${s.학년}-${s.반}-${s.번호}`));
}
