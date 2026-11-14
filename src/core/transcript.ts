import { DataError, studentKey, pageTag, type AnswerKey, type Transcript } from './types.js';

const PANJEONG = new Set(['O', 'X', '빈칸']);
const HWAKSIN = new Set(['확실', '추정', '불명']);

export function parseTranscript(text: string, where: string): Transcript {
  let t: Record<string, any>;
  try { t = JSON.parse(text); } catch (e) { throw new DataError(`${where}: JSON 오류 ${(e as Error).message}`); }
  // 1.5·-1·NaN이면 p1.5.json처럼 저장돼 다음 로드에서 조용히 사라진다
  if (!Number.isInteger(t?.page) || t.page < 1) throw new DataError(`${where}: page가 없거나 1 이상 정수가 아닙니다 (${String(t?.page)})`);
  // 옛 양식: 이름확신 → 식별확신
  if (t.식별확신 === undefined && t.이름확신 !== undefined) t.식별확신 = t.이름확신;
  delete t.이름확신;
  if (!HWAKSIN.has(t.식별확신)) throw new DataError(`${where}: 식별확신 값이 잘못됨 (${t.식별확신})`);
  for (const f of ['학년', '반', '번호']) {
    if (t[f] === undefined) t[f] = null;
    else if (t[f] !== null && typeof t[f] !== 'number') throw new DataError(`${where}: ${f}은 숫자여야 함 (${t[f]})`);
  }
  if (t.이름 === undefined) t.이름 = null;
  else if (t.이름 !== null && typeof t.이름 !== 'string') throw new DataError(`${where}: 이름은 글자여야 함`);
  t.정량 ??= {}; t.정성 ??= {};
  if (!Array.isArray(t.비고)) throw new DataError(`${where}: 비고는 목록이어야 함`);
  if (t.확인완료 !== undefined && typeof t.확인완료 !== 'boolean') throw new DataError(`${where}: 확인완료는 true/false여야 함`);
  // 정답표에서 빠진 단위 id가 남아 있어도 읽는다(정답표를 고친 뒤에도 옛 전사가 열리게)
  if (t.확인단위 !== undefined && !(Array.isArray(t.확인단위) && t.확인단위.every((x: unknown) => typeof x === 'string'))) throw new DataError(`${where}: 확인단위는 글자 목록이어야 함`);
  // 논술형 글 전체는 화면에만 쓰는 칸이라 모양이 틀린 항목은 오류 대신 버린다(손으로 고친 파일 하나가 세트를 막지 않게)
  if (t.논술글 !== undefined) {
    const ok = t.논술글 && typeof t.논술글 === 'object' && !Array.isArray(t.논술글) ? Object.entries(t.논술글).filter(([, v]) => typeof v === 'string') : [];
    if (ok.length) t.논술글 = Object.fromEntries(ok); else delete t.논술글;
  }
  // 답 위치도 화면에만 쓴다. 0~1의 수가 아니면(모델이 null·퍼센트로 준 것 포함) 그 단위의 위치를 모르는 것으로 둔다. 전사를 실패로 보지 않는다
  for (const v of Object.values(t.정량)) {
    if (v && typeof v === 'object' && '위치' in v && !(typeof v.위치 === 'number' && v.위치 >= 0 && v.위치 <= 1)) delete v.위치;
  }
  return t as Transcript;
}

export const identified = (t: Transcript): boolean =>
  t.식별확신 !== '불명' && t.학년 !== null && t.반 !== null && t.번호 !== null;

export function validateTranscripts(key: AnswerKey, ts: Transcript[]): void {
  const qty = new Set(key.정량.map(u => u.id));
  const qual = new Set(key.정성.map(u => u.id));
  for (const t of ts) {
    const where = pageTag(t.page);
    for (const [uid, v] of Object.entries(t.정량)) {
      if (!qty.has(uid)) throw new DataError(`${where}: 정답표에 없는 단위 ${uid}`);
      if (typeof v?.답 !== 'string') throw new DataError(`${where}: ${uid}의 답은 글자여야 함 (${JSON.stringify(v?.답)})`);
      if (!PANJEONG.has(v?.판정)) throw new DataError(`${where}: ${uid}의 판정 값이 잘못됨 (${v?.판정})`);
    }
    for (const [uid, v] of Object.entries(t.정성)) {
      if (!qual.has(uid)) throw new DataError(`${where}: 정답표에 없는 단위 ${uid}`);
      // 문자열 "false"가 참으로 세어져 1점이 되는 것을 막는다
      if (typeof v?.응답 !== 'boolean') throw new DataError(`${where}: ${uid}의 응답 값이 true/false가 아님 (${JSON.stringify(v?.응답)})`);
      if (typeof v?.답 !== 'string') throw new DataError(`${where}: ${uid}의 답은 글자여야 함`);
    }
  }
}

/** 대상 반 안에서 같은 (학년·반·번호)가 두 장 이상인 것. 학생 키 → 쪽 번호(오름차순) */
export function findDuplicates(key: AnswerKey, ts: Transcript[]): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  for (const t of ts) {
    if (!identified(t)) continue;
    if (t.학년 !== key.대상.학년 || !key.대상.반.includes(t.반!)) continue;
    const k = studentKey(t.학년!, t.반!, t.번호!);
    seen.set(k, [...(seen.get(k) ?? []), t.page].sort((a, b) => a - b));
  }
  return new Map([...seen].filter(([, pages]) => pages.length > 1));
}
