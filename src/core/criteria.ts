import { fullScore, gradingRules, unitPoints } from './key.js';
import { dateTag } from './names.js';
import { caseActive } from './rejudge.js';
import type { AnswerKey, Case, GradingRules, QtyUnit, UnitType } from './types.js';

/**
 * '채점 기준 안내문'의 순수 로직: 저장된 정답표에서 사람이 읽을 문서 내용(제목·머리 정보·표·풀이)을 만든다.
 * PDF(criteria-html.ts → main의 printToPDF)와 HWPX(criteria-hwpx.ts)가 이 내용 하나를 그려 두 형식의 내용이 같다
 */

export type CriteriaFormat = 'pdf' | 'hwpx';
/**
 * 정답: 정답·허용·핵심어를 넣는다. 끄면 문항·유형·설명·배점만(시험 전에 학생에게 안내하는 쓰임).
 * 사례: 판정 사례 표. 사례의 답이 정답을 드러내므로 정답을 끄면 넣지 않는다
 */
export interface CriteriaOptions { 형식: CriteriaFormat; 정답: boolean; 규칙: boolean; 사례: boolean }
export const DEFAULT_CRITERIA_OPTIONS: CriteriaOptions = { 형식: 'pdf', 정답: true, 규칙: true, 사례: true };

/** 렌더러가 보낸 선택을 검사해 고친 값으로. 모르는 값이면 기본값. 정답을 끄면 사례도 끈다 */
export function criteriaOptionsArg(raw: unknown): CriteriaOptions {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CRITERIA_OPTIONS;
  const 정답 = typeof o.정답 === 'boolean' ? o.정답 : d.정답;
  return {
    형식: o.형식 === 'hwpx' ? 'hwpx' : 'pdf',
    정답,
    규칙: typeof o.규칙 === 'boolean' ? o.규칙 : d.규칙,
    사례: 정답 && (typeof o.사례 === 'boolean' ? o.사례 : d.사례),
  };
}

/** 지금 판정에 쓰이는 사례(caseActive)를 정답표의 단위 순서로. 같은 단위 안에서는 기록한 차례 */
export function activeCases(key: AnswerKey): Case[] {
  const order = new Map(key.정량.map((u, i) => [u.id, i]));
  return (key.사례 ?? []).filter(c => order.has(c.단위) && caseActive(key, c))
    .map((c, i) => ({ c, i })).sort((a, b) => order.get(a.c.단위)! - order.get(b.c.단위)! || a.i - b.i).map(x => x.c);
}

export type CriteriaLang = 'ko' | 'en';
export type CriteriaAlign = 'left' | 'center';
export interface CriteriaColumn { label: string; /** 표 너비에 대한 비율(합 1) */ width: number; align: CriteriaAlign }
/** 칸의 글. 줄바꿈(\n)은 칸 안의 줄 */
export type CriteriaBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'table'; columns: CriteriaColumn[]; rows: string[][] }
  | { kind: 'note'; text: string }
  | { kind: 'list'; items: string[] };
export interface CriteriaDoc { lang: CriteriaLang; 제목: string; 머리: [string, string][]; blocks: CriteriaBlock[]; 끝: string }

interface Labels {
  title: string; semester: string; target: string; full: string; targetValue(학년: number, 반: string): string; points(n: number): string;
  qtyHeading: string; qualHeading: string; rulesHeading: string; casesHeading: string;
  q: string; type: string; desc: string; answer: string; allow: string; keywords: string; pts: string; caseAnswer: string; verdict: string;
  types: Record<UnitType | '응답형', string>; quote: string; term: string; orderFree: string;
  orderFreeNote: string; qualNote: string; noQty: string; noCases: string; casesNote: string;
  rules(r: GradingRules): string[];
  made(d: string): string;
}

