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
export const cumulativeFileName = (학기: string, 학년: number, d: Date): string =>
  `${semesterTag(학기)}_${학년}학년_누가기록_${dateTag(d)}.xlsx`;
export const keyExportName = (k: AnswerKey): string => `${head(k)}_${titleTag(k.글)}_정답표.json`;
