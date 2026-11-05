# 변경 기록

## 0.2.0 (개발 중)
- 전사 엔진(공통부·Claude Code CLI 경로·Anthropic API 경로), 명령줄 전사·평가 스크립트.
- 모델 출력 스키마는 영문 키(구조화 출력 제한), 전사 파일은 한글 양식 그대로.
- 전사 규칙 transcribe-v1: 대상 학년·반 범위 고지, 정답표 단위 `유형`(요소형만 순서 무관), '정답보다 넓은 말은 X'.

### 평가(2026-11-06, CLI claude-opus-5-5 effort high, 장당 약 20초)
| 세트 | 장 | 판정 일치 | 응답 일치 | 식별 | 합계 차이 ±1 |
|---|---|---|---|---|---|
| 3학년(첫판 규칙) | 16 | 286/288 (99.3%) | 64/64 | 12/16 | 16/16 |
| 3학년(대상·유형 조정 뒤, 5장 재전사) | 16 | 288/288 (100%) | 64/64 | 14/16 | 16/16 |
| 2학년(첫판 규칙) | 7 | 158/161 (98.1%) | 14/14 | 7/7 | 7/7 |
| 2학년(조정 뒤 전체 재전사) | 7 | 157/161 (97.5%) | 14/14 | 7/7 | 7/7 |

남은 불일치: 3학년 식별 2장은 번호 한 자리 흘림(5↔6은 모델이 '추정'으로 표시, 7↔17은 '확실'로 틀림). 2학년은 요소형 문항에서 같은 X 답을 다른 요소 칸에 둔 것(점수 동일), '인간관계'를 '선후배 관계'와 같은 뜻으로 본 것(규칙에 경계 추가, 재측정 전), 흘림체 '프로게어머' 읽기 차이. 평가 지표에서 '같은 문항 안 X 답의 칸 위치 차이'는 불일치로 세지 않도록 바꿀 것(미결).

## 미결·계획과 달리 한 것
- CLI가 돌려주는 `usage.input_tokens`가 장당 2로 보고된다. 비용 추정에는 캐시 읽기·생성 토큰도 더해야 한다.
- 평가 지표에 장당 시간·토큰이 없다.
- (4단계) `tests/main-settings.test.ts`: 계획의 검사는 `프로필[0]`이 'a'라고 봤지만 `normalize`가 기본 프로필을 앞에 넣으므로 `find(id === 'a')`로 바꿨다.
- (4단계) `TranscribeProvider`가 `StructuredProvider`를 확장해 `complete`가 필수가 되어, `tests/engine-transcribe.test.ts`의 가짜 제공자에 쓰이지 않는 `complete`를 더했다.
- (4단계) `EngineBridge.startRun`: 계획 코드는 정답표 확인·쪽 목록을 await한 뒤에 실행 표시를 해서 동시에 두 번 시작할 수 있었다(검사가 잡음). await 전에 AbortController를 잡도록 바꿨다.
- (4단계) `EngineBridge.testApiKey`: 401/403의 기본 안내가 'Claude Code 로그인' 문구라 'API 키가 틀리거나 권한이 없습니다'로 바꿨다.
- (4단계) preload: TypeScript 7이 `moduleResolution: node10`을 없애 `tsconfig.preload.json`은 `CommonJS` + `Bundler`. 출력은 `dist-preload/preload.cjs`(`scripts/rename-preload.mjs`). `CHANNELS`는 preload에 복제하고 `tests/main-protocols.test.ts`가 같은지 본다.
- (4단계) `protocols.ts`: CSP와 `cache-control: no-store`를 프로토콜 응답 머리글에 직접 단다(webRequest만으로는 커스텀 프로토콜에 붙는지 확실하지 않고, 캐시 때문에 빌드 뒤 새로고침해도 옛 모듈이 실행됐다).
- (4단계) `revealPath`: 다른 드라이브 경로(`path.relative`가 절대 경로)도 거절하도록 고쳤다. 메인 로그에 렌더러의 경고·오류(CSP 위반 포함)를 남긴다(`console-message`).
- (4단계) `pdf-pages.ts`: pdf.js 5에 `isEvalSupported` 옵션이 없어 뺐다. 화면용 렌더는 requestAnimationFrame을 기다려 창이 가려지거나 최소화되면 멈춰서 `intent: 'print'`로 그린다.
- (4단계) `pdfjs-dist@5.7.284`가 선택 의존성으로 네이티브 `@napi-rs/canvas`를 함께 설치한다. 렌더러에서만 쓰므로 필요 없다. 5단계 패키징에서 빼야 한다(`--omit=optional` 또는 electron-builder files 제외).
- (4단계) pdf.js의 wasm 디코더(JBIG2·JPX)는 프로토콜로 내주지 않고 CSP에 `wasm-unsafe-eval`도 없다. 그런 압축의 스캔 PDF는 쪽 나누기가 실패할 수 있다(지금 답안지는 JPEG라 문제없음).
- (4단계) `SetData`에 `명단`(대상 학년·반만)을 더해 검토 화면의 미제출 목록을 명단 기준으로 만든다. 명단 파일이 깨져도 세트는 열린다(`명단: null`).
- (4단계) 붙여넣은 지문은 저장하지 않는다(`readSourceText`만, 계획의 최소 범위). 지문 PDF 본문 추출도 하지 않는다.
- (4단계) `rowsToKey`는 id를 행 순서로 다시 매긴다. 옛 정답표의 id가 `문항-순번` 규칙을 벗어나면 저장할 때 id가 바뀌어 기존 전사와 어긋난다(지금 두 세트는 규칙대로라 문제없음).
- (4단계) 파일 로그(`userData/logs/`)는 만들지 않았다. 지금은 메인의 `console.error`뿐. 5단계 몫(사양 11절에 적을 것: D: 문서라 여기 적음).
- (4단계) CHANGELOG 0.2.0 절에 '화면 4개·AI 프로필·pdf.js' 줄은 넣지 않았다(다른 절은 건드리지 말라는 지시). 정리 때 옮길 것.
- (4단계) 화면에서 확인하지 못한 것: 실행 중 '중단' 버튼(엔진 다리 검사로만 확인), AI 정답 초안 실제 호출, '한 장만 채점해 보기' 실제 호출, API 경로 실제 전사, 운영체제 대화상자를 쓰는 동작(학기 폴더·명단·CLI 파일·설정 폴더 고르기, 정답표 내보내기/가져오기, 지문 첨부)의 클릭, Ctrl+휠 확대·끌어 옮기기.

## 0.1.0 (개발 중)
- 저장소 뼈대, 핵심 채점 로직 이식(파이썬 → TypeScript).
- 기존 3학년·2학년 세트에서 파이썬 결과와 동일.
