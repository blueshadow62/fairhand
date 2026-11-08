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
