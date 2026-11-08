import type { Rotation } from '../../shared/ipc.js';

/** 채점 실행의 답안지 장을 다루는 판단(화면 없이 검사한다) */

/** 파일 고르기 창이 보이는 답안지 파일. 끌어다 놓은 파일은 sheetKind로 같은 기준을 본다 */
export const SHEET_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.bmp';

/** 답안지로 받는 파일인지: PDF(여러 쪽) 또는 사진(한 쪽). 이름(확장자)이나 형식 둘 중 하나로 알아본다 */
export function sheetKind(name: string, type: string): 'pdf' | 'image' | null {
  if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'pdf';
  if (/^image\//.test(type) || /\.(jpe?g|png|webp|bmp)$/i.test(name)) return 'image';
  return null;
}

/** 파일 이름 자연 순서: 스캐너 파일명 001, 002, 010…과 2, 10을 숫자로 견주고 대소문자는 가리지 않는다 */
export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** 고른 목록에 같은 파일(같은 지문)이 있는지. 있으면 열지 않고 건너뛴다(같은 쪽이 두 번 저장되지 않게) */
export const hasFile = (list: readonly { 지문: string }[], 지문: string): boolean => list.some(x => x.지문 === 지문);

/**
 * 고른 목록에 파일 하나를 더한 새 목록. 여러 번 나눠 고르거나 끌어다 놓아도 목록 전체를 파일 이름 자연 순서로 두어,
 * 목록 차례대로 쪽이 저장된다. 이름이 같으면 먼저 고른 파일이 앞이다(정렬이 안정적이다)
 */
export const withFile = <T extends { 이름: string }>(list: readonly T[], item: T): T[] => [...list, item].sort((a, b) => naturalCompare(a.이름, b.이름));

/**
 * 목록의 파일마다 저장할 때 받을 장 번호(next부터 목록 차례로 이어서). 저장하지 않는 파일(체크하지 않은 이미 올린 파일)은 null이고
 * 번호를 건너뛴다. 칩의 순번·장 범위와 미리보기 격자의 장 번호가 같은 차례를 보이게 한다
 */
export function saveRanges(files: readonly { 포함: boolean; 쪽수: number }[], next: number): ({ 순번: number; 처음: number; 끝: number } | null)[] {
  let order = 0, at = next;
  return files.map(f => {
    if (!f.포함) return null;
    const r = { 순번: ++order, 처음: at, 끝: at + f.쪽수 - 1 };
    at += f.쪽수;
    return r;
  });
}

/** 쪽마다 돌리기 단추: 시계 방향으로 90°씩, 270° 다음은 0° */
export const nextRotation = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;

/** 이번 전사가 새로 저장한 장을 모두 맡는지. 장을 정하지 않은 전사(전사 시작)는 모든 장을 맡는다 */
export const coversSaved = (saved: number[], runPages: number[] | undefined): boolean => !runPages || saved.every(p => runPages.includes(p));

/** 아직 전사하지 않은 장. '전사 시작'은 이미 전사한 장을 건너뛰므로 이것이 전사할 장이다 */
export function pendingPages(pages: number[], transcripts: { page: number }[]): number[] {
  const done = new Set(transcripts.map(t => t.page));
  return pages.filter(p => !done.has(p));
}
