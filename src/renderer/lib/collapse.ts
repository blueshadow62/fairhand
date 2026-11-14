import { el } from './el.js';

/** 접은 상태 기억(localStorage). 못 읽으면 펼친 것으로 본다 */
export const readCollapsed = (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
export const writeCollapsed = (key: string, on: boolean): void => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* 이번 실행에서만 */ } };

export interface CollapseOpts {
  /** 접었을 때 cls를 붙일 요소(목록을 감싼 격자) */
  target: HTMLElement; cls: string;
  /** 기억할 localStorage 키 */
  pref: string;
  label: string; collapse: string; expand: string;
  /** 목록을 다시 그려도 키보드 초점이 이 단추로 돌아오게(문항별 검토의 data-focus) */
  focusKey?: string;
}

/**
 * 목록을 접는 단추. 펼쳤을 때는 목록 맨 위 제목 줄('장 목록 «'), 접으면 좁은 띠('»'와 세로 제목)로 남아 같은 자리에서 다시 펼친다.
 * 좁은 창에서 그림 칸을 넓히려는 것이라 기본은 펼침이고, 접은 상태는 다음 실행에도 기억한다
 */
export function collapseToggle(o: CollapseOpts): HTMLButtonElement {
  const chev = el('span', { class: 'chev', 'aria-hidden': 'true' });
  const btn = el('button', { class: 'list-toggle', 'data-focus': o.focusKey, onclick: () => { const on = !o.target.classList.contains(o.cls); show(on); writeCollapsed(o.pref, on); } },
    el('span', { class: 'label' }, o.label), chev);
  function show(on: boolean): void {
    o.target.classList.toggle(o.cls, on);
    chev.textContent = on ? '»' : '«';
    btn.title = on ? o.expand : o.collapse;
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-expanded', String(!on));
  }
  show(readCollapsed(o.pref));
  return btn;
}
