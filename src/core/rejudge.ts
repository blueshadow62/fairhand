import type { AnswerKey, Case, Panjeong, QtyUnit, Transcript } from './types.js';

/** 글자 비교용 정규화. 뜻은 보지 않는다: NFC, 앞뒤 공백, 연속 공백 하나, 끝 문장부호 제거 */
export const normalizeAnswer = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().replace(/[.,!?。]+$/u, '').trim();

/**
 * 사례가 지금 판정에 쓰이는지. 자리 기준 사례(묶음 없음)의 O('이 칸의 정답으로 인정')는 묶음에서도 맞고 X('이 칸의 정답이 아님')는 묶음의 다른 정답일 수 있다.
 * 묶음 사례의 X('어느 정답도 아님')는 자리 기준에서도 맞고 O('어느 정답으로 인정')는 이 칸의 정답이라는 뜻이 아니다. 그래서
 * 단위가 지금 순서 무관이면 묶음 사례는 모두, 자리 기준 사례는 O만 쓰고, 아니면 자리 기준 사례는 모두, 묶음 사례는 X만 쓴다.
 * 쓰지 않는 사례도 파일에 두어, 순서 무관을 다시 바꾸면 되살아난다
 */
export function caseActive(key: Pick<AnswerKey, '정량'>, c: Pick<Case, '단위' | '판정' | '묶음'>): boolean {
  const orderFree = key.정량.some(u => u.id === c.단위 && u.순서무관 === true);
  return orderFree ? c.묶음 === true || c.판정 === 'O' : c.묶음 !== true || c.판정 === 'X';
}

/** 파일에 적힌 사례(같은 단위·같은 정규화 답). 판정에 쓰이는지와 상관없다: 같은 답의 새 사례가 바꿔 쓸 것·되돌릴 것을 찾는 데 쓴다 */
export function caseRecord(key: Pick<AnswerKey, '사례'>, 단위: string, 답: string): Case | undefined {
  const n = normalizeAnswer(답);
  return key.사례?.find(c => c.단위 === 단위 && normalizeAnswer(c.답) === n);
}

/** 판정에 쓸 사례(같은 단위·같은 정규화 답, caseActive인 것) */
export function findCase(key: AnswerKey, 단위: string, 답: string): Case | undefined {
  const n = normalizeAnswer(답);
  return key.사례?.find(c => c.단위 === 단위 && normalizeAnswer(c.답) === n && caseActive(key, c));
}

/** 새로 기록하는 사례에 그 단위가 지금 순서 무관이면 묶음 표시를 붙인다(아니면 떼어 자리 기준 사례로) */
export function stampCase(key: Pick<AnswerKey, '정량'>, c: Case): Case {
  const { 묶음: _, ...rest } = c;
  return key.정량.some(u => u.id === c.단위 && u.순서무관 === true) ? { ...rest, 묶음: true } : rest;
}

/** 근거 '중복': 순서 무관 묶음에서 다른 칸이 이미 쓴 정답과만 맞는 칸(같은 정답을 두 번 쓴 것) */
export interface Change { 단위: string; 이전: Panjeong; 이후: Panjeong; 근거: '사례' | '정답' | '허용' | '빈칸' | '모델' | '중복' }
export type Decision = { 판정: Panjeong; 근거: Change['근거'] };

/** 이 단위가 든 순서 무관 묶음: 같은 문항의 순서무관 단위들(정답표 순서). 순서무관 단위가 아니면 빈 목록 */
export function orderFreeGroup(key: Pick<AnswerKey, '정량'>, 단위: string): QtyUnit[] {
  const u = key.정량.find(x => x.id === 단위);
  return u?.순서무관 === true ? key.정량.filter(x => x.순서무관 === true && x.문항 === u.문항) : [];
}

