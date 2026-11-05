type Attr = string | number | boolean | null | undefined | ((e: Event) => void);
type Child = Node | string | number | null | undefined | false;

/** DOM 만들기 도우미. on* 키는 addEventListener, class는 className, true는 빈 속성, false·null은 생략. value·checked·disabled는 속성(property)으로. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, Attr> | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') node.className = String(v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (node as any)[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

export function clear(node: Element): void { node.replaceChildren(); }
export function text(node: Element, s: string): void { node.textContent = s; }
