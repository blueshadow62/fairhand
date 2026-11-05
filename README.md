# 글눈

손글씨로 쓴 서·논술형 답안지(스캔 PDF)를 문항별 글자로 옮기고, 정답표와 비교해 엑셀로 정리하는 선생님용 프로그램입니다.

- 전사(손글씨 읽기)는 선생님 PC에 설치된 Claude Code(본인 구독 로그인)로 합니다. API 키도 쓸 수 있습니다.
- 학생 이름은 PC 밖으로 보내지 않습니다. 답안지에는 **학년·반·번호만** 쓰기를 권합니다. 자세한 내용은 [PRIVACY.md](PRIVACY.md).
- 아직 개발 중입니다(0·1단계). 설치 안내는 첫 릴리스 때 적습니다.

## 개발
- 요구: Node 22 이상
- `npm install` → `npm test` → `npm start`
- 세트 채점(명령줄): `npm run score -- "<세트 폴더>" --roster "<명단.xlsx>"`

## 라이선스
Apache-2.0. 가져온 부품은 [NOTICE](NOTICE)에 있습니다. 이 프로그램은 사용자가 설치한 Claude Code를 실행하며, Claude 사용은 사용자 본인의 Anthropic 약관을 따릅니다. Anthropic과 관련이 없는 개인 프로젝트입니다.

English: [README.en.md](README.en.md)
