import { scoreOne } from '../core/score.js';
import type { AnswerKey, Transcript } from '../core/types.js';

export interface EvalSummary {
  장수: number; 비교장수: number; 식별정확: number;
  판정일치: number; 판정총수: number; 응답일치: number; 응답총수: number;
  합계차이: Record<string, number>;
  장별: { page: number; 식별: boolean; 판정불일치: string[]; 응답불일치: string[]; 합계차: number }[];
}

/** 기준(선생님 확인본)과 엔진 결과를 page로 짝지어 비교한다. 학생 답 원문은 담지 않는다. */
export function evaluate(key: AnswerKey, reference: Transcript[], got: Transcript[]): EvalSummary {
  const byPage = new Map(got.map(t => [t.page, t]));
  const s: EvalSummary = { 장수: reference.length, 비교장수: 0, 식별정확: 0, 판정일치: 0, 판정총수: 0, 응답일치: 0, 응답총수: 0, 합계차이: {}, 장별: [] };
  for (const r of reference) {
    const g = byPage.get(r.page);
    if (!g) continue;
    s.비교장수++;
    const 식별 = r.학년 === g.학년 && r.반 === g.반 && r.번호 === g.번호;
    if (식별) s.식별정확++;
    const sr = scoreOne(key, r), sg = scoreOne(key, g);
    const 판정불일치 = key.정량.map(u => u.id).filter(id => sr.판정[id] !== sg.판정[id]);
    const 응답불일치 = key.정성.map(u => u.id).filter(id => sr.응답[id] !== sg.응답[id]);
    s.판정총수 += key.정량.length; s.판정일치 += key.정량.length - 판정불일치.length;
    s.응답총수 += key.정성.length; s.응답일치 += key.정성.length - 응답불일치.length;
    const d = sg.합계 - sr.합계;
    s.합계차이[String(d)] = (s.합계차이[String(d)] ?? 0) + 1;
    s.장별.push({ page: r.page, 식별, 판정불일치, 응답불일치, 합계차: d });
  }
  return s;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');

export function formatSummary(s: EvalSummary): string {
  const lines = [
    `비교 ${s.비교장수}/${s.장수}장`,
    `식별 정확 ${s.식별정확}/${s.비교장수} (${pct(s.식별정확, s.비교장수)})`,
    `판정 일치 ${s.판정일치}/${s.판정총수} (${pct(s.판정일치, s.판정총수)})`,
    `응답 일치 ${s.응답일치}/${s.응답총수} (${pct(s.응답일치, s.응답총수)})`,
    `합계 차이: ${Object.entries(s.합계차이).sort(([a], [b]) => Number(a) - Number(b)).map(([d, n]) => `${d}:${n}장`).join(', ')}`,
    ...s.장별.filter(p => !p.식별 || p.판정불일치.length || p.응답불일치.length)
      .map(p => `  p${String(p.page).padStart(2, '0')}: ${p.식별 ? '' : '식별 틀림 '}${p.판정불일치.length ? `판정 ${p.판정불일치.join(',')} ` : ''}${p.응답불일치.length ? `응답 ${p.응답불일치.join(',')} ` : ''}합계차 ${p.합계차}`),
  ];
  return lines.join('\n');
}