/** 사례·경고가 볼 단위 id: 순서 무관 묶음이면 묶음 전체, 아니면 그 단위 하나 */
export function caseUnits(key: Pick<AnswerKey, '정량'>, 단위: string): string[] {
  const g = orderFreeGroup(key, 단위);
  return g.length ? g.map(u => u.id) : [단위];
}

/**
 * 판정에 쓸 사례. 순서 무관 묶음에서는 '같은 답은 같게'가 칸을 가리지 않아 묶음의 어느 단위에 기록된 사례든 본다.
 * 같은 답의 사례가 여러 단위에 있으면 가장 나중에 기록한 것(addCase는 뒤에 붙인다). 묶음 밖 단위는 findCase 그대로
 */
export function findCaseFor(key: AnswerKey, 단위: string, 답: string): Case | undefined {
  const g = orderFreeGroup(key, 단위);
  if (!g.length) return findCase(key, 단위, 답);
  const ids = new Set(g.map(u => u.id)), n = normalizeAnswer(답);
  return (key.사례 ?? []).filter(c => ids.has(c.단위) && normalizeAnswer(c.답) === n && caseActive(key, c)).pop();
}

/**
 * 답이 정답표의 정답·허용과 글자로 맞는지(사례는 보지 않는다). 빈 답은 맞지 않는다.
 * 논술형 답은 학생 글에서 그 요소를 찾아 옮긴 부분이라, 정답 문장·용어(허용 표기)가 그 안에 그대로 들어 있으면 맞는다
 */
export function keyMatch(u: QtyUnit, 답: string): '정답' | '허용' | null {
  const n = normalizeAnswer(답);
  if (!n) return null;
  if (u.유형 === '논술형') {
    if (n.includes(normalizeAnswer(u.정답))) return '정답';
    if (u.허용?.some(a => normalizeAnswer(a) && n.includes(normalizeAnswer(a)))) return '허용';
    return null;
  }
  if (normalizeAnswer(u.정답) === n) return '정답';
  if (u.허용?.some(a => normalizeAnswer(a) === n)) return '허용';
  return null;
}

/** 답 글의 한 조각. 근거가 있으면 정답(또는 허용) 표기가 그대로 들어 있는 곳 */
export interface EssayPiece { text: string; 근거?: '정답' | '허용' }

/**
 * 글 전체의 한 조각. 근거·단위: 그 단위의 정답(허용) 표기가 그대로 있는 곳(시작은 그 표기의 첫 조각),
 * 찾음: AI가 그 단위들의 답으로 옮긴 부분이 덮는 곳
 */
export interface EssayTextPiece { text: string; 근거?: '정답' | '허용'; 단위?: string; 시작?: boolean; 찾음?: string[] }

/** 줄바꿈·여러 칸 띄어쓰기를 한 칸으로 줄인 글(flat)과, 그 글자마다 원래 글의 위치(at) */
function flatten(s: string): { flat: string; at: number[] } {
  let flat = '';
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (!/\s/.test(s[i]!)) { flat += s[i]; at.push(i); }
    else if (flat && !flat.endsWith(' ')) { flat += ' '; at.push(i); }
  }
  return { flat, at };
}

/** flat에서 needle(정규화한 글)이 나오는 곳을 원래 글의 [start, end)로. 찾은 곳끼리는 겹치지 않게 넘어간다 */
function spansOf(f: { flat: string; at: number[] }, needle: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (!needle) return out;
  for (let i = f.flat.indexOf(needle); i >= 0; i = f.flat.indexOf(needle, i + needle.length)) out.push({ start: f.at[i]!, end: f.at[i + needle.length - 1]! + 1 });
  return out;
}

/**
 * 논술형 글(학생 글 전체나 단위의 답)을 단위들의 정답·허용 표기가 그대로 들어 있는 곳, AI가 단위의 답으로 옮긴 부분(답들), 나머지로 나눈다.
 * keyMatch와 같은 기준이라 줄바꿈이나 여러 칸 띄어쓰기는 한 칸으로 보고 찾는다. 조각을 이으면 NFC로 맞춘 글 그대로다.
 * 표기가 겹치면 앞 단위, 한 단위 안에서는 정답을 먼저 둔다. 답은 글에서 처음 나오는 곳 하나만 칠한다(못 찾으면 칠하지 않는다)
 */
