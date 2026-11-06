# 글눈(geulnun) 작업 지침

손글씨 서·논술형 답안지 전사·채점 도구. 사양: 연구 폴더 `D:\업무\학교 업무\2026학년도\2026 교과\2026 서논술형 채점 연구\docs\2026-11-05-글눈-설계.md`.

## 꼭 지킬 것
- `npm test`(tsc + node:test)가 통과해야 커밋한다. 테스트는 `tests/*.test.ts`, 픽스처는 `tests/fixtures/`(가짜 자료만).
- 학생 답안지·명단·지문 저작물·실제 채점 결과를 저장소에 넣지 않는다. 실제 세트는 D:의 연구 폴더(`D:\업무\학교 업무\2026학년도\2026 교과\2026 서논술형 채점 연구\`)에 있고 절대 경로를 인수로 받는다. 임시 사본은 `local/`(무시됨)에.
- 새 외부 부품은 사양 4절의 것만. 더하면 NOTICE에 적는다.
- 파일·폴더·JSON 필드명은 한글 그대로, utf-8. ESM이라 상대 import에 `.js`를 붙인다.
- `src/core`는 Electron을 import하지 않는다.
- 사용자에게 보이는 오류는 `DataError`(한글, 어느 파일·장인지 포함).
- 제품명·로고에 'Claude'를 쓰지 않는다. "Claude Code를 실행합니다"라고 평문으로만.

## 명령
- 검사: `npm test` · 실행: `npm start`(빌드 포함: tsc + preload를 CommonJS로 `dist-preload/preload.cjs`) · 세트 채점(1단계): `npm run build` 뒤 `node dist/scripts/score-set.js "<세트 폴더>" [--roster <xlsx|csv>]`(공백 있는 경로는 `npm run -- `로 넘기면 깨진다)
- 개발 실행은 설정·키를 `local/`에 두게: PowerShell `$env:GEULNUN_USER_DATA='local\userData'; npm start`
- 경로에 공백이 있으면 npm 스크립트로 인수를 넘기지 말고 `node dist/scripts/<이름>.js "<경로>"`로 직접.
