import type { AnswerKey } from './types.js';

/** Windows 금지 문자와 제어 문자를 -로, 앞뒤 공백·점 제거. 비면 '세트'. */
export function safeName(s: string): string {
  const r = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '');
  return r || '세트';
}
export const semesterTag = (학기: string): string => safeName(학기.trim().replace(/\s+/g, '-'));
/** 괄호와 그 안(저자)을 떼고 공백을 없앤 뒤 20자. */
export const titleTag = (글: string): string => {
  const t = safeName(글.replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, ''));
  return [...t].slice(0, 20).join('') || '글';
};
export const classTag = (반: number[]): string => `${[...반].sort((a, b) => a - b).join('·')}반`;
export const dateTag = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const head = (k: AnswerKey): string => `${semesterTag(k.학기)}_${k.대상.학년}학년`;
export const setFolderName = (k: AnswerKey): string => `${head(k)}_${titleTag(k.글)}`;
export const resultFileName = (k: AnswerKey, d: Date): string =>
  `${head(k)}_${classTag(k.대상.반)}_${titleTag(k.글)}_채점결과_${dateTag(d)}.xlsx`;
/** resultFileName으로 만든 파일인지. 엑셀이 파일을 여는 동안 옆에 두는 잠금 파일(~$…)은 이름 끝이 같아도 아니다 */
export const isResultFileName = (name: string): boolean => !name.startsWith('~$') && /_채점결과_\d{4}-\d{2}-\d{2}\.xlsx$/.test(name);
export const cumulativeFileName = (학기: string, 학년: number, d: Date): string =>
  `${semesterTag(학기)}_${학년}학년_누가기록_${dateTag(d)}.xlsx`;
export const keyExportName = (k: AnswerKey): string => `${head(k)}_${titleTag(k.글)}_정답표.json`;
/** 채점 기준 안내문(문항 설정에서 내보내는 PDF·HWPX). 정답표 내보내기처럼 날짜를 붙이지 않는다 */
export const criteriaFileName = (k: AnswerKey, ext: 'pdf' | 'hwpx'): string => `${head(k)}_${titleTag(k.글)}_채점기준.${ext}`;

/**
 * 답안지 PDF 이름. marked: 채점 표시를 넣은 것(받은 사람이 이름만 보고 구분하게 '채점답안지'), part: 반별·학생별 묶음의 한 조각(예: '2반', '2반07번_김하나').
 * 묶음이 여럿이면 answerPdfFolderName의 폴더 안에 둔다
 */
export const answerPdfFileName = (k: AnswerKey, d: Date, marked: boolean, part?: string): string =>
  `${head(k)}_${part === undefined ? classTag(k.대상.반) : safeName(part)}_${titleTag(k.글)}_${marked ? '채점답안지' : '답안지'}_${dateTag(d)}.pdf`;
export const answerPdfFolderName = (k: AnswerKey, d: Date, marked: boolean): string =>
  `${head(k)}_${classTag(k.대상.반)}_${titleTag(k.글)}_${marked ? '채점답안지' : '답안지'}_${dateTag(d)}`;
/** 같은 이름이 있으면 덮어쓰지 않고 ' (2)', ' (3)'…을 확장자 앞에 붙인다(Windows는 대소문자를 가리지 않아 소문자로 견준다) */
export function uniqueName(name: string, taken: (name: string) => boolean): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let out = name;
  for (let i = 2; taken(out); i++) out = `${stem} (${i})${ext}`;
  return out;
}
