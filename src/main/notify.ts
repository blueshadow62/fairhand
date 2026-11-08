import { DataError } from '../core/types.js';

/**
 * Windows 알림은 앱 사용자 모델 ID(AUMID)가 있어야 뜨고, 그 ID의 시작 메뉴 바로 가기 이름으로 보인다.
 * 설치판 바로 가기는 package.json의 build.appId로 만들어지므로 같은 값을 쓴다(tests/main-notify가 둘을 견준다)
 */
export const APP_USER_MODEL_ID = 'kr.geulnun.app';

const TITLE_MAX = 80, BODY_MAX = 240;

/** 렌더러가 보낸 알림 글. 글자만 받고, 제목은 한 줄로, 운영체제 알림에 맞게 길이를 줄인다. 제목이 비면 띄울 수 없다 */
export function notifyArgs(title: unknown, body: unknown): { title: string; body: string } {
  if (typeof title !== 'string' || typeof body !== 'string') throw new DataError('알림 글이 잘못되었습니다');
  const t = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!t) throw new DataError('알림 제목이 비었습니다');
  return { title: t, body: body.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, BODY_MAX) };
}
