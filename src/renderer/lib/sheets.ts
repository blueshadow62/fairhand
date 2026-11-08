import type { Rotation } from '../../shared/ipc.js';

/** 채점 실행의 답안지 장을 다루는 판단(화면 없이 검사한다) */

/** 쪽마다 돌리기 단추: 시계 방향으로 90°씩, 270° 다음은 0° */
export const nextRotation = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;

/** 아직 전사하지 않은 장. '전사 시작'은 이미 전사한 장을 건너뛰므로 이것이 전사할 장이다 */
export function pendingPages(pages: number[], transcripts: { page: number }[]): number[] {
  const done = new Set(transcripts.map(t => t.page));
  return pages.filter(p => !done.has(p));
}
