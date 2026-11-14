import { DEFAULT_GEMINI_MODEL, DEFAULT_MODEL, DEFAULT_OPENAI_MODEL, type Profile } from '../../shared/ipc.js';

/**
 * 왼쪽 아래 AI 표시의 이름 줄: '프로필 이름 · 종류 · 모델'.
 * 기본 프로필은 이름이 종류와 같아('Claude Code') 같은 말이 두 번 나왔다. 앞뒤 공백·대소문자만 다르면
 * 같은 이름으로 보고 종류 하나만 적는다. 이름이 비어 있어도 줄이 ' · '로 시작하지 않게 종류부터 적는다.
 */
export function badgeLabel(name: string, kind: string, model: string): string {
  return (sameAsKind(name, kind) ? [kind, model] : [name.trim(), kind, model]).join(' · ');
}

/** 프로필 이름이 비었거나 종류 이름과 같은가(앞뒤 공백·대소문자 무시). 시작 화면의 'AI 프로필' 줄도 같은 기준으로 겹침을 없앤다 */
export function sameAsKind(name: string, kind: string): boolean {
  const own = name.trim();
  return !own || own.toLowerCase() === kind.trim().toLowerCase();
}

/** 종류 이름의 화면 글 키. 왼쪽 아래 AI 표시와 채점 실행의 전사 칸이 같은 이름을 쓴다 */
export const kindKey = (종류: Profile['종류']): `app.badge.${Profile['종류']}` => `app.badge.${종류}`;

/** 짧은 모델 이름. Claude는 제품 이름(Opus 5.5)으로, 나머지는 모델 id 그대로. Codex에서 비우면 codexDefault(기본 모델) */
export function modelLabel(p: Pick<Profile, '종류' | '모델'>, codexDefault: string): string {
  if (p.종류 === 'codex') return p.모델 ?? codexDefault;
  if (p.종류 === 'gemini') return p.모델 ?? DEFAULT_GEMINI_MODEL;
  if (p.종류 === 'openai') return p.모델 ?? DEFAULT_OPENAI_MODEL;
  return (p.모델 ?? DEFAULT_MODEL) === 'claude-sonnet-5-5' ? 'Sonnet 5.5' : 'Opus 5.5';
}

/** 구독(Claude Code·Codex)은 요금제 사용량에서, 나머지(API 키)는 쓴 토큰만큼 청구된다 */
export const isSubscription = (종류: Profile['종류']): boolean => 종류 === 'cli' || 종류 === 'codex';
