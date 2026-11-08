import type { Profile } from '../../shared/ipc.js';

/**
 * AI 프로필 카드의 '고급'(실행 파일·설정 폴더)을 펼친 채로 시작할지.
 * 처음 쓰는 사람에게는 필요 없는 칸이라 접어 두지만, 직접 고른 경로가 있으면 무엇을 쓰고 있는지 보이게 펼친다
 */
export function advancedOpenAtStart(p: Pick<Profile, 'cliPath' | 'configDir'>): boolean {
  return Boolean(p.cliPath?.trim() || p.configDir?.trim());
}

/** 설정 화면의 탭. 처음 실행은 basic(학기 폴더), 왼쪽 아래 AI 표시는 ai, 맨 위 업데이트 알림은 about으로 연다 */
export const SETTINGS_TABS = ['basic', 'ai', 'about'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
/** 탭 이름은 window 사건(CustomEvent)의 detail로 오가 형이 보장되지 않으므로 검사한다 */
export const isSettingsTab = (v: unknown): v is SettingsTab => (SETTINGS_TABS as readonly unknown[]).includes(v);

export interface SerialSaver {
  /** 저장을 청한다. 도는 저장이 없으면 바로, 있으면 그것이 끝난 뒤 한 번 더 돈다. 돌려받는 약속은 이 청을 담은 저장의 결과 */
  run(): Promise<void>;
  /** 돌거나 밀린 저장이 다 끝날 때까지(실패해도) 기다린다 */
  idle(): Promise<void>;
}

/**
 * 바로 저장하는 화면의 저장을 한 번에 하나씩 돌린다. 저장마다 설정 파일을 통째로 다시 쓰므로 둘이 겹치면
 * 먼저 시작한 옛 사본이 나중에 끝나 새 값을 덮거나, 같은 임시 파일을 두고 부딪칠 수 있다.
 * 도는 동안 여러 번 청하면 끝난 뒤 한 번만 더 돈다. 그때 save가 최신 상태를 읽으므로 그 사이 바뀐 것이 다 들어간다
 */
export function serialSaver(save: () => Promise<void>): SerialSaver {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    const p = Promise.resolve().then(save).finally(() => { running = null; });
    running = p;
    return p;
  };
  return {
    run(): Promise<void> {
      if (queued) return queued; // 아직 시작하지 않았으니 시작할 때 이 청의 변경까지 읽는다
      if (!running) return start();
      queued = running.catch(() => undefined).then(() => { queued = null; return start(); });
      return queued;
    },
    async idle(): Promise<void> {
      for (let p = queued ?? running; p; p = queued ?? running) await p.catch(() => undefined);
    },
  };
}
