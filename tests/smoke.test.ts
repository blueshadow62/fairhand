import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('package.json은 Apache-2.0이고 ESM이다', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.type, 'module');
});