const KO: Labels = {
  title: '채점 기준 안내', semester: '학기', target: '대상', full: '만점',
  targetValue: (학년, 반) => `${학년}학년 ${반}반`, points: n => `${n}점`,
  qtyHeading: '문항별 채점 기준', qualHeading: '응답형 문항', rulesHeading: '채점 규칙', casesHeading: '판정 사례',
  q: '문항', type: '유형', desc: '설명', answer: '정답', allow: '허용 답', keywords: '핵심어', pts: '배점', caseAnswer: '답', verdict: '판정',
  types: { 빈칸형: '빈칸형', 단답형: '단답형', 문장형: '문장형', 요소형: '요소형', 논술형: '논술형', 응답형: '응답형' },
  quote: '인용', term: '용어', orderFree: '순서 무관',
  orderFreeNote: "'순서 무관' 표시가 있는 칸: 같은 문항의 순서 무관 칸은 어느 칸에 어떤 순서로 써도 인정하고, 같은 정답은 한 번만 인정합니다.",
  qualNote: '응답형 문항은 내용과 관계없이 답을 쓰면 배점을 인정합니다.',
  noQty: '정답을 견주어 채점하는 문항이 없습니다.',
  noCases: '지금 판정에 쓰는 사례가 없습니다.',
  casesNote: '선생님이 검토에서 정한 판정입니다. 같은 문항에 같은 답을 쓰면 이 판정을 그대로 적용합니다.',
  rules: r => [
    r.맞춤법 === '인정' ? '맞춤법이 다르지만 뜻이 같은 답은 맞게(O) 봅니다.' : '맞춤법이 다른 답은 뜻이 같아도 틀리게(X) 봅니다.',
    r.넓은말 === '인정' ? '정답보다 넓은 말로 쓴 답은 맞게(O) 봅니다.' : '정답보다 넓은 말로 쓴 답은 틀리게(X) 봅니다.',
    r.핵심어 === '모두' ? '핵심어가 여럿인 문장형 문항은 핵심어가 모두 있어야 맞습니다.' : '핵심어가 여럿인 문장형 문항은 핵심어가 하나라도 있으면 맞습니다.',
  ],
  made: d => `만든 날: ${d} · 글눈으로 만듦`,
};

const EN: Labels = {
  title: 'Grading criteria', semester: 'Term', target: 'Class', full: 'Full score',
  targetValue: (학년, 반) => `Grade ${학년}, class ${반}`, points: n => `${n} pt`,
  qtyHeading: 'Criteria by item', qualHeading: 'Response items', rulesHeading: 'Grading rules', casesHeading: 'Precedents',
  q: 'Q', type: 'Type', desc: 'Description', answer: 'Key', allow: 'Also accept', keywords: 'Keywords', pts: 'Points', caseAnswer: 'Answer', verdict: 'Verdict',
  types: { 빈칸형: 'Blank', 단답형: 'Short', 문장형: 'Sentence', 요소형: 'Elements', 논술형: 'Essay', 응답형: 'Response' },
  quote: 'quote', term: 'term', orderFree: 'any order',
  orderFreeNote: "Boxes marked 'any order': the any-order boxes of one item accept the answers in any box and in any order. Each key answer counts only once.",
  qualNote: 'A response item gets its points when the student writes an answer, whatever the content.',
  noQty: 'No item is graded against a key.',
  noCases: 'No precedent is used for grading now.',
  casesNote: 'Verdicts that the teacher set in review. The same answer to the same item gets the same verdict.',
  rules: r => [
    r.맞춤법 === '인정' ? 'An answer with the same meaning but a different spelling is correct (O).' : 'An answer with a different spelling is wrong (X), even if the meaning is the same.',
    r.넓은말 === '인정' ? 'An answer that uses a broader word than the key is correct (O).' : 'An answer that uses a broader word than the key is wrong (X).',
    r.핵심어 === '모두' ? 'A sentence item with several keywords is correct only when all keywords are in the answer.' : 'A sentence item with several keywords is correct when one or more keywords are in the answer.',
  ],
  made: d => `Made on ${d} · Made with Geulnun`,
};

/** 유형이 없는 옛 정답표는 문항 설정 화면과 같게 본다: 핵심 있음→문장형, 같은 문항에 단위 둘 이상→빈칸형, 하나→단답형 */
function typeOf(key: AnswerKey, u: QtyUnit): UnitType {
  if (u.유형) return u.유형;
  if (u.핵심?.length) return '문장형';
  return key.정량.filter(x => x.문항 === u.문항).length > 1 ? '빈칸형' : '단답형';
}

const qText = (n: number | undefined): string => (Number.isInteger(n) ? String(n) : '');
/** 칸 안의 글: 제어 문자(줄바꿈 말고)는 빈칸으로. 표 칸을 깨거나 XML에 못 넣는 글자를 없앤다 */
const clean = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');

/** 표 칸의 너비 비율(합 1). 글이 긴 칸(설명·정답·허용)에 더 준다 */
function columns(defs: [string, number, CriteriaAlign][]): CriteriaColumn[] {
  const sum = defs.reduce((s, d) => s + d[1], 0);
  return defs.map(([label, w, align]) => ({ label, width: w / sum, align }));
}

