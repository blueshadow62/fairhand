import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES } from '../src/shared/ipc.js';

const css = readFileSync(new URL('../../src/renderer/styles.css', import.meta.url), 'utf-8');

/** 선택자 블록 안의 '--이름: #rrggbb'만 모은다(rgba·color-mix 값은 대비 계산에 쓰지 않는다) */
function block(sel: string): Record<string, string> {
  const i = css.indexOf(`${sel} {`);
  assert.ok(i >= 0, `${sel} 블록이 없음`);
  const body = css.slice(i, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1]!, m[2]!.toLowerCase()]));
}
const lum = (hex: string): number => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi! + 0.05) / (lo! + 0.05); };
const vars = (th: string): Record<string, string> => (th === THEMES[0] ? block(':root') : { ...block(':root'), ...block(`:root[data-theme="${th}"]`) });

test('화면색: 기본(맨 앞, sky)을 뺀 테마마다 styles.css에 색 묶음이 있다', () => {
  assert.equal(THEMES[0], 'sky');
  for (const th of THEMES.slice(1)) assert.ok(css.includes(`:root[data-theme="${th}"]`), `${th} 색 묶음이 없음`);
});

test('화면색: 어둡게는 선택 상자·스크롤 막대 같은 기본 부품도 어둡게 그린다', () => {
  const i = css.indexOf(':root[data-theme="dark"]');
  assert.match(css.slice(i, css.indexOf('}', i)), /color-scheme:\s*dark/);
});

test('화면색: 세 테마 모두 글자와 바탕의 대비가 4.5:1 이상(웹 접근성 AA)', () => {
  for (const th of THEMES) {
    const v = vars(th);
    const pairs: [string, string | undefined, string | undefined][] = [
      ['흰 글자/강조 버튼', '#ffffff', v['accent']], ['흰 글자/오류 토스트', '#ffffff', v['bad-bg']],
      ['글/창 바탕', v['text'], v['bg']], ['글/카드', v['text'], v['surface']], ['보조 글/카드', v['text-2'], v['surface']],
      ['강조 글/강조 띠', v['accent-text'], v['accent-soft']], ['오류 글/오류 띠', v['bad'], v['bad-soft']],
      ['경고 글/경고 띠', v['warn-text'], v['warn-soft']], ['성공 글/카드', v['ok'], v['surface']], ['오류 글/카드', v['bad'], v['surface']],
    ];
    for (const [name, fg, bg] of pairs) {
      assert.ok(fg && bg, `${th} ${name}: 색이 정의되지 않음`);
      assert.ok(ratio(fg, bg) >= 4.5, `${th} ${name}: ${ratio(fg, bg).toFixed(2)}:1`);
    }
  }
});