export function essayTextMarks(units: QtyUnit[], 글: string, 답들: Record<string, string> = {}): EssayTextPiece[] {
  const s = 글.normalize('NFC');
  if (!s) return [];
  const f = flatten(s);
  const hits: { start: number; end: number; 근거: '정답' | '허용'; 단위: string }[] = [];
  const found: { start: number; end: number; 단위: string }[] = [];
  for (const u of units.filter(x => x.유형 === '논술형')) {
    const add = (needle: string, 근거: '정답' | '허용') => {
      for (const r of spansOf(f, needle)) if (!hits.some(h => r.start < h.end && h.start < r.end)) hits.push({ ...r, 근거, 단위: u.id });
    };
    add(normalizeAnswer(u.정답), '정답');
    for (const a of u.허용 ?? []) add(normalizeAnswer(a), '허용');
    const first = spansOf(f, normalizeAnswer(답들[u.id] ?? ''))[0];
    if (first) found.push({ ...first, 단위: u.id });
  }
  const cuts = [...new Set([0, s.length, ...[...hits, ...found].flatMap(x => [x.start, x.end])])].sort((a, b) => a - b);
  const out: (EssayTextPiece & { hit: number; sig: string })[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!, b = cuts[i + 1]!;
    const hit = hits.findIndex(h => h.start <= a && b <= h.end), h = hits[hit];
    const 찾음 = found.filter(x => x.start <= a && b <= x.end).map(x => x.단위);
    const sig = 찾음.join('\u0000');
    const last = out[out.length - 1];
    // 같은 표시가 이어지면 한 조각으로(표시 없는 글이 경계마다 잘리지 않게). 따로 찾은 표기는 붙어 있어도 나눈다
    if (last && last.hit === hit && last.sig === sig) { last.text += s.slice(a, b); continue; }
    out.push({ text: s.slice(a, b), hit, sig, ...(h ? { 근거: h.근거, 단위: h.단위, ...(h.start === a ? { 시작: true } : {}) } : {}), ...(찾음.length ? { 찾음 } : {}) });
  }
  return out.map(({ hit: _h, sig: _s, ...p }) => p);
}

/**
 * 논술형 답(AI가 글에서 찾아 옮긴 부분)을 정답·허용 표기가 그대로 들어 있는 곳과 나머지로 나눈다(essayTextMarks와 같은 기준).
 * 조각을 이으면 NFC로 맞춘 답 그대로다. 논술형이 아니면 나누지 않는다
 */
export function essayMarks(u: QtyUnit, 답: string): EssayPiece[] {
  if (u.유형 !== '논술형') return 답 ? [{ text: 답 }] : [];
  return essayTextMarks([u], 답).map(p => (p.근거 ? { text: p.text, 근거: p.근거 } : { text: p.text }));
}

/**
 * 순서 무관 묶음 하나의 글자 판정(한 장). 빈 칸은 빈칸, 묶음의 사례와 같은 답은 사례대로. 나머지 칸은 정답·허용과 글자로 맞는지 보되
 * 묶음의 정답 하나는 한 칸에만 쓴다: 가장 많은 칸이 맞게 짝짓고(묶음이 작아 전수 탐색), 같으면 앞 칸이 먼저 짝을 얻는다.
 * 다른 칸이 이미 쓴 정답과만 맞는 칸은 X(중복). 어느 정답과도 글자로 맞지 않는 칸은 뜻으로 볼 일이라 null
 */
