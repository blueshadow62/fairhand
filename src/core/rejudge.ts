import type { AnswerKey, Case, Panjeong, QtyUnit, Transcript } from './types.js';

/** 글자 비교용 정규화. 뜻은 보지 않는다: NFC, 앞뒤 공백, 연속 공백 하나, 끝 문장부호 제거 */
export const normalizeAnswer = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().replace(/[.,!?。]+$/u, '').trim();

export function findCase(key: AnswerKey, 단위: string, 답: string): Case | undefined {
  const n = normalizeAnswer(답);
  return key.사례?.find(c => c.단위 === 단위 && normalizeAnswer(c.답) === n);
}

export interface Change { 단위: string; 이전: Panjeong; 이후: Panjeong; 근거: '사례' | '정답' | '허용' | '빈칸' | '모델' }

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

/** 글자로 결정되는 판정(빈칸·사례·정답·허용). 뜻으로 볼 일이면 null */
export function decide(key: AnswerKey, 단위: string, 답: string): { 판정: Panjeong; 근거: Change['근거'] } | null {
  const u = key.정량.find(x => x.id === 단위);
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
  for (const u of key.정량) {
    const v = 정량[u.id];
    if (!v) continue;
    const d = decide(key, u.id, v.답);
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
