/**
 * 마우스를 올리면 바로 뜨고, 떼면 사라지는 짧은 설명 상자.
 * 브라우저 기본 title은 1초쯤 늦게 뜨고 글자가 작으며 줄을 나눠 보이기 어렵다.
 * 상자는 하나를 같이 쓰고, 스크롤·창 크기 변경·누르기가 있으면 자리가 어긋나므로 닫는다.
 */
let box: HTMLDivElement | null = null;
let owner: Element | null = null;

function ensureBox(): HTMLDivElement {
  if (box) return box;
  box = document.createElement('div');
  box.className = 'tip hidden';
  box.setAttribute('role', 'tooltip');
  document.body.append(box);
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
  document.addEventListener('pointerdown', hideTip, true);
  return box;
}

export function hideTip(): void { box?.classList.add('hidden'); owner = null; }

function showTip(node: HTMLElement, text: string): void {
  if (!text) return;
  const b = ensureBox();
  owner = node;
  // 줄마다 나누고, '빈칸형: …'처럼 짧은 이름으로 시작하는 줄은 이름을 굵게(여섯 유형 목록을 훑어보기 쉽게)
  b.replaceChildren(...text.split('\n').map(line => {
    const row = document.createElement('div'), m = /^([^:]{1,10}): (.*)$/.exec(line);
    if (!m) { row.textContent = line; return row; }
    const [, label = '', rest = ''] = m;
    const name = document.createElement('strong'); name.textContent = label;
    row.append(name, `: ${rest}`);
    return row;
  }));
  b.classList.remove('hidden');
  // 아래에 자리가 없으면 위로, 오른쪽 끝을 넘으면 왼쪽으로 당긴다
  const r = node.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight, gap = 6;
  b.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  b.style.top = `${r.bottom + gap + h <= innerHeight - 8 ? r.bottom + gap : Math.max(8, r.top - gap - h)}px`;
}

/** node에 설명을 단다. text가 함수면 뜰 때마다 새로 읽는다(고른 유형처럼 바뀌는 값) */
export function tip<T extends HTMLElement>(node: T, text: string | (() => string)): T {
  const read = () => (typeof text === 'function' ? text() : text);
  node.addEventListener('mouseenter', () => showTip(node, read()));
  node.addEventListener('mouseleave', () => { if (owner === node) hideTip(); });
  node.classList.add('has-tip');
  if (typeof text === 'string') node.setAttribute('aria-description', text); // 화면 읽기 프로그램에도
  return node;
}
