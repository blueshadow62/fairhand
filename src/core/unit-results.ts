import { decide, findCase, normalizeAnswer } from './rejudge.js';
import { DataError, type AnswerKey, type Case, type Panjeong, type Transcript } from './types.js';

/** 문항별 검토에서 한 장에 정할 것. 판정(정량)·응답(정성)·답(AI가 옮긴 글을 고친 것)이 없으면 확인 표시만 한다 */
export interface UnitResultItem { page: number; 판정?: Panjeong; 응답?: boolean; 답?: string }
/** 한 단위의 여러 장을 한꺼번에 정하는 요청. 사례기록이면 답 묶음 전체를 O·X로 바꾼 것을 사례로 남긴다 */
export interface UnitResultsRequest { 단위: string; 항목: UnitResultItem[]; 사례기록?: boolean }
/**
 * 쓸전사: 판정·응답·답·확인 표시 중 하나라도 바뀐 장. 바뀐장수: 판정·응답·답이 바뀐 장(엑셀을 다시 만들 일). 확인장수: 새로 확인한 장.
 * 글고침: 답 글을 고친 장. 판정필요: 글을 고쳤는데 글자만으로 판정이 정해지지 않아 확인을 푼 장(선생님이 O·X를 고를 일)
 */
export interface UnitResultsPlan { 쓸전사: Transcript[]; 바뀐장수: number; 확인장수: number; 글고침: number; 판정필요: number; 사례: Case[] }

export const MAX_UNIT_ITEMS = 1000;
/** 고친 답 글 하나의 길이 한도(논술형 단위의 답도 들어갈 만큼) */
export const MAX_ANSWER_LEN = 20000;
const VERDICTS: readonly unknown[] = ['O', 'X', '빈칸'];

/** 이 장에서 이 단위를 확인했는지. 답안지별 검토에서 장 전체를 확인 완료한 것도 친다 */
export const unitChecked = (t: Transcript, 단위: string): boolean => t.확인완료 === true || (t.확인단위 ?? []).includes(단위);

/** 답안지별 검토의 '확인 완료' 체크. 사람이 풀면 문항별에서 확인한 단위도 지워, 그 장을 문항별에서 다시 미확인으로 센다 */
export function setSheetDone(t: Transcript, on: boolean): void {
  t.확인완료 = on;
  if (!on) delete t.확인단위;
}

/**
 * 다시 판정(글자 일치·모델)이 판정을 바꾼 단위는 선생님이 본 판정이 아니므로, 그 단위의 확인을 빼고 장의 확인 완료를 푼다.
 * 확인 완료한 장은 모든 단위를 확인한 것이라(unitChecked) 바뀌지 않은 단위의 확인은 확인단위로 옮겨 두어, 문항별에서 바뀐 단위만 다시 본다.
 * 바뀐 단위 중 확인한 것이 없으면 그 장을 그대로 돌려준다. 다시확인: 이 장이 다시 확인할 대상이 되었는지
 */
export function uncheckChanged(t: Transcript, key: Pick<AnswerKey, '정량' | '정성'>, changed: readonly string[]): { transcript: Transcript; 다시확인: boolean } {
  if (!changed.some(id => unitChecked(t, id))) return { transcript: t, 다시확인: false };
  const marks = t.확인완료 === true ? [...new Set([...(t.확인단위 ?? []), ...key.정량.map(u => u.id), ...key.정성.map(u => u.id)])] : t.확인단위 ?? [];
  const kept = marks.filter(id => !changed.includes(id));
  const { 확인단위: _, ...rest } = t;
  return { transcript: { ...rest, 확인완료: false, ...(kept.length ? { 확인단위: kept } : {}) }, 다시확인: true };
}

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
    if (x.답 !== undefined && (typeof x.답 !== 'string' || x.답.length > MAX_ANSWER_LEN)) throw new DataError(`고친 답 글은 ${MAX_ANSWER_LEN}자 이하의 글자여야 합니다`);
    const it: UnitResultItem = { page: x.page as number, ...(x.판정 !== undefined ? { 판정: x.판정 as Panjeong } : {}), ...(x.응답 !== undefined ? { 응답: x.응답 as boolean } : {}),
      ...(x.답 !== undefined ? { 답: x.답 as string } : {}) };
    const prev = byPage.get(it.page);
    if (prev && (prev.판정 !== it.판정 || prev.응답 !== it.응답 || prev.답 !== it.답)) throw new DataError('같은 장을 서로 다르게 정한 요청입니다');
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
  let 바뀐장수 = 0, 확인장수 = 0, 글고침 = 0, 판정필요 = 0;
  for (const it of req.항목) {
    const t = byPage.get(it.page)!;
    let next = t, changed = false;
    // 확인 표시: mark 이 단위를 확인으로, unmark 확인을 푼다, keep 그대로. 같은 글로 '고친' 것은 아무것도 바꾸지 않는다(확인으로 치지 않는다)
    const newText = it.답 !== undefined && it.답 !== (qty ? t.정량[단위]?.답 ?? '' : t.정성[단위]?.답 ?? '');
    let check: 'mark' | 'unmark' | 'keep' = it.답 !== undefined && !newText && it.판정 === undefined && it.응답 === undefined ? 'keep' : 'mark';
    if (newText) 글고침++;
    if (qty) {
      const cur = t.정량[단위] ?? { 답: '', 판정: '빈칸' as Panjeong };
      const 답 = it.답 ?? cur.답;
      let 판정 = it.판정 ?? cur.판정;
      // 글을 고쳤는데 판정을 함께 정하지 않았으면: 빈칸·사례·정답·허용 글자 일치는 전사 저장 때와 같은 규칙으로 정하고 확인한다.
      // 뜻으로 볼 일이면 옛 판정(AI가 다른 글에 내린 것)이 '확인됨'으로 남지 않게 확인을 풀어 선생님이 고르게 한다
      if (newText && it.판정 === undefined) {
        const d = decide(key, 단위, 답);
        if (d) 판정 = d.판정; else { check = 'unmark'; 판정필요++; }
      }
      if (답 !== cur.답 || 판정 !== cur.판정) { next = { ...next, 정량: { ...next.정량, [단위]: { ...cur, 답, 판정 } } }; changed = true; }
    } else {
      const cur = t.정성[단위] ?? { 응답: false, 답: '' };
      const 답 = it.답 ?? cur.답, 응답 = it.응답 ?? cur.응답;
      if (newText && it.응답 === undefined) check = 'keep'; // 응답형은 응답 여부로만 채점하므로 글만 고쳤으면 응답·확인 표시는 그대로
      if (답 !== cur.답 || 응답 !== cur.응답) { next = { ...next, 정성: { ...next.정성, [단위]: { ...cur, 답, 응답 } } }; changed = true; }
    }
    if (check === 'mark') {
      const marks = t.확인단위 ?? [];
      if (!marks.includes(단위)) next = { ...next, 확인단위: [...marks, 단위] };
      const done = new Set(next.확인단위 ?? []);
      if (next.확인완료 !== true && units.every(id => done.has(id))) next = { ...next, 확인완료: true };
      if (!unitChecked(t, 단위)) 확인장수++;
    } else if (check === 'unmark') next = uncheckChanged(next, key, [단위]).transcript;
    if (next !== t) 쓸전사.push(next);
    if (changed) 바뀐장수++;
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
  return { 쓸전사, 바뀐장수, 확인장수, 글고침, 판정필요, 사례 };
}
