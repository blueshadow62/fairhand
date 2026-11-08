import type { Profile } from '../../shared/ipc.js';

/**
 * AI 프로필 카드의 '고급'(실행 파일·설정 폴더)을 펼친 채로 시작할지.
 * 처음 쓰는 사람에게는 필요 없는 칸이라 접어 두지만, 직접 고른 경로가 있으면 무엇을 쓰고 있는지 보이게 펼친다
 */
export function advancedOpenAtStart(p: Pick<Profile, 'cliPath' | 'configDir'>): boolean {
  return Boolean(p.cliPath?.trim() || p.configDir?.trim());
}
