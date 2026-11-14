import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appFileFor, imageUrl, pageImageFor } from '../src/main/protocols.js';

const roots = { html: 'R:\\src\\renderer', dist: 'R:\\dist\\src', pdfjs: 'R:\\node_modules\\pdfjs-dist\\build', fonts: 'R:\\resources\\fonts' };

test('appFileFor: 네 뿌리로만, 밖은 null', () => {
  assert.equal(appFileFor(new URL('geulnun://app/index.html'), roots), path.join(roots.html, 'index.html'));
  assert.equal(appFileFor(new URL('geulnun://app/styles.css'), roots), path.join(roots.html, 'styles.css'));
  assert.equal(appFileFor(new URL('geulnun://app/dist/renderer/app.js'), roots), path.join(roots.dist, 'renderer', 'app.js'));
  assert.equal(appFileFor(new URL('geulnun://app/dist/shared/ipc.js'), roots), path.join(roots.dist, 'shared', 'ipc.js'));
  assert.equal(appFileFor(new URL('geulnun://app/pdfjs/pdf.worker.min.mjs'), roots), path.join(roots.pdfjs, 'pdf.worker.min.mjs'));
  assert.equal(appFileFor(new URL('geulnun://app/fonts/PretendardVariable.woff2'), roots), path.join(roots.fonts, 'PretendardVariable.woff2'));
  assert.equal(appFileFor(new URL('geulnun://app/fonts/x.ttf'), roots), null); // woff2만
  assert.equal(appFileFor(new URL('geulnun://app/dist/../package.json'), roots), null);
  assert.equal(appFileFor(new URL('geulnun://app/..%2f..%2fx'), roots), null);
  assert.equal(appFileFor(new URL('geulnun://other/index.html'), roots), null);
  assert.equal(appFileFor(new URL('geulnun://app/dist/renderer/app.ts'), roots), null); // 소스는 안 준다
});

test('pageImageFor·imageUrl: 세트의 pages/pNN.jpg만', () => {
  const u = imageUrl('2026 3학년', 7);
  assert.equal(u, 'geulnun-img://set/2026%203%ED%95%99%EB%85%84/p07.jpg');
  assert.equal(pageImageFor(new URL(u), 'D:\\학기'), path.join('D:\\학기', '2026 3학년', 'pages', 'p07.jpg'));
  assert.equal(pageImageFor(new URL('geulnun-img://set/a/정답표.json'), 'D:\\학기'), null);
  assert.equal(pageImageFor(new URL('geulnun-img://set/..%2f..%2fx/p01.jpg'), 'D:\\학기'), null);
  assert.equal(pageImageFor(new URL(u), null), null);
});

test('preload의 CHANNELS 복제가 shared/ipc.ts와 같다', () => {
  // 줄바꿈(CRLF·LF)은 체크아웃 설정에 따라 파일마다 달라질 수 있어 같은 것으로 본다
  const block = (f: string) => /CHANNELS = (\{[\s\S]*?\}) as const;/.exec(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf-8').replace(/\r\n/g, '\n'))?.[1];
  const a = block('src/shared/ipc.ts'), b = block('src/preload/index.ts');
  assert.ok(a && a.length > 100);
  assert.equal(b, a);
});

test('pageImageFor: thumbs/ 아래의 작은 그림도 세트의 pages/thumbs/로만', () => {
  const sem = 'C:\\학기';
  assert.equal(pageImageFor(new URL('geulnun-img://set/' + encodeURIComponent('2026 3학년') + '/thumbs/p07.jpg'), sem), path.join(sem, '2026 3학년', 'pages', 'thumbs', 'p07.jpg'));
  // '..'은 URL 단계에서 정리돼 원본 그림을 가리킨다(pages/ 밖으로 못 나간다)
  assert.equal(pageImageFor(new URL('geulnun-img://set/' + encodeURIComponent('2026 3학년') + '/thumbs/../p07.jpg'), sem), path.join(sem, '2026 3학년', 'pages', 'p07.jpg'));
  assert.equal(pageImageFor(new URL('geulnun-img://set/' + encodeURIComponent('2026 3학년') + '/other/p07.jpg'), sem), null);
});
