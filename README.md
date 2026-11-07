<p align="right"><a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/English-README-0969da?style=for-the-badge"></a></p>

# 글눈

손글씨로 쓴 서·논술형 답안지(스캔 PDF)를 문항별 글자로 옮기고, 정답표와 비교해 엑셀로 정리하는 선생님용 프로그램입니다.

- 전사(손글씨 읽기)는 선생님 PC에 설치된 Claude Code(본인 구독 로그인)로 합니다. API 키도 쓸 수 있습니다.
- 학생 답안지에는 **학년, 반, 번호만** 입력되어 있는 걸 추천합니다. 이름이 있으면 그림과 함께 Anthropic 서버로 전송됩니다. 명단(이름)은 PC 안에서만 씁니다. 자세한 내용은 [PRIVACY.md](PRIVACY.md).

## 설치
1. [Releases](https://github.com/blueshadow62/fairhand/releases)에서 `geulnun-setup-x.y.z.exe`를 받습니다.
2. 받은 파일을 실행합니다. 코드 서명이 없어 Windows가 '알 수 없는 게시자'나 'Windows의 PC 보호' 창을 띄웁니다. **추가 정보 → 실행**을 누르면 설치가 이어집니다. 관리자 권한은 필요 없습니다(사용자별 설치).
3. 첫 실행에서 **설정**의 '기본 폴더 만들기(문서\글눈)'를 누르거나 학기 폴더를 고르고, AI 프로필을 정합니다.
4. Claude Code로 전사하려면 Claude Code를 설치하고 로그인합니다([설치 안내](https://code.claude.com/docs/ko/setup)). 설정 화면의 '로그인 열기'가 순서를 안내합니다.

## 업데이트
- 새 버전이 있는지 켤 때(10초 뒤)와 4시간마다 GitHub에서 확인하고, 있으면 받아 둡니다. 설정 화면에 '다시 시작해 적용' 버튼이 나오며, 누를 때만 설치됩니다.
- 끄기: 설정 → 정보 → '새 버전을 자동으로 확인'의 체크를 풉니다. 꺼져 있으면 GitHub에 접속하지 않습니다.
- 설치 파일과 업데이트는 코드 서명이 없습니다. GitHub Releases(HTTPS)에서 받으며 electron-updater가 릴리스에 적힌 SHA-512로 파일을 검증합니다. 설치는 사용자가 누를 때만 됩니다.

## 샘플 세트
시작 화면에 세트가 없으면 '샘플 세트 넣어 보기' 버튼이 있습니다. 지어낸 짧은 글 '봄비 오는 날'과 **인쇄 글자로 만든 가짜 답안지 3장**, 미리 만든 전사가 들어 있어 AI 없이 검토 화면과 엑셀 만들기를 먼저 해 볼 수 있습니다. 손글씨 읽기 정확도를 보여 주는 자료가 아닙니다.

## 사용 순서
1. **설정**: 학기 폴더를 고르고, AI 프로필을 정합니다(Claude Code 로그인 또는 API 키). 명단(xlsx·csv)은 선택.
2. **문항 설정**: 새 세트를 만들고 정답표(문항 표)를 적습니다. 문제와 지문을 붙여넣어 AI 초안을 받을 수 있습니다. 확인한 뒤 '확인 완료'를 표시해야 채점할 수 있습니다.
3. **채점 실행**: 답안지 PDF를 올려 회전을 맞추고 쪽으로 나눠 저장한 뒤 '전사 시작'. 끝나면 세트 폴더에 채점결과 엑셀이 생깁니다. 저장된 장은 작은 그림으로 보고 지울 수 있고, 같은 파일을 다시 올리면 경고합니다.
4. **검토**: 답안지 그림과 전사를 나란히 보고 고쳐 저장합니다(엑셀도 다시 만듭니다). 학기 누가기록도 여기서 만듭니다.

## 채점 규칙과 사례
- 세트마다 채점 규칙 세 가지를 고릅니다(문항 설정): 맞춤법이 다른 같은 뜻의 답, 정답보다 넓은 말, 문장형 핵심어(모두/하나라도).
- 검토에서 바꾼 판정은 '사례'로 쌓여(체크로 끌 수 있음) 같은 단위에 같은 답을 쓴 다른 장에 바로 적용되고, 그 뒤에 전사하는 장에도 적용됩니다.
- 정답표를 고치면 기존 장을 다시 판정할 수 있습니다. '다시 판정'은 글자가 같은 답만 고치고(모델 호출 없음), '모델로 다시 판정'은 답 글만 보내 판정을 다시 받습니다(그림은 보내지 않음).
- 판정을 바꾼 근거는 전사의 비고에 남습니다(`재판정: 4-2 O→X (사례)`, `모델 재판정: …`). 학생이 쓴 답 글은 바꾸지 않습니다.

## 알려진 한계
- JBIG2·JPEG2000으로 압축한 스캔 PDF는 쪽 나누기가 실패할 수 있습니다(보통 스캐너의 JPEG PDF는 괜찮습니다).

## 문제 보고
- [Issues](https://github.com/blueshadow62/fairhand/issues)에 재현 순서와 화면 이름을 적어 주세요.
- **답안지·명단·학생 정보가 든 파일은 올리지 마세요.** 그림을 올려야 하면 학생 정보를 가린 것만 올립니다.
- 로그는 `%APPDATA%\글눈\logs\날짜.log`에 있습니다. 필요한 줄만 붙이고, 세트 폴더 이름 등에 학생 정보가 있으면 지웁니다.
- 보안 문제는 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 방법으로 알려 주세요.

## 개발
- 요구: Node 24 이상(Electron 45가 품은 Node와 같은 판. CI도 24)
- `npm install` → `npm test` → `npm start`(빌드 포함)
- 설치 파일: `npm run dist` → `release/geulnun-setup-<버전>.exe`(빠른 확인은 `npm run pack` → `release/win-unpacked/Geulnun.exe`). 태그 `v*`를 올리면 GitHub Actions가 설치 파일을 만들어 초안 릴리스로 올립니다.
- 개발 중에는 설정·API 키를 저장소의 `local/`(무시됨)에 두고 실행: PowerShell `$env:GEULNUN_USER_DATA='local\userData'; npm start`
- 명령줄 스크립트는 경로에 공백이 있으면 `npm run`으로 인수를 넘기지 말고 빌드(`npm run build`) 뒤 직접 부릅니다.
  - 세트 채점: `node dist/scripts/score-set.js "<세트 폴더>" --roster "<명단.xlsx>"`
  - 세트 전사: `node dist/scripts/transcribe-set.js "<세트 폴더>" --engine cli --out "<세트 폴더>\평가\cli"`
  - 평가: `node dist/scripts/eval.js "<세트 폴더>" --got "<세트 폴더>\평가\cli"`
  - 다른 Claude Code 계정으로: PowerShell `$env:CLAUDE_CONFIG_DIR='C:\Users\이름\.claude-max'` 뒤 실행

## 라이선스
Apache-2.0. 가져온 부품은 [NOTICE](NOTICE)에 있습니다. 이 프로그램은 사용자가 설치한 Claude Code를 실행하며, Claude 사용은 사용자 본인의 Anthropic 약관을 따릅니다. Anthropic과 관련이 없는 개인 프로젝트입니다.
