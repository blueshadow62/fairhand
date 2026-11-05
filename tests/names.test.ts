import test from 'node:test';
import assert from 'node:assert/strict';
import { safeName, semesterTag, titleTag, classTag, dateTag, setFolderName, resultFileName, cumulativeFileName, keyExportName } from '../src/core/names.js';
import type { AnswerKey } from '../src/core/types.js';

const k: AnswerKey = { 세트: 's', 글: '알바생 자르기(장강명)', 학기: '2026 2학기', 대상: { 학년: 3, 반: [3, 1] }, 정량: [], 정성: [] };
const d = new Date(2026, 10, 5, 9, 0, 0); // 2026-11-05 (월은 0부터)

test('safeName: 금지 문자는 -, 앞뒤 공백·점 제거, 비면 세트', () => {
  assert.equal(safeName(' a/b:c*d?e"f<g>h|i. '), 'a-b-c-d-e-f-g-h-i');
  assert.equal(safeName('...'), '세트');
});

test('semesterTag·titleTag·classTag', () => {
  assert.equal(semesterTag('2026 2학기'), '2026-2학기');
  assert.equal(titleTag('알바생 자르기(장강명)'), '알바생자르기');
  assert.equal(titleTag('가나다라마바사아자차카타파하가나다라마바사아자차'), '가나다라마바사아자차카타파하가나다라마바');
  assert.equal(classTag([3, 1]), '1·3반');
});

test('dateTag: PC 시간대 기준 YYYY-MM-DD', () => {
  assert.equal(dateTag(d), '2026-11-05');
});

test('파일·폴더 이름 조립', () => {
  assert.equal(setFolderName(k), '2026-2학기_3학년_알바생자르기');
  assert.equal(resultFileName(k, d), '2026-2학기_3학년_1·3반_알바생자르기_채점결과_2026-11-05.xlsx');
  assert.equal(cumulativeFileName('2026 2학기', 3, d), '2026-2학기_3학년_누가기록_2026-11-05.xlsx');
  assert.equal(keyExportName(k), '2026-2학기_3학년_알바생자르기_정답표.json');
});
