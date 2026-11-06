// 공개 전 점검: git 기록 전체(git log --all -p)에 학생 이름·키·개인 경로·이메일이 없는지 센다.
// 쓰는 법: node scripts/check-history.mjs <이름 목록 파일(한 줄에 하나, 저장소 밖 또는 local/)>
// 이 스크립트 자신은 패턴 글을 담고 있어 살펴보지 않는다. 걸린 이름은 화면에 그대로 찍지 않고 목록의 줄 번호로만 알린다. 하나라도 걸리면 종료 코드 1.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const namesFile = process.argv[2];
if (!namesFile) { console.error('쓰는 법: node scripts/check-history.mjs <이름 목록 파일>'); process.exit(2); }
const names = [...new Set(readFileSync(namesFile, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];

const log = execFileSync('git', ['-c', 'core.quotepath=off', 'log', '--all', '-p', '--no-color', '--format=commit %H%n%an <%ae>%n%cn <%ce>%n%B', '--', '.', ':(exclude)scripts/check-history.mjs'], { encoding: 'utf-8', maxBuffer: 1 << 30 });

const PATTERNS = [
  ['API 키(sk-ant- 뒤 20자 이상)', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['API 키 환경 변수에 적힌 실제 값', /ANTHROPIC_API_KEY=(?!["'`$<{\s]|\.\.\.)\S{8,}/g],
  ['이 PC 사용자 폴더의 다른 계정 설정 폴더 경로', /Users[\\/]+USER[\\/]+\.claude-max/gi],
  ['이메일(gmail 등, users.noreply.github.com 제외)', /[\w.+-]+@(?!users\.noreply\.github\.com)(gmail|naver|daum|hanmail|kakao|outlook|hotmail)\.[a-z.]+/gi],
];

let total = 0;
for (const [label, re] of PATTERNS) {
  const n = (log.match(re) ?? []).length;
  total += n;
  console.log(`${String(n).padStart(4)}  ${label}`);
}
const hit = names.map((n, i) => [i + 1, log.split(n).length - 1]).filter(([, c]) => c > 0);
total += hit.reduce((a, [, c]) => a + c, 0);
console.log(`${String(hit.reduce((a, [, c]) => a + c, 0)).padStart(4)}  학생 이름(${names.length}명 중 ${hit.length}명)${hit.length ? ': 목록 줄 ' + hit.map(([i, c]) => `${i}(${c})`).join(', ') : ''}`);
console.log(total ? `걸린 것 ${total}건. 공개 전에 기록을 고쳐야 합니다.` : '모두 0건');
process.exit(total ? 1 : 0);
