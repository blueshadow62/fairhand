import type { GeulnunApi } from '../../shared/ipc.js';

declare global { interface Window { geulnun: GeulnunApi } }

export const api: GeulnunApi = window.geulnun;

export { imageUrl } from '../../shared/ipc.js';
