import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appFileFor, PrintDocs, printDocFor, printDocUrl, PRINT_CSP } from '../src/main/protocols.js';

const roots = { html: 'R:\src\renderer', dist: 'R:\dist\src', pdfjs: 'R:\node_modules\pdfjs-dist\build', fonts: 'R:\resources\fonts' };

test('appFileFor: 채점 기준 안내문의 인쇄 CSS', () => {
  assert.equal(appFileFor(new URL('geulnun://app/criteria.css'), roots), path.join(roots.html, 'criteria.css'));
  assert.equal(appFileFor(new URL('geulnun://app/other.css'), roots), null);
});

test('PrintDocs·printDocFor: 넣은 문서만, 지우면 없다', () => {
  const docs = new PrintDocs();
  const id = docs.put('<p>문서</p>');
  assert.match(id, /^[0-9a-f-]{36}$/);
  const url = new URL(printDocUrl(id));
  assert.equal(url.href, `geulnun://app/print/${id}.html`);
  assert.equal(printDocFor(url, docs), '<p>문서</p>');
  assert.equal(printDocFor(url, undefined), null);
  assert.equal(printDocFor(new URL(`geulnun://other/print/${id}.html`), docs), null);
  assert.equal(printDocFor(new URL('geulnun://app/print/00000000-0000-0000-0000-000000000000.html'), docs), null);
  assert.equal(printDocFor(new URL('geulnun://app/print/../index.html'), docs), null);
  docs.delete(id);
  assert.equal(printDocFor(url, docs), null);
  assert.match(PRINT_CSP, /default-src 'none'/);
  assert.doesNotMatch(PRINT_CSP, /script-src|unsafe/);
});
