import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
const b = pkg.build;

test('build 절: 이름·아이디·Windows NSIS 사용자별 설치·GitHub 배포', () => {
  assert.equal(b.productName, '글눈');
  assert.equal(b.appId, 'kr.geulnun.app');
  // 설치된 실행 파일 이름. 업데이트 때 바로 가기는 새 파일로 다시 만들어지지만 작업 표시줄 고정 사본은 Windows가 갱신하지 않는다
  assert.equal(b.executableName, 'Fairhand');
  assert.equal(b.win.artifactName, 'fairhand-setup-${version}.${ext}'); // 받는 설치 파일 이름(release.yml의 올릴 파일과 짝)
  assert.deepEqual(b.win.target, ['nsis']);
  assert.equal(b.nsis.oneClick, false);
  assert.equal(b.nsis.perMachine, false);
  assert.equal(b.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(b.nsis.installerLanguages[0], 'ko_KR');
  assert.deepEqual(b.publish, { provider: 'github', owner: 'blueshadow62', repo: 'fairhand', releaseType: 'draft' });
  assert.equal(b.directories.output, 'release');
  assert.equal(pkg.version, '0.2.13');
});

test('build 절: 앱이 읽는 파일은 들어가고, 네이티브 부품·개발 파일은 빠진다', () => {
  const f: string[] = b.files;
  for (const need of ['dist/src/**', 'dist-preload/**', 'src/renderer/**', 'resources/**', 'package.json', 'LICENSE', 'NOTICE'])
    assert.ok(f.includes(need), `files에 ${need}가 없음`);
  for (const no of ['!node_modules/@napi-rs/**', '!**/*.map', '!dist/tests/**', '!dist/scripts/**', '!local/**', '!tests/**', '!docs/**', '!**/*.d.ts', '!src/renderer/**/*.ts'])
    assert.ok(f.includes(no), `files에 ${no}가 없음`);
  assert.equal(b.asar, true);
  // 서명 없는 실행 파일이 임의 Node 실행기·디버그 발판으로 쓰이지 않게
  assert.deepEqual(b.electronFuses, { runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, onlyLoadAppFromAsar: true });
});
