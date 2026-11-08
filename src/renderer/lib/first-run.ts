import type { CliStatusView, SecretView } from '../../shared/ipc.js';

/**
 * 처음 실행 안내를 보일지. pref는 localStorage에 적어 둔 값: 'open'(처음 실행에서 보이기 시작함), 'closed'(건너뛰기·닫기를 누름).
 * 적은 값이 없으면 학기 폴더가 없을 때(처음 실행)만 보인다. 그래서 학기 폴더를 이미 쓰던 사람에게는 나오지 않고,
 * 처음 실행에서 보이기 시작했으면 학기 폴더를 정한 뒤에도 닫기 전까지 남은 단계를 보인다
 */
export function guideVisible(pref: string | null, hasSemester: boolean): boolean {
  return pref === 'open' || (pref !== 'closed' && !hasSemester);
}

/** 구독 프로필(Claude Code·Codex)을 바로 쓸 수 있는지: 설치됐고 최소 버전 이상이며 로그인했다. 로그인 여부를 모르면 아니다(상태 글도 '로그인 필요') */
export const cliReady = (s: CliStatusView): boolean => s.installed && s.tooOld !== true && s.loggedIn === true;

/** API 키 프로필을 바로 쓸 수 있는지: 저장한 키를 이 PC에서 풀 수 있다 */
export const keyReady = (v: SecretView): boolean => v.저장됨 && v.열림 !== false;
