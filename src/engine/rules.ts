import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { essayQuestions, gradingRules } from '../core/key.js';
import { DataError, type AnswerKey } from '../core/types.js';

export interface Rules { 버전: string; 본문: string }

const RULES_DIR = new URL('../../../resources/rules/', import.meta.url); // dist/src/engine/ → 저장소 루트/resources/rules/

export async function loadRules(version = 'transcribe-v1'): Promise<Rules> {
  if (!/^[a-z0-9-]+$/.test(version)) throw new DataError(`규칙 버전 이름이 잘못됨: ${version}`);
  try {
    return { 버전: version, 본문: (await readFile(fileURLToPath(new URL(`${version}.md`, RULES_DIR)), 'utf-8')).replace(/\r\n/g, '\n') }; // autocrlf로 받아도 프롬프트가 같게
  } catch {
    throw new DataError(`전사 규칙 파일이 없습니다: ${version}`);
  }
}

const CASE_LIMIT = 200;

function rulesSection(key: AnswerKey): string[] {
  const r = gradingRules(key);
  return ['# 채점 규칙(이 세트)',
    `- 맞춤법이 다른 같은 뜻의 답: ${r.맞춤법 === '인정' ? '인정한다(O)' : '인정하지 않는다(X)'}`,
    `- 정답보다 넓거나 일반적인 말: ${r.넓은말 === '인정' ? '인정한다(O)' : '인정하지 않는다(X)'}`,
    `- 문장형의 핵심어: ${r.핵심어 === '모두' ? '모두 뜻으로 들어 있어야 O' : '하나라도 뜻으로 들어 있으면 O'}`,
    '이 절이 전사 규칙의 판정 기준과 다르면 이 절을 따른다.', ''];
}

/**
 * 논술형 문항이 있는 세트에만 붙인다(없는 세트의 지시문은 그대로라 잰 정확도가 유지된다).
 * 임용시험처럼 한 편의 글에서 정해진 문장을 거의 그대로 인용했는지, 정해진 용어를 썼는지 요소마다 본다.
 * 글 전체(essays)도 받는다: 검토 화면이 글 속 어디에서 찾았는지 보이려면 단위의 답이 그 글에서 글자 그대로 옮긴 것이어야 한다
 */
function essaySection(key: AnswerKey): string[] {
  if (!key.정량.some(u => u.유형 === '논술형')) return [];
  const full = essayQuestions(key).length > 0; // 양식에 essays가 있을 때만(문항 번호가 없는 손으로 만든 정답표는 0.2.11 절 그대로)
  return ['# 논술형 문항',
    '- 정답표 단위에 `유형: "논술형"`이 있는 문항은 학생이 한 편의 글로 답한다. 이 문항에는 전사 규칙의 빈칸형·요소형 옮기기 규칙을 쓰지 않는다. 그 문항의 단위마다 학생 글 전체에서 그 요소를 찾는다. 쓴 위치와 순서는 상관없다.',
    ...(full ? ['- `essays`에는 논술형 문항마다 항목 하나 `{question, text}`를 한 번씩 넣는다. question은 그 문항 번호(정답표의 `문항`)이고, text에는 학생이 그 문항에 쓴 글을 처음부터 끝까지 빠짐없이 쓴 그대로 옮긴다. 맞춤법을 고치지 않고, 문단이 바뀌는 곳은 줄바꿈으로 둔다. 지운 글·끼워 쓴 글·잘린 글자·못 읽은 글자는 전사 규칙의 표기를 따른다. 쓴 글이 없으면 빈 문자열.'] : []),
    '- `종류: "인용"` 단위: `정답` 문장을 학생이 거의 그대로 옮겨 썼으면 "O". 띄어쓰기·문장부호 차이는 상관없고 맞춤법 차이는 채점 규칙의 맞춤법 항목을 따른다. 뜻만 같게 바꿔 쓰거나 일부만 쓴 것은 "X".',
    '- `종류: "용어"` 단위: `정답`이나 `허용`의 용어를 그대로 썼으면 "O". 뜻이 같은 다른 말로 바꿔 쓴 것은 "X". 맞춤법 차이는 채점 규칙의 맞춤법 항목을 따른다.',
    `- answer에는 ${full ? '그 글(essays의 text)에서 그 요소에 해당하는 부분(문장이나 구절)을 글자 그대로' : '학생 글에서 그 요소에 해당하는 부분(문장이나 구절)을 그대로'} 옮긴다. 찾지 못하면 빈 문자열과 "X". 그 문항에 쓴 글이 전혀 없으면 그 문항의 모든 단위를 빈 문자열과 "빈칸"으로 한다.`, ''];
}

