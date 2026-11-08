import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_USER_MODEL_ID, notifyArgs } from '../src/main/notify.js';
import { DataError } from '../src/core/types.js';

const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf-8');

test('앱 사용자 모델 ID는 설치판 바로 가기의 appId와 같고, Windows에서 시작할 때 정한다', () => {
  assert.equal(APP_USER_MODEL_ID, JSON.parse(read('package.json')).build.appId);
  // 없으면 Windows가 알림을 띄우지 않는다. 맥·리눅스에는 없는 개념이다
  assert.match(read('src/main/index.ts'), /if \(process\.platform === 'win32'\) app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
});

test('notifyArgs: 글자만 받고, 제목은 한 줄로, 길면 줄이고, 빈 제목은 거절', () => {
  assert.deepEqual(notifyArgs('  전사를 마쳤습니다:\n세트 ', ' 성공 3장 · 실패 0장\n다음 줄 '), { title: '전사를 마쳤습니다: 세트', body: '성공 3장 · 실패 0장\n다음 줄' });
  assert.equal(notifyArgs('가'.repeat(200), '').title.length, 80);
  assert.equal(notifyArgs('제목', '나'.repeat(500)).body.length, 240);
  assert.equal(notifyArgs('제목', 'a\u0007b').body, 'a b'); // 제어 문자는 공백으로
  for (const [t, b] of [[1, 'x'], ['x', null], [undefined, undefined], ['  ', 'x']] as const)
    assert.throws(() => notifyArgs(t, b), DataError, JSON.stringify([t, b]));
});
