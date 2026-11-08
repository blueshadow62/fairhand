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

/** 쪽마다 돌리기 단추: 시계 방향으로 90°씩, 270° 다음은 0° */
export const nextRotation = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;

/** 이번 전사가 새로 저장한 장을 모두 맡는지. 장을 정하지 않은 전사(전사 시작)는 모든 장을 맡는다 */
export const coversSaved = (saved: number[], runPages: number[] | undefined): boolean => !runPages || saved.every(p => runPages.includes(p));

/** 아직 전사하지 않은 장. '전사 시작'은 이미 전사한 장을 건너뛰므로 이것이 전사할 장이다 */
export function pendingPages(pages: number[], transcripts: { page: number }[]): number[] {
  const done = new Set(transcripts.map(t => t.page));
  return pages.filter(p => !done.has(p));
}
