import type { AnswerKey } from '../../core/types.js';
import type { SetInfo } from '../../shared/ipc.js';

/** 시작 화면 현황판의 세트 한 칸이 쓰는 값(세트 목록 SetInfo의 일부) */
export type SetProgress = Pick<SetInfo, '쪽수' | '전사수' | '확인수' | '미전사수'> & { key: Pick<AnswerKey, '확인'> };

/** 세트 하나의 진행 단계. n/total은 그 단계의 수(정답표는 수가 없어 0) */
export interface Stage { id: 'key' | 'pages' | 'transcribe' | 'review'; done: boolean; n: number; total: number }

/** 정답표 확인 → 답안지 올리기 → 전사 → 검토 확인 차례. 전사는 그림이 있는 장 기준, 검토 확인은 전사 파일 기준(검토 화면의 '확인 n/m'과 같다) */
export function stages(s: SetProgress): Stage[] {
  return [
    { id: 'key', done: s.key.확인?.완료 === true, n: 0, total: 0 },
    { id: 'pages', done: s.쪽수 > 0, n: s.쪽수, total: s.쪽수 },
    { id: 'transcribe', done: s.쪽수 > 0 && s.미전사수 === 0, n: Math.max(0, s.쪽수 - s.미전사수), total: s.쪽수 },
    { id: 'review', done: s.전사수 > 0 && s.확인수 >= s.전사수, n: s.확인수, total: s.전사수 },
  ];
}

/** 현황판의 단추 하나로 갈 다음 할 일 */
export type NextStep = 'key' | 'upload' | 'transcribe' | 'review' | 'excel';
const STEP: Record<Stage['id'], NextStep> = { key: 'key', pages: 'upload', transcribe: 'transcribe', review: 'review' };

/** 끝나지 않은 첫 단계의 일. 모두 끝났으면 엑셀을 연다 */
export function nextStep(s: SetProgress): NextStep {
  const first = stages(s).find(x => !x.done);
  return first ? STEP[first.id] : 'excel';
}
