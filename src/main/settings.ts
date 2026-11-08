import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DataError } from '../core/types.js';
import type { RunStat } from '../shared/estimate.js';
import { DEFAULT_ANSWER_POSITIONS, EFFORTS, GEMINI_MODELS, MODELS, OPENAI_MODELS, THEMES, type EffortLevel, type ModelId, type Profile, type Rotation, type Settings, type Theme } from '../shared/ipc.js';

export const DEFAULT_PROFILE: Profile = { id: 'cli-default', 이름: 'Claude Code', 종류: 'cli' };
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
// 렌더러가 보낸 값이라 형이 아니라 검사로 믿는다: 상대 경로는 실행 파일·삭제 기준 폴더가 엉뚱한 곳을 가리킬 수 있다.
// 절대 경로 규칙은 운영체제마다 달라(C:\ 와 /) platform을 받는다
const optAbs = (v: unknown, platform: NodeJS.Platform): string | undefined => {
  const s = optStr(v);
  return s && (platform === 'win32' ? path.win32 : path.posix).isAbsolute(s) ? s : undefined;
};
/** Windows는 .exe·.cmd만(다른 파일을 띄우지 않게). 맥·리눅스의 실행 파일은 확장자가 없다 */
const isCliFile = (p: string, platform: NodeJS.Platform): boolean => platform !== 'win32' || /\.(exe|cmd)$/i.test(p);

export function defaultSettings(): Settings {
  return { 학기폴더: null, 명단: null, 기본회전: 0, 프로필: [{ ...DEFAULT_PROFILE }], 사용중: DEFAULT_PROFILE.id, 언어: 'ko', 자동업데이트: true, 자동설치: false, 화면색: THEMES[0], 답위치: DEFAULT_ANSWER_POSITIONS };
}

function parseProfile(v: unknown, platform: NodeJS.Platform): Profile | null {
  if (!isObj(v)) return null;
  const id = optStr(v.id), 이름 = optStr(v.이름);
  if (!id || !이름 || (v.종류 !== 'cli' && v.종류 !== 'api' && v.종류 !== 'codex' && v.종류 !== 'gemini' && v.종류 !== 'openai')) return null;
  const p: Profile = { id, 이름, 종류: v.종류 };
  const local = p.종류 === 'cli' || p.종류 === 'codex'; // 이 PC의 프로그램을 띄우는 종류만 실행 파일·로그인 폴더를 둔다
  const cliPath = optAbs(v.cliPath, platform), configDir = optAbs(v.configDir, platform);
  if (local && cliPath && isCliFile(cliPath, platform)) p.cliPath = cliPath;
  if (local && configDir) p.configDir = configDir;
  // Codex 모델 이름은 목록이 정해져 있지 않아 명령줄에 안전한 글자만 받는다
  const codexModel = optStr(v.모델);
  if (p.종류 === 'codex') { if (codexModel && /^[\w.:-]{1,64}$/.test(codexModel)) p.모델 = codexModel; }
  else if (p.종류 === 'gemini') { if ((GEMINI_MODELS as readonly string[]).includes(v.모델 as string)) p.모델 = v.모델 as string; }
  else if (p.종류 === 'openai') { if ((OPENAI_MODELS as readonly string[]).includes(v.모델 as string)) p.모델 = v.모델 as string; }
  else if ((MODELS as readonly string[]).includes(v.모델 as string)) p.모델 = v.모델 as ModelId;
  if ((EFFORTS as readonly string[]).includes(v.노력 as string)) p.노력 = v.노력 as EffortLevel;
  return p;
}

const MAX_STAT_KEYS = 50;
/** 전사기록: 열쇠는 짧은 글자, 값은 0 이상의 유한한 수 다섯 개. 하나라도 틀린 항목은 버린다(예상에만 쓰므로 버려도 다시 쌓인다) */
function parseStats(v: unknown): Record<string, RunStat> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, RunStat> = {};
  for (const [k, s] of Object.entries(v).slice(0, MAX_STAT_KEYS)) {
    if (!k || k.length > 100 || !isObj(s)) continue;
    const nums = [s.장, s.초, s.토큰장, s.입력, s.출력];
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) continue;
    out[k] = { 장: s.장 as number, 초: s.초 as number, 토큰장: s.토큰장 as number, 입력: s.입력 as number, 출력: s.출력 as number };
  }
  return Object.keys(out).length ? out : undefined;
}

/** 기본 프로필을 보장하고, 사용중이 목록에 없으면 기본 프로필로 */
function normalize(s: Settings): Settings {
  const 프로필 = s.프로필.some(p => p.id === DEFAULT_PROFILE.id) ? s.프로필 : [{ ...DEFAULT_PROFILE }, ...s.프로필];
  const 사용중 = 프로필.some(p => p.id === s.사용중) ? s.사용중 : DEFAULT_PROFILE.id;
  return { ...s, 프로필, 사용중 };
}

export function parseSettings(raw: unknown, platform: NodeJS.Platform = process.platform): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const 프로필 = Array.isArray(raw.프로필) ? raw.프로필.map(v => parseProfile(v, platform)).filter((p): p is Profile => p !== null) : d.프로필;
  const seen = new Set<string>();
  const 전사기록 = parseStats(raw.전사기록);
  return normalize({
    학기폴더: optAbs(raw.학기폴더, platform) ?? null,
    명단: optAbs(raw.명단, platform) ?? null,
    기본회전: ROTATIONS.includes(raw.기본회전 as Rotation) ? (raw.기본회전 as Rotation) : 0,
    프로필: 프로필.filter(p => !seen.has(p.id) && seen.add(p.id)),
    사용중: optStr(raw.사용중) ?? null,
    언어: raw.언어 === 'en' ? 'en' : 'ko',
    자동업데이트: raw.자동업데이트 !== false,
    자동설치: raw.자동설치 === true, // 묻지 않고 받는 것은 사용자가 켰을 때만
    화면색: (THEMES as readonly unknown[]).includes(raw.화면색) ? (raw.화면색 as Theme) : THEMES[0],
    답위치: typeof raw.답위치 === 'boolean' ? raw.답위치 : DEFAULT_ANSWER_POSITIONS,
    ...(전사기록 ? { 전사기록 } : {}),
  });
}

export function applyPatch(cur: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...cur, ...patch };
  if (patch.프로필) {
    const ids = new Set<string>();
    for (const p of patch.프로필) {
      if (!p.이름?.trim()) throw new DataError('프로필 이름이 비었습니다');
      if (ids.has(p.id)) throw new DataError(`프로필 id가 겹칩니다: ${p.id}`);
      ids.add(p.id);
    }
  }
  return parseSettings(next); // 같은 규칙으로 정리(기본 프로필 보장, 사용중 확인)
}

export class SettingsStore {
  constructor(private readonly file: string) {}
  async load(): Promise<Settings> {
    try { return parseSettings(JSON.parse(await readFile(this.file, 'utf-8'))); } catch { return defaultSettings(); }
  }
  async save(patch: Partial<Settings>): Promise<Settings> {
    const next = applyPatch(await this.load(), patch);
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 1), 'utf-8');
    await rename(tmp, this.file);
    return next;
  }
}
