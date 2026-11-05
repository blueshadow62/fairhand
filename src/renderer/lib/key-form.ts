import type { AnswerKey, QtyUnit, QualUnit } from '../../core/types.js';
import type { KeyDraftResult } from '../../shared/ipc.js';

export type UnitType = '빈칸형' | '단답형' | '문장형' | '요소형' | '확장';
export interface UnitRow { 문항: number; 유형: UnitType; 설명: string; 정답: string; 허용: string /* 쉼표 구분 */; 핵심: string /* 쉼표 구분 */; 요소: string /* 요소형: 줄마다 하나 */ }
export interface KeyMeta { 글: string; 학기: string; 학년: number; 반: number[]; 인원: Record<string, number> /* "1": 28 */ }

export const UNIT_TYPES: UnitType[] = ['빈칸형', '단답형', '문장형', '요소형', '확장'];
export const emptyRow = (문항 = 1, 유형: UnitType = '단답형'): UnitRow => ({ 문항, 유형, 설명: '', 정답: '', 허용: '', 핵심: '', 요소: '' });

const list = (s: string, sep: RegExp): string[] => s.split(sep).map(x => x.trim()).filter(Boolean);

/** 편집 행 → 정답표. id는 문항마다 행 순서로 1, 2…(요소형은 요소마다), 확장은 E1, E2… */
export function rowsToKey(meta: KeyMeta, rows: UnitRow[], 확인?: AnswerKey['확인']): AnswerKey {
  const seq = new Map<number, number>();
  const nextId = (문항: number) => { const n = (seq.get(문항) ?? 0) + 1; seq.set(문항, n); return `${문항}-${n}`; };
  const 정량: QtyUnit[] = [], 정성: QualUnit[] = [];
  for (const r of rows) {
    if (r.유형 === '확장') { 정성.push({ id: `E${정성.length + 1}`, 문항: r.문항, 설명: r.설명.trim() }); continue; }
    if (r.유형 === '요소형') {
      list(r.요소, /\r?\n/).forEach((정답, i) => 정량.push({ id: nextId(r.문항), 문항: r.문항, 설명: `요소 ${i + 1}`, 정답, 유형: '요소형' }));
      continue;
    }
    const u: QtyUnit = { id: nextId(r.문항), 문항: r.문항, 설명: r.설명.trim(), 정답: r.정답.trim() };
    const 허용 = list(r.허용, /,/), 핵심 = list(r.핵심, /,/);
    if (허용.length) u.허용 = 허용;
    if (r.유형 === '문장형' && 핵심.length) u.핵심 = 핵심;
    u.유형 = r.유형;
    정량.push(u);
  }
  const 대상: AnswerKey['대상'] = { 학년: meta.학년, 반: [...meta.반] };
  if (Object.keys(meta.인원).length) 대상.인원 = { ...meta.인원 };
  const key: AnswerKey = { 세트: `${meta.학기} ${meta.학년}학년 ${meta.글}`, 글: meta.글.trim(), 학기: meta.학기.trim(), 대상, 정량, 정성 };
  if (확인) key.확인 = 확인;
  return key;
}

/** 정답표 단위 → 편집 행. 유형이 없는 옛 정답표는 핵심 있음→문장형, 같은 문항에 단위 둘 이상→빈칸형, 하나→단답형 */
function unitsToRows(정량: QtyUnit[], 정성: QualUnit[]): UnitRow[] {
  const perQuestion = new Map<number, number>();
  for (const u of 정량) perQuestion.set(u.문항, (perQuestion.get(u.문항) ?? 0) + 1);
  const rows: UnitRow[] = [];
  const elementRow = new Map<number, UnitRow>();
  for (const u of 정량) {
    const 유형: UnitType = u.유형 ?? (u.핵심?.length ? '문장형' : (perQuestion.get(u.문항)! > 1 ? '빈칸형' : '단답형'));
    if (유형 === '요소형') {
      const row = elementRow.get(u.문항);
      if (row) { row.요소 += `\n${u.정답}`; continue; }
      const r = { ...emptyRow(u.문항, '요소형'), 요소: u.정답 };
      elementRow.set(u.문항, r); rows.push(r); continue;
    }
    rows.push({ 문항: u.문항, 유형, 설명: u.설명, 정답: u.정답, 허용: (u.허용 ?? []).join(', '), 핵심: (u.핵심 ?? []).join(', '), 요소: '' });
  }
  for (const u of 정성) rows.push({ ...emptyRow(u.문항, '확장'), 설명: u.설명 });
  return rows;
}

export function keyToRows(key: AnswerKey): { meta: KeyMeta; rows: UnitRow[] } {
  const 인원: Record<string, number> = {};
  for (const [k, v] of Object.entries(key.대상.인원 ?? {})) if (typeof v === 'number') 인원[String(k)] = v;
  return { meta: { 글: key.글, 학기: key.학기, 학년: key.대상.학년, 반: [...key.대상.반], 인원 }, rows: unitsToRows(key.정량, key.정성) };
}

export const draftToRows = (d: KeyDraftResult): UnitRow[] => unitsToRows(d.정량, d.정성);

export function validateRows(meta: KeyMeta, rows: UnitRow[]): string[] {
  const e: string[] = [];
  if (!meta.글.trim()) e.push('글 제목이 비었습니다');
  if (!meta.학기.trim()) e.push('학기가 비었습니다');
  if (!Number.isInteger(meta.학년) || meta.학년 < 1 || meta.학년 > 6) e.push('학년은 1~6이어야 합니다');
  if (!meta.반.length || !meta.반.every(n => Number.isInteger(n) && n > 0)) e.push('반이 비었거나 숫자가 아닙니다');
  if (!rows.length) e.push('문항이 하나도 없습니다');
  rows.forEach((r, i) => {
    const at = `${i + 1}번째 줄`;
    if (!Number.isInteger(r.문항) || r.문항 <= 0) e.push(`${at}: 문항 번호가 비었거나 0 이하입니다`);
    if (r.유형 === '요소형') { if (!list(r.요소, /\r?\n/).length) e.push(`${at}: 요소형인데 요소가 없습니다(줄마다 하나)`); }
    else if (r.유형 !== '확장' && !r.정답.trim()) e.push(`${at}: 정답이 비었습니다`);
    if (r.유형 === '문장형' && !list(r.핵심, /,/).length) e.push(`${at}: 문장형인데 핵심 낱말이 없습니다`);
  });
  return e;
}

/** "1:28, 3:27" → { "1": 28, "3": 27 }. 형식이 틀린 조각은 버린다 */
export function parseHeadcount(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of list(s, /,/)) { const m = /^(\d+)\s*:\s*(\d+)$/.exec(part); if (m) out[String(Number(m[1]))] = Number(m[2]); }
  return out;
}
export const formatHeadcount = (r: Record<string, number>): string => Object.entries(r).map(([k, v]) => `${k}:${v}`).join(', ');
export const parseClasses = (s: string): number[] => list(s, /[,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