function decideGroup(key: AnswerKey, group: QtyUnit[], 답들: Readonly<Record<string, string>>): Record<string, Decision | null> {
  const out: Record<string, Decision | null> = {};
  const open: { id: string; 답: string; 맞는자리: number[] }[] = [];
  for (const u of group) {
    const 답 = 답들[u.id] ?? '';
    if (!normalizeAnswer(답)) { out[u.id] = { 판정: '빈칸', 근거: '빈칸' }; continue; }
    const c = findCaseFor(key, u.id, 답);
    if (c) { out[u.id] = { 판정: c.판정, 근거: '사례' }; continue; }
    open.push({ id: u.id, 답, 맞는자리: group.flatMap((g, j) => (keyMatch(g, 답) ? [j] : [])) });
  }
  // 칸 차례로 맞는 자리(정답표 순서)를 먼저, 짝 없음을 나중에 해 보므로 처음 찾은 최대 짝짓기가 앞 칸을 먼저 맞힌 것이다
  let best: (number | null)[] = open.map(() => null), bestN = 0;
  const cur: (number | null)[] = [], used = new Set<number>();
  const search = (k: number, n: number): void => {
    if (n + (open.length - k) <= bestN) return; // 남은 칸을 다 맞혀도 지금 최대를 넘지 못한다
    if (k === open.length) { bestN = n; best = [...cur]; return; }
    for (const j of open[k]!.맞는자리) if (!used.has(j)) { used.add(j); cur[k] = j; search(k + 1, n + 1); used.delete(j); }
    cur[k] = null; search(k + 1, n);
  };
  search(0, 0);
  open.forEach((c, k) => {
    const j = best[k];
    out[c.id] = j !== null && j !== undefined ? { 판정: 'O', 근거: keyMatch(group[j]!, c.답)! } : c.맞는자리.length ? { 판정: 'X', 근거: '중복' } : null;
  });
  return out;
}

/**
 * 한 장의 글자 판정. 답들: 단위 id → 그 칸에 쓴 글(있는 단위만 본다). 순서 무관 묶음은 묶음째(decideGroup), 나머지 단위는 decide와 같다.
 * 뜻으로 볼 일이면 null
 */
export function decidePage(key: AnswerKey, 답들: Readonly<Record<string, string>>): Record<string, Decision | null> {
  const out: Record<string, Decision | null> = {};
  const done = new Set<number>();
  for (const u of key.정량) {
    if (!(u.id in 답들)) continue;
    if (u.순서무관 !== true) { out[u.id] = decideUnit(key, u, u.id, 답들[u.id]!); continue; }
    if (done.has(u.문항)) continue;
    done.add(u.문항);
    const g = decideGroup(key, orderFreeGroup(key, u.id), 답들);
    for (const [id, d] of Object.entries(g)) if (id in 답들) out[id] = d;
  }
  return out;
}

/** 한 장의 단위별 답 글(decidePage·decide에 넘긴다) */
export const pageAnswers = (t: Pick<Transcript, '정량'>): Record<string, string> =>
  Object.fromEntries(Object.entries(t.정량).map(([id, v]) => [id, v.답]));

/**
 * 글자로 결정되는 판정(빈칸·사례·정답·허용). 뜻으로 볼 일이면 null.
 * 순서 무관 단위는 같은 장의 다른 칸을 함께 봐야 정해지므로 답들(그 장의 단위별 답, pageAnswers)을 넘긴다. 단위 자신의 답은 답이 앞선다
 */
export function decide(key: AnswerKey, 단위: string, 답: string, 답들: Readonly<Record<string, string>> = {}): Decision | null {
  const u = key.정량.find(x => x.id === 단위);
  if (u?.순서무관 === true) return decideGroup(key, orderFreeGroup(key, 단위), { ...답들, [단위]: 답 })[단위] ?? null;
  return decideUnit(key, u, 단위, 답);
}

