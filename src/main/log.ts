import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// 로그에는 오류 메시지와 장 번호·세트 폴더명까지만 쓴다. 학생 답·키·프롬프트는 부르는 쪽이 넘기지 않는다.
export type LogLevel = 'warn' | 'error' | 'info';
const pad = (n: number) => String(n).padStart(2, '0');
const NAME = /^(\d{4})-(\d{2})-(\d{2})\.log$/;

/** 이 PC의 날짜 기준(선생님이 '오늘 로그'를 찾기 쉽게) */
export const logFileName = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;

function part(p: unknown): string {
  if (p instanceof Error) {
    const frame = p.stack?.split('\n').slice(1).find(l => l.trim())?.trim();
    return frame ? `${p.message} (${frame})` : p.message;
  }
  if (typeof p === 'string') return p;
  try { return typeof p === 'object' && p !== null ? JSON.stringify(p) : String(p); } catch { return String(p); }
}

export const logLine = (level: LogLevel, parts: unknown[], now: Date): string =>
  `${now.toISOString()} [${level}] ${parts.map(part).join(' ').replace(/\r?\n/g, ' ')}\n`;

export function pruneOld(names: string[], today: Date, keepDays = 14): string[] {
  const cut = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays);
  return names.filter(n => { const m = NAME.exec(n); return !!m && new Date(+m[1]!, +m[2]! - 1, +m[3]!) < cut; });
}

/** dir에 일자별 로그를 쓰고 console.error·warn을 가로챈다(원래 출력도 그대로). close()는 가로채기 전으로 되돌린다. */
export function installLog(dir: string, now: () => Date = () => new Date()): { write(level: LogLevel, ...parts: unknown[]): void; close(): void } {
  mkdirSync(dir, { recursive: true });
  for (const n of pruneOld(readdirSync(dir), now())) { try { unlinkSync(path.join(dir, n)); } catch { /* 다음 시작 때 다시 */ } }
  const write = (level: LogLevel, ...parts: unknown[]) => {
    const d = now();
    try { appendFileSync(path.join(dir, logFileName(d)), logLine(level, parts, d), 'utf-8'); } catch { /* 로그 실패로 앱이 멈추면 안 된다 */ }
  };
  const orig = { error: console.error, warn: console.warn };
  const error = (...a: unknown[]) => { orig.error(...a); write('error', ...a); };
  const warn = (...a: unknown[]) => { orig.warn(...a); write('warn', ...a); };
  console.error = error; console.warn = warn;
  return {
    write,
    close() { if (console.error === error) console.error = orig.error; if (console.warn === warn) console.warn = orig.warn; },
  };
}
