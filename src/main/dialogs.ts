import type { Language, LeaveChoice } from '../shared/ipc.js';

/** '저장하지 않고 나가려는' 순간에 띄우는 운영체제 대화상자의 내용. 창의 X(닫기)는 cancelId라 '나가지 않기'와 같다. */
export function leaveDialogOptions(lang: Language): { type: 'question'; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number; noLink: true } {
  const ko = { message: '저장하지 않은 변경이 있습니다.', detail: '저장하고 나갈까요?', buttons: ['저장 후 나가기', '저장하지 않고 나가기', '나가지 않기'] };
  const en = { message: 'You have unsaved changes.', detail: 'Save before leaving?', buttons: ['Save and leave', 'Leave without saving', 'Stay'] };
  return { type: 'question', ...(lang === 'en' ? en : ko), defaultId: 0, cancelId: 2, noLink: true };
}

export const LEAVE_CHOICES: readonly LeaveChoice[] = ['save', 'discard', 'stay'];
export const leaveChoice = (buttonIndex: number): LeaveChoice => LEAVE_CHOICES[buttonIndex] ?? 'stay';
