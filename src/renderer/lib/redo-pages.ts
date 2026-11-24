import type { Transcript } from '../../core/types.js';

/** '다시 전사할 장' 칸을 푼 결과. 문제(bad·unknown·missing)가 하나라도 있으면 실행하지 않는다 */
export interface RedoPick {
  /** 다시 전사할 장(오름차순, 중복 없음) */
  pages: number[];
  /** 이름으로 찾은 장. 같은 이름이 여러 장이면 모두 넣고, 확인 창에 장 번호와 함께 보인다 */
  byName: { 이름: string; pages: number[] }[];
  /** 장 번호 꼴인데 틀린 낱말(거꾸로 된 범위 5-3, 1-2-3 등) */
  bad: string[];
  /** 맞는 장이 없는 이름 */
  unknown: string[];
  /** 세트에 없는 장 번호 */
  missing: number[];
}

// 장 번호는 작은 그림 아래의 p 번호. 'p39'·'P39'·'39'·'1-3'·'p1-p3' 모두 받는다
const PAGE = /^p?\s*(\d+)(?:\s*-\s*p?\s*(\d+))?$/i;
// 숫자가 든, 숫자·p·붙임표·공백만으로 된 낱말은 장 번호로 쓰려던 것으로 본다(이름으로 찾지 않는다)
const PAGE_LIKE = /^[\dp\s-]*\d[\dp\s-]*$/i;

/**
 * "1-3, p7, 홍길동" → 장 1·2·3·7과 이름이 '홍길동'인 장.
 * 숫자-숫자는 parsePageSpec과 같이 장 번호 범위다. 반-번호(3-12)는 범위와 가를 수 없어 받지 않는다.
 * 이름은 전사의 이름과 앞뒤 공백을 빼고 같아야 한다(세트에 있는 장의 전사만 본다)
 */
export function resolveRedoPages(spec: string, pages: readonly number[], transcripts: readonly Pick<Transcript, 'page' | '이름'>[]): RedoPick {
  const have = new Set(pages);
  const out = new Set<number>(), missing = new Set<number>();
  const bad: string[] = [], unknown: string[] = [];
  const byName = new Map<string, number[]>();
  for (const word of spec.split(/[,，]/).map(s => s.trim()).filter(Boolean)) {
    if (PAGE_LIKE.test(word)) {
      const m = PAGE.exec(word);
      const a = Number(m?.[1]), b = Number(m?.[2] ?? m?.[1]);
      if (!m || b < a) { bad.push(word); continue; }
      for (let p = a; p <= b; p++) (have.has(p) ? out : missing).add(p);
      continue;
    }
    if (byName.has(word)) continue;
    const hits = transcripts.filter(t => have.has(t.page) && (t.이름 ?? '').trim() === word).map(t => t.page).sort((x, y) => x - y);
    if (!hits.length) { if (!unknown.includes(word)) unknown.push(word); continue; }
    byName.set(word, hits);
    hits.forEach(p => out.add(p));
  }
  const asc = (x: number, y: number) => x - y;
  return { pages: [...out].sort(asc), byName: [...byName].map(([이름, ps]) => ({ 이름, pages: ps })), bad, unknown, missing: [...missing].sort(asc) };
}
