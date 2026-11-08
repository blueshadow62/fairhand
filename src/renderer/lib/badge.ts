/**
 * 왼쪽 아래 AI 표시의 이름 줄: '프로필 이름 · 종류 · 모델'.
 * 기본 프로필은 이름이 종류와 같아('Claude Code') 같은 말이 두 번 나왔다. 앞뒤 공백·대소문자만 다르면
 * 같은 이름으로 보고 종류 하나만 적는다. 이름이 비어 있어도 줄이 ' · '로 시작하지 않게 종류부터 적는다.
 */
export function badgeLabel(name: string, kind: string, model: string): string {
  const own = name.trim();
  const same = !own || own.toLowerCase() === kind.trim().toLowerCase();
  return (same ? [kind, model] : [own, kind, model]).join(' · ');
}
