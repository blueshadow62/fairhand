import { DEFAULT_RULES, gradingRules } from '../../core/key.js';
import type { AnswerKey, Case, GradingRules, QtyUnit, QualUnit } from '../../core/types.js';
import type { KeyDraftResult } from '../../shared/ipc.js';
import { t } from './i18n.js';

export type UnitType = '빈칸형' | '단답형' | '문장형' | '요소형' | '응답형';
export interface UnitRow { 문항: number; 유형: UnitType; 설명: string; 정답: string; 허용: string /* 쉼표 구분 */; 핵심: string /* 쉼표 구분 */; 요소: string /* 요소형: 줄마다 하나 */; 배점: string /* 단위마다(요소형은 요소마다), 기본 1 */ }
export interface KeyMeta { 글: string; 학기: string; 학년: number; 반: number[]; 인원: Record<string, number> /* "1": 28 */; 채점규칙?: GradingRules /* 없으면 기본값 */ }

export const UNIT_TYPES: UnitType[] = ['빈칸형', '단답형', '문장형', '요소형', '응답형'];
export const emptyRow = (문항 = 1, 유형: UnitType = '단답형'): UnitRow => ({ 문항, 유형, 설명: '', 정답: '', 허용: '', 핵심: '', 요소: '', 배점: '1' });

const list = (s: string, sep: RegExp): string[] => s.split(sep).map(x => x.trim()).filter(Boolean);
/** 1점이면 쓰지 않는다(정답표를 짧게, 배점을 두기 전 정답표와 같은 모양으로) */
const points = (r: UnitRow): { 배점?: number } => { const n = Number(r.배점); return Number.isFinite(n) && n > 0 && n !== 1 ? { 배점: n } : {}; };
const pointsText = (u: { 배점?: number }): string => String(u.배점 ?? 1);

/** 편집 행 → 정답표. id는 문항마다 행 순서로 1, 2…(요소형은 요소마다), 응답형(정성)은 E1, E2… */
export function rowsToKey(meta: KeyMeta, rows: UnitRow[], 확인?: AnswerKey['확인'], 사례?: Case[]): AnswerKey {
  const seq = new Map<number, number>();
  const nextId = (문항: number) => { const n = (seq.get(문항) ?? 0) + 1; seq.set(문항, n); return `${문항}-${n}`; };
  const 정량: QtyUnit[] = [], 정성: QualUnit[] = [];
  for (const r of rows) {
    if (r.유형 === '응답형') { 정성.push({ id: `E${정성.length + 1}`, 문항: r.문항, 설명: r.설명.trim(), ...points(r) }); continue; }
    if (r.유형 === '요소형') {
      list(r.요소, /\r?\n/).forEach((정답, i) => 정량.push({ id: nextId(r.문항), 문항: r.문항, 설명: `요소 ${i + 1}`, 정답, 유형: '요소형', ...points(r) }));
      continue;
    }
    const u: QtyUnit = { id: nextId(r.문항), 문항: r.문항, 설명: r.설명.trim(), 정답: r.정답.trim() };
    const 허용 = list(r.허용, /,/), 핵심 = list(r.핵심, /,/);
    if (허용.length) u.허용 = 허용;
    if (r.유형 === '문장형' && 핵심.length) u.핵심 = 핵심;
    u.유형 = r.유형;
    Object.assign(u, points(r));
    정량.push(u);
  }
  const 대상: AnswerKey['대상'] = { 학년: meta.학년, 반: [...meta.반] };
  if (Object.keys(meta.인원).length) 대상.인원 = { ...meta.인원 };
  const key: AnswerKey = { 세트: `${meta.학기} ${meta.학년}학년 ${meta.글}`, 글: meta.글.trim(), 학기: meta.학기.trim(), 대상, 정량, 정성 };
  if (확인) key.확인 = 확인;
  // 기본값과 같으면 쓰지 않는다(정답표를 짧게, 옛 정답표와 같은 모양으로)
  const r = { ...DEFAULT_RULES, ...(meta.채점규칙 ?? {}) };
  if ((Object.keys(r) as (keyof GradingRules)[]).some(k => r[k] !== DEFAULT_RULES[k])) key.채점규칙 = r;
  if (사례?.length) key.사례 = 사례; // 사례는 폼이 아니라 정답표에서 그대로 보존한다
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
      const r = { ...emptyRow(u.문항, '요소형'), 요소: u.정답, 배점: pointsText(u) };
      elementRow.set(u.문항, r); rows.push(r); continue;
    }
    rows.push({ 문항: u.문항, 유형, 설명: u.설명, 정답: u.정답, 허용: (u.허용 ?? []).join(', '), 핵심: (u.핵심 ?? []).join(', '), 요소: '', 배점: pointsText(u) });
  }
  for (const u of 정성) rows.push({ ...emptyRow(u.문항, '응답형'), 설명: u.설명, 배점: pointsText(u) });
  return rows;
}

export function keyToRows(key: AnswerKey): { meta: KeyMeta; rows: UnitRow[] } {
  const 인원: Record<string, number> = {};
  for (const [k, v] of Object.entries(key.대상.인원 ?? {})) if (typeof v === 'number') 인원[String(k)] = v;
  return { meta: { 글: key.글, 학기: key.학기, 학년: key.대상.학년, 반: [...key.대상.반], 인원, 채점규칙: gradingRules(key) }, rows: unitsToRows(key.정량, key.정성) };
}

export const draftToRows = (d: KeyDraftResult): UnitRow[] => unitsToRows(d.정량, d.정성);

export function validateRows(meta: KeyMeta, rows: UnitRow[]): string[] {
  const e: string[] = [];
  if (!meta.글.trim()) e.push(t('form.titleEmpty'));
  if (!meta.학기.trim()) e.push(t('form.semesterEmpty'));
  if (!Number.isInteger(meta.학년) || meta.학년 < 1 || meta.학년 > 6) e.push(t('form.gradeRange'));
  if (!meta.반.length || !meta.반.every(n => Number.isInteger(n) && n > 0)) e.push(t('form.classesBad'));
  if (!rows.length) e.push(t('form.noRows'));
  rows.forEach((r, i) => {
    const at = t('form.rowAt', { n: i + 1 });
    if (!Number.isInteger(r.문항) || r.문항 <= 0) e.push(t('form.questionBad', { at }));
    if (r.유형 === '요소형') { if (!list(r.요소, /\r?\n/).length) e.push(t('form.elementsMissing', { at })); }
    else if (r.유형 !== '응답형' && !r.정답.trim()) e.push(t('form.answerEmpty', { at }));
    if (r.유형 === '문장형' && !list(r.핵심, /,/).length) e.push(t('form.keywordsMissing', { at }));
    const n = Number(r.배점);
    if (!(Number.isFinite(n) && n > 0 && n <= 100)) e.push(t('form.pointsBad', { at }));
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
/** "1, 3" · "1~6" · "1-6" · "1-3 5" 모두 허용. 범위는 펼치고 겹침은 하나로, 오름차순 */
export function parseClasses(s: string): number[] {
  const out = new Set<number>();
  for (const tok of list(s, /[,\s]+/)) {
    const m = /^(\d+)\s*[-~–]\s*(\d+)$/.exec(tok);
    if (m) { const a = Number(m[1]), b = Number(m[2]); for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 100; n++) out.add(n); continue; }
    const n = Number(tok);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
