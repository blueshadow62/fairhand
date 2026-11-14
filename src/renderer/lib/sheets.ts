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

/** 이름 자연 순서로 정렬한 새 목록('이름 순으로 정렬' 단추). 정렬이 안정적이라 이름이 같으면 원래 차례를 지킨다 */
export const sortByName = <T extends { 이름: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => naturalCompare(a.이름, b.이름));

/**
 * 새로 고른 파일 묶음을 그 안에서만 이름 순으로 정렬해 목록 맨 뒤에 붙인다. 목록 전체를 다시 정렬하면
 * 손으로 바꾼 순서가 더할 때마다 풀렸다. 목록 차례대로 쪽이 저장된다
 */
export const appendFiles = <T extends { 이름: string }>(list: readonly T[], add: readonly T[]): T[] => [...list, ...sortByName(add)];

/**
 * from번째 항목을 before번째 항목 앞으로 옮긴 새 목록(before가 목록 길이면 맨 뒤). 끌어 놓기와 Alt+←·→가 같이 쓴다.
 * 제자리(before가 from이나 from+1)거나 범위 밖이면 같은 차례의 새 목록
 */
export function moveBefore<T>(list: readonly T[], from: number, before: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || before < 0 || before > out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(before > from ? before - 1 : before, 0, item!);
  return out;
}

/** 놓을 자리를 가르는 칩 사각형(화면 좌표). DOMRect를 그대로 넘긴다 */
export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * 끄는 점(x, y)에서 놓을 자리. 칩이 여러 줄로 감기므로 같은 줄(세로로 걸치는) 칩 가운데 가로로 가장 가까운 칩을 찾아,
 * 그 칩의 가운데보다 왼쪽이면 그 앞(before = 그 칩), 오른쪽이면 그 뒤(before = 다음 칩)에 놓는다.
 * 줄 사이 틈(칩 간격 10px)은 위아래 줄이 반씩 맡는다. 어느 줄에도 걸치지 않으면 null
 */
export function dropSlot(boxes: readonly Box[], x: number, y: number): { before: number; chip: number; after: boolean } | null {
  const HALF_GAP = 5;
  let best = -1, dist = Infinity;
  boxes.forEach((b, i) => {
    if (y < b.top - HALF_GAP || y > b.bottom + HALF_GAP) return;
    const d = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
    if (d < dist) { dist = d; best = i; }
  });
  if (best < 0) return null;
  const b = boxes[best]!;
  const after = x >= (b.left + b.right) / 2;
  return { before: after ? best + 1 : best, chip: best, after };
}

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
