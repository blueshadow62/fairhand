# 글눈

손글씨로 쓴 서·논술형 답안지(스캔 PDF)를 문항별 글자로 옮기고, 정답표와 비교해 엑셀로 정리하는 선생님용 프로그램입니다.

- 전사(손글씨 읽기)는 선생님 PC에 설치된 Claude Code(본인 구독 로그인)로 합니다. API 키도 쓸 수 있습니다.
- 학생 답안지에는 **학년, 반, 번호만** 입력되어 있는 걸 추천합니다. 이름이 있으면 그림과 함께 Anthropic 서버로 전송됩니다. 명단(이름)은 PC 안에서만 씁니다. 자세한 내용은 [PRIVACY.md](PRIVACY.md).
- 아직 개발 중입니다(4단계: 화면). 설치 안내는 첫 릴리스 때 적습니다.

## 사용 순서
1. **설정**: 학기 폴더를 고르고, AI 프로필을 정합니다(Claude Code 로그인 또는 API 키). 명단(xlsx·csv)은 선택.
2. **문항 설정**: 새 세트를 만들고 정답표(문항 표)를 적습니다. 문제와 지문을 붙여넣어 AI 초안을 받을 수 있습니다. 확인한 뒤 '확인 완료'를 표시해야 채점할 수 있습니다.
3. **채점 실행**: 답안지 PDF를 올려 회전을 맞추고 쪽으로 나눠 저장한 뒤 '전사 시작'. 끝나면 세트 폴더에 채점결과 엑셀이 생깁니다.
4. **검토**: 답안지 그림과 전사를 나란히 보고 고쳐 저장합니다(엑셀도 다시 만듭니다). 학기 누가기록도 여기서 만듭니다.

## 개발
- 요구: Node 22 이상
- `npm install` → `npm test` → `npm start`(빌드 포함)
- 개발 중에는 설정·API 키를 저장소의 `local/`(무시됨)에 두고 실행: PowerShell `$env:GEULNUN_USER_DATA='local\userData'; npm start`
- 명령줄 스크립트는 경로에 공백이 있으면 `npm run`으로 인수를 넘기지 말고 빌드(`npm run build`) 뒤 직접 부릅니다.
  - 세트 채점: `node dist/scripts/score-set.js "<세트 폴더>" --roster "<명단.xlsx>"`
  - 세트 전사: `node dist/scripts/transcribe-set.js "<세트 폴더>" --engine cli --out "<세트 폴더>\평가\cli"`
  - 평가: `node dist/scripts/eval.js "<세트 폴더>" --got "<세트 폴더>\평가\cli"`
  - 다른 Claude Code 계정으로: PowerShell `$env:CLAUDE_CONFIG_DIR='C:\Users\이름\.claude-max'` 뒤 실행

## 라이선스
Apache-2.0. 가져온 부품은 [NOTICE](NOTICE)에 있습니다. 이 프로그램은 사용자가 설치한 Claude Code를 실행하며, Claude 사용은 사용자 본인의 Anthropic 약관을 따릅니다. Anthropic과 관련이 없는 개인 프로젝트입니다.

English: [README.en.md](README.en.md)
