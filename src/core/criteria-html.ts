import type { CriteriaBlock, CriteriaDoc } from './criteria.js';

/** HTML 글·속성에 넣을 글. 학생이 쓴 답(사례)도 들어가므로 모든 글을 이것으로만 넣는다 */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 칸 안의 줄바꿈은 <br>로(글은 이스케이프한 뒤에 나눈다) */
const lines = (s: string): string => s.split('\n').map(escapeHtml).join('<br>');

function block(b: CriteriaBlock): string {
  if (b.kind === 'heading') return `<h2>${escapeHtml(b.text)}</h2>`;
  if (b.kind === 'note') return `<p class="note">${lines(b.text)}</p>`;
  if (b.kind === 'list') return `<ul>${b.items.map(i => `<li>${lines(i)}</li>`).join('')}</ul>`;
  const col = b.columns.map(c => `<col width="${(c.width * 100).toFixed(2)}%">`).join('');
  const head = b.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = b.rows.map(r => `<tr>${r.map((v, i) => `<td class="${b.columns[i]?.align === 'center' ? 'c' : 'l'}">${lines(v)}</td>`).join('')}</tr>`).join('');
  return `<table><colgroup>${col}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * 인쇄용 HTML. 꾸밈은 cssHref의 바깥 CSS 하나에 둔다: 숨은 창의 CSP(style-src 'self')가 style 요소와 style 속성을 막는다.
 * 그래서 칸 너비는 표마다 다른 값이라도 style 속성 대신 col의 width 속성(CSP와 무관한 표시 속성)으로 준다
 */
export function criteriaHtml(doc: CriteriaDoc, cssHref: string): string {
  const head = doc.머리.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  return `<!doctype html>
<html lang="${doc.lang}"><head><meta charset="utf-8"><title>${escapeHtml(doc.제목)}</title>
<link rel="stylesheet" href="${escapeHtml(cssHref)}"></head>
<body><h1>${escapeHtml(doc.제목)}</h1><dl class="meta">${head}</dl>
${doc.blocks.map(block).join('\n')}
<p class="made">${escapeHtml(doc.끝)}</p></body></html>
`;
}
