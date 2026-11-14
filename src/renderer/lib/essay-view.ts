import type { EssayTextPiece } from '../../core/rejudge.js';
import type { QtyUnit, Transcript } from '../../core/types.js';
import { el } from './el.js';
import { t } from './i18n.js';

/** 이 장의 그 논술형 문항 학생 글 전체. 논술형이 아니거나 글을 받기 전에 전사한 장이면 undefined */
export const essayTextOf = (tr: Transcript, u: Pick<QtyUnit, '유형' | '문항'>): string | undefined =>
  u.유형 === '논술형' ? tr.논술글?.[String(u.문항)] : undefined;

/** 글 조각 하나를 그릴 모양. cls가 비면 꾸미지 않은 글, tag가 있으면 그 표기 앞에 단위 id를 작게 */
export interface EssaySpanView { text: string; cls: string; title: string; tag?: string }

/**
 * 글 조각(essayTextMarks)을 화면 모양으로: 정답·허용 표기는 색(key-hit), AI가 단위의 답으로 옮긴 부분은 밑줄(found).
 * tags: 여러 단위를 한 글에 칠할 때(답안지별) 표기마다 어느 단위인지 작게 적는다. 화면 없이 검사하려고 DOM과 나눈다
 */
export function essaySpanViews(ps: EssayTextPiece[], tags: boolean): EssaySpanView[] {
  return ps.map(p => {
    const cls = [p.근거 ? `key-hit${p.근거 === '허용' ? ' allow' : ''}` : '', p.찾음 ? 'found' : ''].filter(Boolean).join(' ');
    const title = [p.근거 ? `${t(p.근거 === '허용' ? 'item.essay.markAllow' : 'item.essay.markKey')}${tags && p.단위 ? ` (${p.단위})` : ''}` : '',
      p.찾음 ? t('review.essay.found', { units: p.찾음.join(', ') }) : ''].filter(Boolean).join(' · ');
    return { text: p.text, cls, title, ...(tags && p.시작 && p.단위 ? { tag: p.단위 } : {}) };
  });
}

export const essayNodes = (vs: EssaySpanView[]): (string | HTMLElement)[] => vs.flatMap<string | HTMLElement>(v => (v.cls
  ? [...(v.tag ? [el('sup', { class: 'unit-tag' }, v.tag)] : []), el(v.cls.includes('key-hit') ? 'mark' : 'span', { class: v.cls, title: v.title }, v.text)]
  : [v.text]));