export function buildCriteria(key: AnswerKey, o: Pick<CriteriaOptions, '정답' | '규칙' | '사례'>, lang: CriteriaLang, now: Date): CriteriaDoc {
  const L = lang === 'en' ? EN : KO;
  const blocks: CriteriaBlock[] = [];
  const 반 = [...key.대상.반].sort((a, b) => a - b).join('·');
  const 머리: [string, string][] = [[L.semester, clean(key.학기)], [L.target, L.targetValue(key.대상.학년, 반)], [L.full, L.points(fullScore(key))]];

  blocks.push({ kind: 'heading', text: L.qtyHeading });
  if (!key.정량.length) blocks.push({ kind: 'note', text: L.noQty });
  else {
    const typeCell = (u: QtyUnit): string => {
      const t = typeOf(key, u);
      const kind = t === '논술형' && u.종류 ? ` (${u.종류 === '인용' ? L.quote : L.term})` : '';
      return `${L.types[t]}${kind}${u.순서무관 ? `\n${L.orderFree}` : ''}`;
    };
    const cols = o.정답
      ? columns([[L.q, 6, 'center'], [L.type, 11, 'center'], [L.desc, 24, 'left'], [L.answer, 22, 'left'], [L.allow, 16, 'left'], [L.keywords, 11, 'left'], [L.pts, 10, 'center']])
      : columns([[L.q, 8, 'center'], [L.type, 16, 'center'], [L.desc, 64, 'left'], [L.pts, 12, 'center']]);
    const rows = key.정량.map(u => o.정답
      ? [qText(u.문항), typeCell(u), clean(u.설명), clean(u.정답), clean((u.허용 ?? []).join(', ')), clean((u.핵심 ?? []).join(', ')), String(unitPoints(u))]
      : [qText(u.문항), typeCell(u), clean(u.설명), String(unitPoints(u))]);
    blocks.push({ kind: 'table', columns: cols, rows });
    if (key.정량.some(u => u.순서무관 === true)) blocks.push({ kind: 'note', text: L.orderFreeNote });
  }

  if (key.정성.length) {
    blocks.push({ kind: 'heading', text: L.qualHeading });
    blocks.push({ kind: 'table', columns: columns([[L.q, 8, 'center'], [L.type, 16, 'center'], [L.desc, 64, 'left'], [L.pts, 12, 'center']]),
      rows: key.정성.map(u => [qText(u.문항), L.types.응답형, clean(u.설명), String(unitPoints(u))]) });
    blocks.push({ kind: 'note', text: L.qualNote });
  }

  if (o.규칙) blocks.push({ kind: 'heading', text: L.rulesHeading }, { kind: 'list', items: L.rules(gradingRules(key)) });

  // 출처(검토 p07)와 일시는 넣지 않는다: 장 번호로 어느 학생의 답인지 알 수 있다
  if (o.정답 && o.사례) {
    const cs = activeCases(key);
    blocks.push({ kind: 'heading', text: L.casesHeading });
    if (!cs.length) blocks.push({ kind: 'note', text: L.noCases });
    else {
      const byId = new Map(key.정량.map(u => [u.id, u]));
      blocks.push({ kind: 'table', columns: columns([[L.q, 8, 'center'], [L.desc, 34, 'left'], [L.caseAnswer, 46, 'left'], [L.verdict, 12, 'center']]),
        rows: cs.map(c => { const u = byId.get(c.단위)!; return [qText(u.문항), clean(u.설명), clean(c.답), c.판정]; }) });
      blocks.push({ kind: 'note', text: L.casesNote });
    }
  }

  return { lang, 제목: clean(`${key.글} ${L.title}`.trim()), 머리, blocks, 끝: L.made(dateTag(now)) };
}

/** 문서의 모든 글을 순서대로(검사·미리 보기 글용) */
export function criteriaText(doc: CriteriaDoc): string {
  const out = [doc.제목, ...doc.머리.map(([k, v]) => `${k}: ${v}`)];
  for (const b of doc.blocks) {
    if (b.kind === 'table') out.push(b.columns.map(c => c.label).join('\t'), ...b.rows.map(r => r.join('\t')));
    else if (b.kind === 'list') out.push(...b.items);
    else out.push(b.text);
  }
  out.push(doc.끝);
  return out.join('\n');
}
