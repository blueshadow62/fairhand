import { findCase, normalizeAnswer } from './rejudge.js';
import { DataError, type AnswerKey, type Case, type Panjeong, type Transcript } from './types.js';

/** 문항별 검토에서 한 장에 정할 것. 판정(정량)·응답(정성)이 없으면 확인 표시만 한다 */
export interface UnitResultItem { page: number; 판정?: Panjeong; 응답?: boolean }
/** 한 단위의 여러 장을 한꺼번에 정하는 요청. 사례기록이면 답 묶음 전체를 O·X로 바꾼 것을 사례로 남긴다 */
export interface UnitResultsRequest { 단위: string; 항목: UnitResultItem[]; 사례기록?: boolean }
/** 쓸전사: 판정·응답·확인 표시 중 하나라도 바뀐 장. 바뀐장수: 판정·응답이 바뀐 장(엑셀을 다시 만들 일). 확인장수: 새로 확인한 장 */
export interface UnitResultsPlan { 쓸전사: Transcript[]; 바뀐장수: number; 확인장수: number; 사례: Case[] }

export const MAX_UNIT_ITEMS = 1000;
const VERDICTS: readonly unknown[] = ['O', 'X', '빈칸'];

/** 이 장에서 이 단위를 확인했는지. 답안지별 검토에서 장 전체를 확인 완료한 것도 친다 */
export const unitChecked = (t: Transcript, 단위: string): boolean => t.확인완료 === true || (t.확인단위 ?? []).includes(단위);

/** 가장 많이 쓴 원래 글(앞뒤 공백만 정리). 수가 같으면 가나다순으로 골라 장 순서가 드러나지 않게 한다 */
export function representative(answers: string[]): string {
  const count = new Map<string, number>();
  for (const a of answers) { const s = a.trim(); count.set(s, (count.get(s) ?? 0) + 1); }
  let best = '', most = 0;
  for (const [s, n] of count) if (n > most || (n === most && s.localeCompare(best, 'ko') < 0)) { best = s; most = n; }
  return best;
}

/**
 * 렌더러가 보낸 요청은 모양부터 검사한다. 같은 장이 같은 값으로 겹치면 하나로 줄이고, 다른 값으로 겹치면 거절한다.
 * 오류 글에 장 번호를 넣지 않는다: 문항별 검토 화면은 학생 신원을 숨기는 화면이다
 */
export function unitResultsRequest(raw: unknown): UnitResultsRequest {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new DataError('문항별 검토 요청이 잘못되었습니다');
  if (typeof o.단위 !== 'string' || !o.단위) throw new DataError('단위가 없습니다');
  if (!Array.isArray(o.항목) || !o.항목.length) throw new DataError('정할 장이 없습니다');
  if (o.항목.length > MAX_UNIT_ITEMS) throw new DataError(`한 번에 ${MAX_UNIT_ITEMS}장까지 정할 수 있습니다`);
  const byPage = new Map<number, UnitResultItem>();
  for (const v of o.항목 as unknown[]) {
    const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    if (!Number.isInteger(x.page) || (x.page as number) < 1) throw new DataError('잘못된 장 번호가 있습니다');
    if (x.판정 !== undefined && !VERDICTS.includes(x.판정)) throw new DataError('판정 값이 잘못되었습니다');
    if (x.응답 !== undefined && typeof x.응답 !== 'boolean') throw new DataError('응답 값은 true/false여야 합니다');
    const it: UnitResultItem = { page: x.page as number, ...(x.판정 !== undefined ? { 판정: x.판정 as Panjeong } : {}), ...(x.응답 !== undefined ? { 응답: x.응답 as boolean } : {}) };
    const prev = byPage.get(it.page);
    if (prev && (prev.판정 !== it.판정 || prev.응답 !== it.응답)) throw new DataError('같은 장을 서로 다르게 정한 요청입니다');
    byPage.set(it.page, it);
  }
  return { 단위: o.단위, 항목: [...byPage.values()], 사례기록: o.사례기록 === true };
}

