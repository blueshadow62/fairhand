# 보안 안내 / Security

## 신고
보안 문제는 공개 이슈에 적지 말고 GitHub의 비공개 신고로 알려 주세요:
https://github.com/blueshadow62/geulnun/security/advisories/new

Please report security issues privately through the link above, not in public issues.

## 올리지 말 것
신고할 때도 답안지·명단·학생 정보가 든 파일은 첨부하지 마세요. 재현에 그림이 필요하면 학생 정보를 가린 것만 씁니다.

## 서명과 업데이트
- 설치 파일과 업데이트는 코드 서명이 없습니다. GitHub Releases(HTTPS)에서 받으며 electron-updater가 릴리스에 적힌 SHA-512로 파일을 검증합니다. 설치는 사용자가 누를 때만 됩니다.
- 그래서 Windows가 처음 설치할 때 '알 수 없는 게시자' 경고를 띄웁니다. 설치 파일은 이 저장소의 Releases에서만 받으세요.
- The installer and updates are not code-signed. They are downloaded from GitHub Releases over HTTPS, and electron-updater checks each file against the SHA-512 listed in the release. An update installs only when the user presses the button.

## 지원 범위
가장 최근 릴리스만 고칩니다.
