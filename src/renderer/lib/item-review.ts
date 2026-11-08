import { normalizeAnswer } from '../../core/rejudge.js';
import type { AnswerKey, Panjeong, QtyUnit, Transcript } from '../../core/types.js';
import { representative, unitChecked } from '../../core/unit-results.js';
import { t } from './i18n.js';

/** 정답·허용·핵심 한 줄. 답안지별 검토의 정량 표와 문항별 검토의 머리가 같은 글을 쓴다 */
export const keyLine = (u: QtyUnit): string => t('review.keyLine', { answer: u.정답,
  allow: u.허용?.length ? t('review.allowPart', { list: u.허용.join(', ') }) : '', keywords: u.핵심?.length ? t('review.keywordsPart', { list: u.핵심.join(', ') }) : '' });

/** 정량 단위에서 같은 답(normalizeAnswer 기준)을 쓴 장의 묶음. 장 번호는 단추가 보낼 곳으로만 쓰고 화면에 보이지 않는다 */
export interface AnswerGroup { 정규: string; 대표: string; 장: number[]; 판정: Record<Panjeong, number>; 갈림: boolean; 확인: number }

export function groupAnswers(transcripts: Transcript[], 단위: string): AnswerGroup[] {
  const map = new Map<string, Transcript[]>();
  for (const t of transcripts) {
    const n = normalizeAnswer(t.정량[단위]?.답 ?? '');
    const g = map.get(n);
    if (g) g.push(t); else map.set(n, [t]);
  }
  return [...map].map(([정규, ts]) => {
    const 판정: Record<Panjeong, number> = { O: 0, X: 0, 빈칸: 0 };
    for (const t of ts) 판정[t.정량[단위]?.판정 ?? '빈칸']++;
    return { 정규, 대표: 정규 ? representative(ts.map(t => t.정량[단위]?.답 ?? '')) : '', 장: ts.map(t => t.page), 판정,
      갈림: Object.values(판정).filter(n => n > 0).length > 1, 확인: ts.filter(t => unitChecked(t, 단위)).length };
  });
}

/** 판정이 갈린 묶음 → 미확인 묶음 → 장 수가 많은 묶음 → 답 가나다순 */
export function sortGroups(groups: AnswerGroup[]): AnswerGroup[] {
  const split = (g: AnswerGroup) => (g.갈림 ? 0 : 1), open = (g: AnswerGroup) => (g.확인 < g.장.length ? 0 : 1);
  return [...groups].sort((a, b) => split(a) - split(b) || open(a) - open(b) || b.장.length - a.장.length
    || a.대표.localeCompare(b.대표, 'ko') || a.정규.localeCompare(b.정규, 'ko'));
}

/** 53비트 문자열 해시(cyrb53). 암호용이 아니라 줄 순서를 섞는 데만 쓴다 */
function hash53(s: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * 장 번호와 무관한 줄 순서: (소금, 단위, 장)의 해시 순. 단위마다 순서가 달라 '답안 3'이 단위를 건너 같은 학생이 아니고,
 * 소금을 실행마다 새로 정해 지난번 순서로 학생을 짐작하지 못한다
 */
export function anonOrder(salt: string, 단위: string, pages: number[]): number[] {
  const h = new Map(pages.map(p => [p, hash53(`${salt}\u0000${단위}\u0000${p}`)]));
  return [...pages].sort((a, b) => h.get(a)! - h.get(b)! || a - b);
}

/** 단위 안의 익명 번호(답안 1, 답안 2…). 장 → 번호 */
export const anonLabels = (salt: string, 단위: string, pages: number[]): Map<number, number> =>
  new Map(anonOrder(salt, 단위, pages).map((p, i) => [p, i + 1]));

export interface UnitSummary { id: string; 설명: string; 정량: boolean; 확인: number; 전체: number; 갈림: number }

/** 정답표 순서(정량 → 정성)의 단위 목록. 확인은 그 단위를 확인한 장, 전체는 전사한 장, 갈림은 판정이 갈린 묶음 수(정량만) */
export function unitSummaries(key: AnswerKey, transcripts: Transcript[]): UnitSummary[] {
  const one = (u: { id: string; 설명: string }, 정량: boolean): UnitSummary => ({
    id: u.id, 설명: u.설명, 정량, 전체: transcripts.length, 확인: transcripts.filter(t => unitChecked(t, u.id)).length,
    갈림: 정량 ? groupAnswers(transcripts, u.id).filter(g => g.갈림).length : 0 });
  return [...key.정량.map(u => one(u, true)), ...key.정성.map(u => one(u, false))];
}

export const unitDone = (s: UnitSummary): boolean => s.전체 > 0 && s.확인 === s.전체;

/** 맨 위 진행 줄: 모든 장을 확인한 단위 수, 확인 완료한 장 수 */
export function progress(key: AnswerKey, transcripts: Transcript[]): { 단위: number; 단위전체: number; 장: number; 장전체: number } {
  const sums = unitSummaries(key, transcripts);
  return { 단위: sums.filter(unitDone).length, 단위전체: sums.length, 장: transcripts.filter(t => t.확인완료 === true).length, 장전체: transcripts.length };
}