/**
 * 한 단위의 여러 장을 정한다. 그 단위·그 장만 바꾸고 다른 단위의 판정은 건드리지 않는다(사례 기록의 전체 재판정을 쓰지 않는 까닭).
 * 사례는 그 답을 쓴 장 전부를 같은 O·X로 바꿨을 때만 만든다. 묶음에서 한 장만 다르게 정한 것은 그 답의 기준이 아니다
 */
export function planUnitResults(key: AnswerKey, transcripts: Transcript[], req: UnitResultsRequest, now: Date): UnitResultsPlan {
  const 단위 = req.단위;
  const qty = key.정량.some(u => u.id === 단위), qual = key.정성.some(u => u.id === 단위);
  if (!qty && !qual) throw new DataError(`정답표에 단위 ${단위}가 없습니다`);
  if (qty && req.항목.some(i => i.응답 !== undefined)) throw new DataError(`${단위}는 정량 단위라 응답 대신 판정을 정합니다`);
  if (qual && req.항목.some(i => i.판정 !== undefined)) throw new DataError(`${단위}는 정성 단위라 판정 대신 응답을 정합니다`);
  const byPage = new Map(transcripts.map(t => [t.page, t]));
  const missing = req.항목.filter(i => !byPage.has(i.page)).length;
  if (missing) throw new DataError(`전사가 없는 장이 ${missing}장 있어 아무것도 바꾸지 않았습니다`);

  const units = [...key.정량, ...key.정성].map(u => u.id);
  const 쓸전사: Transcript[] = [];
  let 바뀐장수 = 0, 확인장수 = 0;
  for (const it of req.항목) {
    const t = byPage.get(it.page)!;
    let next = t, changed = false;
    if (qty) {
      const cur = t.정량[단위] ?? { 답: '', 판정: '빈칸' as Panjeong };
      if (it.판정 !== undefined && it.판정 !== cur.판정) { next = { ...next, 정량: { ...next.정량, [단위]: { ...cur, 판정: it.판정 } } }; changed = true; }
    } else {
      const cur = t.정성[단위] ?? { 응답: false, 답: '' };
      if (it.응답 !== undefined && it.응답 !== cur.응답) { next = { ...next, 정성: { ...next.정성, [단위]: { ...cur, 응답: it.응답 } } }; changed = true; }
    }
    const marks = t.확인단위 ?? [];
    if (!marks.includes(단위)) next = { ...next, 확인단위: [...marks, 단위] };
    const done = new Set(next.확인단위 ?? []);
    if (next.확인완료 !== true && units.every(id => done.has(id))) next = { ...next, 확인완료: true };
    if (next !== t) 쓸전사.push(next);
    if (changed) 바뀐장수++;
    if (!unitChecked(t, 단위)) 확인장수++;
  }

  const 사례: Case[] = [];
  if (qty && req.사례기록) {
    const asked = new Map(req.항목.map(i => [i.page, i.판정]));
    const groups = new Map<string, Transcript[]>();
    for (const t of transcripts) {
      const n = normalizeAnswer(t.정량[단위]?.답 ?? '');
      if (!n) continue; // 빈 답은 사례가 되지 않는다
      const g = groups.get(n);
      if (g) g.push(t); else groups.set(n, [t]);
    }
    for (const members of groups.values()) {
      const v = asked.get(members[0]!.page);
      if (v !== 'O' && v !== 'X') continue;
      if (!members.every(m => asked.get(m.page) === v)) continue;
      if (members.every(m => m.정량[단위]?.판정 === v)) continue; // 바뀐 것이 없으면 확인만
      const 답 = representative(members.map(m => m.정량[단위]?.답 ?? ''));
      if (findCase(key, 단위, 답)?.판정 === v) continue;
      사례.push({ 단위, 답, 판정: v, 일시: now.toISOString(), 출처: '문항별 검토' });
    }
  }
  return { 쓸전사, 바뀐장수, 확인장수, 사례 };
}