/** 위치: 정량 단위마다 답의 세로 위치도 받는다(설정 '답 위치 받기'). 양식(transcriptSchema)과 같은 값을 넘긴다 */
export interface PromptOptions { 위치?: boolean }

/**
 * '답 위치 받기'를 켰을 때만 붙인다(꺼져 있으면 지시문이 그대로라 잰 정확도가 유지된다). 답안지별 검토에서 단위를 누르면 그림을 그 높이로 옮기는 데 쓴다.
 * 모델이 대략으로 주는 값이라 판정과 섞지 않게 따로 적는다
 */
function positionSection(on: boolean | undefined): string[] {
  if (!on) return [];
  return ['# 답 위치',
    '- quant의 항목마다 `y`에 그 단위의 답이 있는 세로 위치를 적는다. 그림 맨 위가 0, 맨 아래가 1인 비율이다(소수 둘째 자리까지, 예: 0.42).',
    '- 답의 첫 줄 높이를 적는다. 답을 쓰지 않았으면 그 답을 쓸 칸의 높이를, 논술형 단위는 answer로 옮긴 부분의 높이를 적는다. 정하기 어렵거나 찾지 못했으면 null.',
    '- 위치는 화면에서 그 답을 찾아가는 데만 쓴다. 판정에는 영향이 없다.', ''];
}

/** 선생님이 확정한 판정(최근 것부터 200건). 같은 단위에 같은 답이면 같게 판정한다 */
function casesSection(key: AnswerKey): string[] {
  const cases = (key.사례 ?? []).slice(-CASE_LIMIT);
  if (!cases.length) return [];
  return ['# 판정 사례(선생님 확정, 같은 답은 같게)', ...cases.map(c => `- ${c.단위}: ${JSON.stringify(c.답)} → ${c.판정}`), ''];
}

/** 규칙 본문 + 정답표 + 출력 지시. 규칙이 앞에 오므로 같은 세트 안에서 프롬프트 앞부분이 고정된다. 모델 재판정은 opts 없이 부른다(위치를 받지 않는다) */
export function systemPrompt(rules: Rules, key: AnswerKey, opts: PromptOptions = {}): string {
  // 배점은 점수 계산에만 쓴다. 모델에 보내지 않아야 배점을 바꿔도 지시문(과 잰 정확도)이 그대로다
  const keyForModel = { 글: key.글, 정량: key.정량.map(({ 배점: _, ...u }) => u), 정성: key.정성.map(({ 배점: _, ...u }) => u) };
  const 반 = [...key.대상.반].sort((a, b) => a - b);
  const 인원 = key.대상.인원 ? Object.entries(key.대상.인원).map(([r, n]) => `${r}반 ${n}명(번호 1~${n})`).join(', ') : '';
  return [rules.본문.trimEnd(), '',
    '# 대상', `이 세트는 ${key.대상.학년}학년 ${반.join('·')}반 답안지다. 학년은 ${key.대상.학년}, 반은 ${반.join(' 또는 ')} 중 하나다.${인원 ? ` 반별 인원: ${인원}.` : ''}`,
    '읽은 학년·반·번호가 이 범위를 벗어나면 그 자리에 가장 비슷한 허용 값(예: 7처럼 보이는 3)을 적고 id_confidence를 "추정"으로 하고 notes에 읽은 그대로를 적는다. 범위 안이어도 흘려 써서 다른 숫자로도 읽히면 "추정"이다.', '',
    ...(key.이름가림 ? ['# 이름 칸 가림', '이 세트는 이름 칸을 흰색으로 가려서 보냈다. name은 null로 두고 학년·반·번호로만 식별한다. 가려진 칸은 notes에 적지 않는다. 이 절이 전사 규칙의 이름 항목과 다르면 이 절을 따른다.', ''] : []),
    ...rulesSection(key), ...essaySection(key), ...positionSection(opts.위치), ...casesSection(key),
    '# 정답표', '```json', JSON.stringify(keyForModel, null, 1), '```', '',
    '# 출력', '주어진 JSON 스키마에 맞는 객체 하나만 낸다. quant·qual은 목록이다. 정답표의 모든 단위를 id와 함께 한 번씩, 정답표 순서대로 넣는다.'].join('\n');
}

export const userText = (page: number): string => `이 답안지 그림 한 장을 전사하라. page는 ${page}이다.`;
