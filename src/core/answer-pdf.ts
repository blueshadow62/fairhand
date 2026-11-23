import { fullScore } from './key.js';
import { answerPdfFileName, answerPdfFolderName, uniqueName } from './names.js';
import { fitImage, pageSizeFor, textWidth, type Box, type JpegInfo, type Shape } from './pdf.js';
import { scoreOne } from './score.js';
import { identified } from './transcript.js';
import { pageTag, type AnswerKey, type MaskRect, type Transcript } from './types.js';

/**
 * 답안지 PDF 내보내기의 순수 로직: 어떤 장을 어떤 순서로 어느 파일에 넣고, 장마다 무엇을 그릴지.
 * 파일 읽기·쓰기는 main/answer-pdf.ts가 한다
 */

/** one: 한 파일, class: 반별 파일, student: 학생별(장별) 파일 */
export type AnswerPdfBundle = 'one' | 'class' | 'student';
/** student: 학년·반·번호순(알아보지 못한 장은 뒤에 장 번호순), page: 장 번호순(올린 차례) */
export type AnswerPdfOrder = 'student' | 'page';
/** 표시: 채점 표시(○·／)를 그린다. 점수: 쪽 오른쪽 위에 합계/만점(표시를 넣을 때만). 미확인표시: 검토에서 확인하지 않은 장에도 그린다 */
export interface AnswerPdfOptions { 표시: boolean; 점수: boolean; 미확인표시: boolean; 묶음: AnswerPdfBundle; 순서: AnswerPdfOrder }
export const DEFAULT_ANSWER_PDF_OPTIONS: AnswerPdfOptions = { 표시: false, 점수: true, 미확인표시: false, 묶음: 'one', 순서: 'student' };

/** 렌더러가 보낸 선택을 검사해 고친 값으로. 모르는 값이면 기본값 */
export function answerPdfOptionsArg(raw: unknown): AnswerPdfOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ANSWER_PDF_OPTIONS;
  return {
    표시: o.표시 === true,
    점수: typeof o.점수 === 'boolean' ? o.점수 : d.점수,
    미확인표시: o.미확인표시 === true,
    묶음: o.묶음 === 'class' || o.묶음 === 'student' ? o.묶음 : 'one',
    순서: o.순서 === 'page' ? 'page' : 'student',
  };
}

/** 내보내기 창에 보일 안내. 미확인: 확인 완료가 아닌 장(전사가 없는 장 포함), 답칸: 답영역을 잡은 단위 수, 단위: 전체 단위 수 */
export interface AnswerPdfSummary { 장수: number; 미확인: number; 답칸: number; 단위: number }
export function answerPdfSummary(key: AnswerKey, transcripts: Transcript[], pages: number[]): AnswerPdfSummary {
  const byPage = new Map(transcripts.map(t => [t.page, t]));
  const units = [...key.정량, ...key.정성];
  return {
    장수: pages.length,
    미확인: pages.filter(p => byPage.get(p)?.확인완료 !== true).length,
    답칸: units.filter(u => key.답영역?.[u.id]).length,
    단위: units.length,
  };
}

/** 이 장에 표시·점수를 그리는지. 확인하지 않은 장은 AI 판정이 틀린 채 학생에게 가지 않게 기본으로 그리지 않는다 */
export const drawsMarks = (t: Transcript | null, o: Pick<AnswerPdfOptions, '표시' | '미확인표시'>): boolean =>
  o.표시 && t !== null && (t.확인완료 === true || o.미확인표시);

export type MarkKind = 'circle' | 'slash';
/** 그 장에서 단위마다 그릴 표시. 판정은 채점결과 엑셀과 같은 scoreOne의 값이다. 답영역이 없는 단위는 그리지 않는다 */
export function unitMarks(key: AnswerKey, t: Transcript): { 단위: string; 표시: MarkKind; 영역: MaskRect }[] {
  const sc = scoreOne(key, t);
  const out: { 단위: string; 표시: MarkKind; 영역: MaskRect }[] = [];
  for (const u of key.정량) {
    const r = key.답영역?.[u.id];
    if (r) out.push({ 단위: u.id, 표시: sc.판정[u.id] === 'O' ? 'circle' : 'slash', 영역: r });
  }
  for (const u of key.정성) {
    const r = key.답영역?.[u.id];
    if (r) out.push({ 단위: u.id, 표시: sc.응답[u.id] ? 'circle' : 'slash', 영역: r });
  }
  return out;
}

