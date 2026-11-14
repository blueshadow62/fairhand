import type { MenuItemConstructorOptions } from 'electron';

/**
 * 창 위 기본 메뉴(File·Edit…)는 쓰지 않는다. 설정·언어·정보는 프로그램 안 '설정' 화면에 있고, Windows는 메뉴 없이도 복사·붙여넣기를 처리한다.
 * 맥은 ⌘C·⌘V·⌘Z·⌘Q가 메뉴 항목에 달려 있어 메뉴가 없으면 입력란에서 복사·붙여넣기조차 안 되므로 앱·편집·창 메뉴만 둔다.
 */
export function menuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  return platform === 'darwin' ? [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }] : null;
}
