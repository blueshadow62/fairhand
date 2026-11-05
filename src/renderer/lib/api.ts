import type { GeulnunApi } from '../../shared/ipc.js';

declare global { interface Window { geulnun: GeulnunApi } }

export const api: GeulnunApi = window.geulnun;

/** main/protocols.ts의 imageUrl과 같은 규칙(렌더러는 메인 모듈을 불러오지 않는다) */
export const imageUrl = (폴더: string, page: number): string => `geulnun-img://set/${encodeURIComponent(폴더)}/p${String(page).padStart(2, '0')}.jpg`;