/** 묶음 밖 단위 하나의 글자 판정(순서 무관을 두기 전의 decide 그대로) */
function decideUnit(key: AnswerKey, u: QtyUnit | undefined, 단위: string, 답: string): Decision | null {
  // 논술형의 빈 답은 '글은 썼는데 없음(X)'과 '쓴 글 없음(빈칸)'을 모델만 가를 수 있어 그대로 둔다
  if (!normalizeAnswer(답)) return u?.유형 === '논술형' ? null : { 판정: '빈칸', 근거: '빈칸' };
  const c = findCase(key, 단위, 답);
  if (c) return { 판정: c.판정, 근거: '사례' };
  const m = u ? keyMatch(u, 답) : null;
  return m ? { 판정: 'O', 근거: m } : null; // 뜻으로 판단할 일은 건드리지 않는다
}

export function rejudgeTranscript(key: AnswerKey, t: Transcript, tag = '재판정'): { transcript: Transcript; changes: Change[] } {
  const changes: Change[] = [];
  const 정량 = { ...t.정량 };
  const ds = decidePage(key, pageAnswers(t));
  for (const u of key.정량) {
    const v = 정량[u.id];
    if (!v) continue;
    const d = ds[u.id] ?? null;
    if (d && d.판정 !== v.판정) { changes.push({ 단위: u.id, 이전: v.판정, 이후: d.판정, 근거: d.근거 }); 정량[u.id] = { ...v, 판정: d.판정 }; }
  }
  if (!changes.length) return { transcript: t, changes };
  const line = `${tag}: ${changes.map(c => `${c.단위} ${c.이전}→${c.이후} (${c.근거})`).join(', ')}`;
  const 비고 = [...t.비고.filter(b => !b.startsWith(`${tag}:`)), line];
  return { transcript: { ...t, 정량, 비고 }, changes };
}

export function rejudgeAll(key: AnswerKey, ts: Transcript[]): { transcripts: Transcript[]; changed: { page: number; changes: Change[] }[] } {
  const changed: { page: number; changes: Change[] }[] = [];
  const transcripts = ts.map(t => { const r = rejudgeTranscript(key, t); if (r.changes.length) changed.push({ page: t.page, changes: r.changes }); return r.transcript; });
  return { transcripts, changed };
}

export function pagesWithSameAnswer(ts: Transcript[], 단위: string, 답: string, exceptPage?: number): number[] {
  const n = normalizeAnswer(답);
  if (!n) return [];
  return ts.filter(t => t.page !== exceptPage && normalizeAnswer(t.정량[단위]?.답 ?? '') === n).map(t => t.page);
}

export function addCase(key: AnswerKey, c: Case): AnswerKey {
  const n = normalizeAnswer(c.답);
  const rest = (key.사례 ?? []).filter(x => !(x.단위 === c.단위 && normalizeAnswer(x.답) === n));
  return { ...key, 사례: [...rest, { ...c, 답: c.답.trim() }] };
}

/**
 * 정답표를 저장할 때의 사례 목록. 파일에 있는 사례가 기준이다: 문항 설정 화면은 세트를 열 때 읽은 목록을 들고 있어
 * 그사이 검토에서 쌓인 사례를 모른다. 화면이 보낸 사례 중 파일에 없는 답(같은 단위·같은 정규화 답)만 더하고(정답표 가져오기),
 * 양쪽에 있으면 파일을 따른다. 정답표에서 사라진 단위의 사례는 버린다. 사례를 지우는 길은 removeCase 하나다
 */
export function mergeCases(file: Case[] | undefined, sent: Case[] | undefined, key: Pick<AnswerKey, '정량'>): Case[] {
  const units = new Set(key.정량.map(u => u.id));
  const seen = new Set<string>(), out: Case[] = [];
  for (const c of [...(file ?? []), ...(sent ?? [])]) {
    const k = `${c.단위}\u0000${normalizeAnswer(c.답)}`;
    if (!units.has(c.단위) || seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}

export function removeCase(key: AnswerKey, 단위: string, 답: string): AnswerKey {
  const n = normalizeAnswer(답);
  return { ...key, 사례: (key.사례 ?? []).filter(x => !(x.단위 === 단위 && normalizeAnswer(x.답) === n)) };
}