/**
 * 표시 크기(pt). 작은 답 칸은 칸을 살짝 감싸고, 큰 칸(문장형 등)은 상한까지만 키워 글씨를 다 덮지 않는다.
 * 200dpi A4 답안지의 한 줄 답 칸(높이 약 18pt)에서 눈으로 맞췄다
 */
export const MARK = {
  /**
   * 동그라미: 칸의 반폭·반높이에 곱할 값과 더할 여유, 반지름의 최소·최대.
   * flat: 가로 반지름이 세로의 이 배를 넘지 않게 한다. 넓은 칸(문장형)에서 납작한 타원이 문장 가운데 낱말만 두른 것처럼 보였다
   */
  circleScale: 1.08, circlePad: 3, rxMin: 9, rxMax: 34, ryMin: 9, ryMax: 24, flat: 1.5,
  /** 빗금: 반폭·반높이의 최소·최대. 반폭은 반높이의 slope배를 넘지 않게 해 너무 눕지 않게 한다 */
  slashHalfWMin: 6, slashHalfWMax: 20, slashHalfHMin: 10, slashHalfHMax: 24, slope: 0.7,
  /** 점수 글자 크기와 쪽 가장자리에서 떨어진 거리 */
  scoreSize: 20, scoreMargin: 26,
} as const;

