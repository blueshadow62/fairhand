import test from 'node:test';
import assert from 'node:assert/strict';
import { cliReady, guideVisible, keyReady } from '../src/renderer/lib/first-run.js';

test('guideVisible: 처음 실행(학기 폴더 없음)에 보이고, 연 뒤에는 학기 폴더가 생겨도 닫기 전까지 보인다', () => {
  assert.equal(guideVisible(null, false), true);   // 처음 실행
  assert.equal(guideVisible('open', true), true);   // 학기 폴더를 정한 뒤 남은 단계
  assert.equal(guideVisible('open', false), true);
  assert.equal(guideVisible('closed', false), false); // 건너뛰기를 누르면 학기 폴더가 없어도 다시 나오지 않는다
  assert.equal(guideVisible('closed', true), false);
  assert.equal(guideVisible(null, true), false);    // 학기 폴더를 이미 쓰던 사람(새 판으로 올림)
});

test('cliReady·keyReady: 설치·최소 버전·로그인을 모두 갖춘 구독, 이 PC에서 풀리는 키만 준비됨', () => {
  assert.equal(cliReady({ installed: true, version: '2.1.300', loggedIn: true }), true);
  assert.equal(cliReady({ installed: true, version: '2.1.300', loggedIn: false }), false);
  assert.equal(cliReady({ installed: true }), false); // 로그인 여부를 모름
  assert.equal(cliReady({ installed: true, tooOld: true, loggedIn: true }), false);
  assert.equal(cliReady({ installed: false }), false);
  assert.equal(keyReady({ 저장됨: true, 끝4자: 'abcd', 열림: true }), true);
  assert.equal(keyReady({ 저장됨: true, 끝4자: 'abcd' }), true);
  assert.equal(keyReady({ 저장됨: true, 끝4자: 'abcd', 열림: false }), false); // 다른 PC에서 봉인한 키
  assert.equal(keyReady({ 저장됨: false }), false);
});
