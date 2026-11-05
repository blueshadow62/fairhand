import type { MenuItemConstructorOptions } from 'electron';
import type { Language } from '../shared/ipc.js';

/** 창 위 메뉴의 글. Electron 기본 메뉴는 영어라 한국어를 기본으로 두고 설정에서 바꾼다. */
export const MENU_TEXT: Record<Language, Record<string, string>> = {
  ko: { file: '파일', quit: '종료', edit: '편집', undo: '실행 취소', redo: '다시 실행', cut: '잘라내기', copy: '복사', paste: '붙여넣기', selectAll: '모두 선택',
    view: '보기', reload: '새로 고침', zoomIn: '확대', zoomOut: '축소', resetZoom: '원래 크기', fullscreen: '전체 화면', devtools: '개발자 도구',
    help: '도움말', guide: '사용 설명서', privacy: '개인정보 처리방침', about: '글눈 정보' },
  en: { file: 'File', quit: 'Exit', edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    view: 'View', reload: 'Reload', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetZoom: 'Actual Size', fullscreen: 'Full Screen', devtools: 'Developer Tools',
    help: 'Help', guide: 'User Guide', privacy: 'Privacy Policy', about: 'About Geulnun' },
};

export interface MenuActions { openGuide(): void; openPrivacy(): void; showAbout(): void }

export function menuTemplate(lang: Language, a: MenuActions): MenuItemConstructorOptions[] {
  const t = MENU_TEXT[lang]!;
  return [
    { label: t.file, submenu: [{ role: 'quit', label: t.quit }] },
    { label: t.edit, submenu: [
      { role: 'undo', label: t.undo }, { role: 'redo', label: t.redo }, { type: 'separator' },
      { role: 'cut', label: t.cut }, { role: 'copy', label: t.copy }, { role: 'paste', label: t.paste }, { role: 'selectAll', label: t.selectAll } ] },
    { label: t.view, submenu: [
      { role: 'reload', label: t.reload }, { type: 'separator' },
      { role: 'zoomIn', label: t.zoomIn }, { role: 'zoomOut', label: t.zoomOut }, { role: 'resetZoom', label: t.resetZoom }, { type: 'separator' },
      { role: 'togglefullscreen', label: t.fullscreen }, { role: 'toggleDevTools', label: t.devtools } ] },
    { label: t.help, submenu: [
      { label: t.guide, click: a.openGuide }, { label: t.privacy, click: a.openPrivacy }, { type: 'separator' }, { label: t.about, click: a.showAbout } ] },
  ];
}
