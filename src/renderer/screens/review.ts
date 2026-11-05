import type { Ctx } from '../app.js';
import { el } from '../lib/el.js';

export function mount(root: HTMLElement, _ctx: Ctx): void { root.append(el('p', { class: 'muted' }, '준비 중')); }
