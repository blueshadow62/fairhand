import { headcount } from './key.js';
import { identified, findDuplicates } from './transcript.js';
import { studentKey, pageTag, type AnswerKey, type Row, type ScoreResult, type Student, type Transcript } from './types.js';

export function scoreOne(key: AnswerKey, t: Transcript): ScoreResult {
  const r: ScoreResult = { 판정: {}, 답: {}, 응답: {}, 비고: [...t.비고], 정량: 0, 정성: 0, 합계: 0 };
  for (const u of key.정량) {
    const v = t.정량[u.id];
    if (!v) r.비고.push(`단위 누락: ${u.id}`);
    r.판정[u.id] = v ? v.판정 : '빈칸';
    r.답[u.id] = v?.답 ?? '';
  }
  for (const u of key.정성) {
    const v = t.정성[u.id];
    if (!v) r.비고.push(`단위 누락: ${u.id}`);
    r.응답[u.id] = v ? v.응답 === true : false;
    r.답[u.id] = v?.답 ?? '';
  }
  r.정량 = Object.values(r.판정).filter(x => x === 'O').length;
  r.정성 = Object.values(r.응답).filter(Boolean).length;
  r.합계 = r.정량 + r.정성;
  return r;
}

const emptyRow = (s: Student, 비고: string): Row =>
  ({ ...s, 합계: null, 정량: null, 정성: null, 비고, page: null, 판정: {}, 답: {}, 응답: {} });

const inTarget = (key: AnswerKey, t: Transcript): boolean =>
  identified(t) && t.학년 === key.대상.학년 && key.대상.반.includes(t.반!);

const pagesText = (pages: number[]): string => pages.map(pageTag).join(', ');

export function buildRows(key: AnswerKey, roster: Student[] | null, ts: Transcript[]): { rows: Row[]; unmatched: Row[] } {
  // 1. 행을 만들 학생 목록: 명단 > 인원 > 답안지
  const target = new Map<string, Student>();
  const add = (s: Student) => { const k = studentKey(s.학년, s.반, s.번호); if (!target.has(k)) target.set(k, s); };
  if (roster) {
    for (const s of roster) if (s.학년 === key.대상.학년 && key.대상.반.includes(s.반)) add(s);
  } else {
    for (const 반 of key.대상.반) {
      const n = headcount(key, 반);
      if (n !== undefined) for (let i = 1; i <= n; i++) add({ 학년: key.대상.학년, 반, 번호: i, 이름: null });
    }
    for (const t of ts) if (inTarget(key, t)) add({ 학년: t.학년!, 반: t.반!, 번호: t.번호!, 이름: t.이름 });
  }

  // 2. 답안지를 학생에 붙이거나 미확인으로
  const dups = findDuplicates(key, ts);
  const byStudent = new Map<string, Transcript>();
  const unmatched: Row[] = [];
  const toUnmatched = (t: Transcript, reason: string) => {
    const sc = scoreOne(key, t);
    unmatched.push({ 학년: t.학년, 반: t.반, 번호: t.번호, 이름: `미확인 답안지(${pageTag(t.page)})`,
      ...sc, 비고: [reason, ...sc.비고].join('; '), page: t.page });
  };
  for (const t of ts) {
    if (!identified(t)) { toUnmatched(t, '학생 식별 불가'); continue; }
    const k = studentKey(t.학년!, t.반!, t.번호!);
    if (dups.has(k)) { toUnmatched(t, `번호 중복(${pagesText(dups.get(k)!)})`); continue; }
    if (!inTarget(key, t)) { toUnmatched(t, '대상 반 아님'); continue; } // 명단에 있어도 대상 반이 아니면 이 말이 맞다
    if (!target.has(k)) { toUnmatched(t, '명단에 없음'); continue; }
    byStudent.set(k, t);
  }

  // 3. 학생 행
  const rows: Row[] = [];
  for (const [k, s] of [...target].sort(([, a], [, b]) => a.반 - b.반 || a.번호 - b.번호)) {
    if (dups.has(k)) { rows.push(emptyRow(s, `미확정(번호 중복: ${pagesText(dups.get(k)!)})`)); continue; }
    const t = byStudent.get(k);
    if (!t) { rows.push(emptyRow(s, roster ? '미제출' : '미제출(인원 기준)')); continue; }
    const sc = scoreOne(key, t);
    const notes: string[] = [];
    if (t.식별확신 === '추정') notes.push('식별 추정');
    if (roster && t.이름 && s.이름 && t.이름 !== s.이름) notes.push(`이름 불일치(답안지: ${t.이름})`);
    rows.push({ ...s, 이름: s.이름 ?? t.이름, ...sc, 비고: [...notes, ...sc.비고].join('; '), page: t.page });
  }
  unmatched.sort((a, b) => a.page! - b.page!);
  return { rows, unmatched };
}
