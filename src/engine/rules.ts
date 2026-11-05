import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

/** 규칙 본문 + 정답표 + 출력 지시. 규칙이 앞에 오므로 같은 세트 안에서 프롬프트 앞부분이 고정된다. */
export function systemPrompt(rules: Rules, key: AnswerKey): string {
  const keyForModel = { 글: key.글, 정량: key.정량, 정성: key.정성 };
  return [rules.본문.trimEnd(), '',
    '# 정답표', '```json', JSON.stringify(keyForModel, null, 1), '```', '',
    '# 출력', '주어진 JSON 스키마에 맞는 객체 하나만 낸다. 정답표의 모든 단위 id를 정량·정성에 빠짐없이 넣는다.'].join('\n');
}

export const userText = (page: number): string => `이 답안지 그림 한 장을 전사하라. page는 ${page}이다.`;