/** 쪽 비율 영역(그림 위, 위가 0)을 PDF 좌표(pt, 아래가 0)로 */
export function regionBox(img: Box, r: MaskRect): Box {
  return { x: img.x + r.x * img.w, y: img.y + (1 - r.y - r.h) * img.h, w: r.w * img.w, h: r.h * img.h };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 답 칸(PDF 좌표) 가운데에 그릴 동그라미·빗금 */
export function markShape(kind: MarkKind, b: Box): Shape {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (kind === 'circle') {
    const rx = clamp(b.w / 2 * MARK.circleScale + MARK.circlePad, MARK.rxMin, MARK.rxMax);
    const ry = Math.min(MARK.ryMax, Math.max(clamp(b.h / 2 * MARK.circleScale + MARK.circlePad, MARK.ryMin, MARK.ryMax), rx / MARK.flat));
    return { kind: 'ellipse', cx, cy, rx, ry };
  }
  const hh = clamp(b.h / 2 + MARK.circlePad, MARK.slashHalfHMin, MARK.slashHalfHMax);
  const hw = Math.min(clamp(b.w / 2, MARK.slashHalfWMin, MARK.slashHalfWMax), hh * MARK.slope);
  return { kind: 'line', x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh }; // 왼쪽 아래에서 오른쪽 위로
}

/** 점수 글(합계/만점). 소수는 엑셀과 같은 값(roundScore)을 그대로 */
export const scoreText = (합계: number, 만점: number): string => `${합계}/${만점}`;

/** 쪽 오른쪽 위에 오른쪽 끝을 맞춘 점수 */
export function scoreShape(page: { w: number; h: number }, text: string): Shape {
  const size = MARK.scoreSize;
  return { kind: 'text', size, text, x: page.w - MARK.scoreMargin - textWidth(text, size), y: page.h - MARK.scoreMargin - size * 0.72 };
}

/** 한 장에 그릴 모든 것(그리지 않는 장이면 빈 목록) */
export function pageShapes(key: AnswerKey, t: Transcript | null, info: Pick<JpegInfo, 'width' | 'height'>, o: Pick<AnswerPdfOptions, '표시' | '점수' | '미확인표시'>): Shape[] {
  if (!t || !drawsMarks(t, o)) return [];
  const size = pageSizeFor(info), img = fitImage(size, info);
  const shapes = unitMarks(key, t).map(m => markShape(m.표시, regionBox(img, m.영역)));
  if (o.점수) shapes.push(scoreShape(size, scoreText(scoreOne(key, t).합계, fullScore(key))));
  return shapes;
}

/** 장 순서: 학년·반·번호순, 알아보지 못한 장(전사 없음 포함)은 뒤에 장 번호순 */
export function orderPages(pages: number[], byPage: Map<number, Transcript>, order: AnswerPdfOrder): number[] {
  const sorted = [...pages].sort((a, b) => a - b);
  if (order === 'page') return sorted;
  const known = (p: number) => { const t = byPage.get(p); return t && identified(t) ? t : null; };
  const ids = sorted.filter(p => known(p)).sort((a, b) => {
    const x = known(a)!, y = known(b)!;
    return x.학년! - y.학년! || x.반! - y.반! || x.번호! - y.번호! || a - b;
  });
  return [...ids, ...sorted.filter(p => !known(p))];
}

/** 폴더: 파일을 둔 폴더(묶음이 여럿이면 새로 만든 하위 폴더), 표시장수: 채점 표시·점수를 그린 장 */
export interface AnswerPdfResult { 폴더: string; 파일: string[]; 장수: number; 표시장수: number }

export interface PlannedFile { 이름: string; pages: number[] }
/** 폴더: 묶음이 여럿일 때 받을 폴더 안에 새로 만들 하위 폴더 이름(한 파일이면 없음) */
export interface AnswerPdfPlan { 폴더?: string; files: PlannedFile[] }

/** 반별·학생별 묶음의 조각 이름. 대상 학년과 다른 학년이면 학년도 붙인다 */
function classPart(key: AnswerKey, t: Transcript | null): string | null {
  if (!t || !identified(t)) return null;
  return t.학년 === key.대상.학년 ? `${t.반}반` : `${t.학년}학년${t.반}반`;
}
function studentPart(key: AnswerKey, t: Transcript | null, page: number): string {
  const c = classPart(key, t);
  if (!c || !t) return `미확인-${pageTag(page)}`;
  return `${c}${String(t.번호).padStart(2, '0')}번${t.이름 ? `_${t.이름.trim()}` : ''}`;
}

/** 어떤 파일에 어떤 장을 넣을지. 파일 이름은 이 안에서 겹치지 않게 번호를 붙인다(디스크에 이미 있는 이름은 main이 피한다) */
export function planAnswerPdf(key: AnswerKey, transcripts: Transcript[], pages: number[], o: AnswerPdfOptions, now: Date): AnswerPdfPlan {
  const byPage = new Map(transcripts.map(t => [t.page, t]));
  const ordered = orderPages(pages, byPage, o.순서);
  const marked = o.표시;
  if (o.묶음 === 'one') return { files: ordered.length ? [{ 이름: answerPdfFileName(key, now, marked), pages: ordered }] : [] };
  const used = new Set<string>();
  const name = (part: string) => { const n = uniqueName(answerPdfFileName(key, now, marked, part), x => used.has(x.toLowerCase())); used.add(n.toLowerCase()); return n; };
  const files: PlannedFile[] = [];
  if (o.묶음 === 'student') {
    for (const p of ordered) files.push({ 이름: name(studentPart(key, byPage.get(p) ?? null, p)), pages: [p] });
  } else {
    const groups = new Map<string, { 학년: number; 반: number; pages: number[] }>(); const unknown: number[] = [];
    for (const p of ordered) {
      const t = byPage.get(p) ?? null, c = classPart(key, t);
      if (c === null || !t) { unknown.push(p); continue; }
      const g = groups.get(c) ?? { 학년: t.학년!, 반: t.반!, pages: [] };
      g.pages.push(p); groups.set(c, g);
    }
    // 파일은 장 순서와 상관없이 학년·반순. 파일 안의 장은 고른 순서대로
    for (const [c, g] of [...groups].sort(([, a], [, b]) => a.학년 - b.학년 || a.반 - b.반)) files.push({ 이름: name(c), pages: g.pages });
    if (unknown.length) files.push({ 이름: name('반미확인'), pages: unknown });
  }
  return { 폴더: answerPdfFolderName(key, now, marked), files };
}
