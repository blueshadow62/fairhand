import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DataError } from '../core/types.js';
import { EFFORTS, GEMINI_MODELS, MODELS, THEMES, type EffortLevel, type ModelId, type Profile, type Rotation, type Settings, type Theme } from '../shared/ipc.js';

export const DEFAULT_PROFILE: Profile = { id: 'cli-default', 이름: 'Claude Code', 종류: 'cli' };
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
// 렌더러가 보낸 값이라 형이 아니라 검사로 믿는다: 상대 경로는 실행 파일·삭제 기준 폴더가 엉뚱한 곳을 가리킬 수 있다
const optAbs = (v: unknown): string | undefined => { const s = optStr(v); return s && path.isAbsolute(s) ? s : undefined; };

export function defaultSettings(): Settings {
  return { 학기폴더: null, 명단: null, 기본회전: 0, 프로필: [{ ...DEFAULT_PROFILE }], 사용중: DEFAULT_PROFILE.id, 언어: 'ko', 자동업데이트: true, 화면색: THEMES[0] };
}

function parseProfile(v: unknown): Profile | null {
  if (!isObj(v)) return null;
  const id = optStr(v.id), 이름 = optStr(v.이름);
  if (!id || !이름 || (v.종류 !== 'cli' && v.종류 !== 'api' && v.종류 !== 'codex' && v.종류 !== 'gemini')) return null;
  const p: Profile = { id, 이름, 종류: v.종류 };
  const local = p.종류 === 'cli' || p.종류 === 'codex'; // 이 PC의 프로그램을 띄우는 종류만 실행 파일·로그인 폴더를 둔다
  const cliPath = optAbs(v.cliPath), configDir = optAbs(v.configDir);
  if (local && cliPath && /\.(exe|cmd)$/i.test(cliPath)) p.cliPath = cliPath;
  if (local && configDir) p.configDir = configDir;
  // Codex 모델 이름은 목록이 정해져 있지 않아 명령줄에 안전한 글자만 받는다
  const codexModel = optStr(v.모델);
  if (p.종류 === 'codex') { if (codexModel && /^[\w.:-]{1,64}$/.test(codexModel)) p.모델 = codexModel; }
  else if (p.종류 === 'gemini') { if ((GEMINI_MODELS as readonly string[]).includes(v.모델 as string)) p.모델 = v.모델 as string; }
  else if ((MODELS as readonly string[]).includes(v.모델 as string)) p.모델 = v.모델 as ModelId;
  if ((EFFORTS as readonly string[]).includes(v.노력 as string)) p.노력 = v.노력 as EffortLevel;
  return p;
}

/** 기본 프로필을 보장하고, 사용중이 목록에 없으면 기본 프로필로 */
function normalize(s: Settings): Settings {
  const 프로필 = s.프로필.some(p => p.id === DEFAULT_PROFILE.id) ? s.프로필 : [{ ...DEFAULT_PROFILE }, ...s.프로필];
  const 사용중 = 프로필.some(p => p.id === s.사용중) ? s.사용중 : DEFAULT_PROFILE.id;
  return { ...s, 프로필, 사용중 };
}

export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const 프로필 = Array.isArray(raw.프로필) ? raw.프로필.map(parseProfile).filter((p): p is Profile => p !== null) : d.프로필;
  const seen = new Set<string>();
  return normalize({
    학기폴더: optAbs(raw.학기폴더) ?? null,
    명단: optAbs(raw.명단) ?? null,
    기본회전: ROTATIONS.includes(raw.기본회전 as Rotation) ? (raw.기본회전 as Rotation) : 0,
    프로필: 프로필.filter(p => !seen.has(p.id) && seen.add(p.id)),
    사용중: optStr(raw.사용중) ?? null,
    언어: raw.언어 === 'en' ? 'en' : 'ko',
    자동업데이트: raw.자동업데이트 !== false,
    화면색: (THEMES as readonly unknown[]).includes(raw.화면색) ? (raw.화면색 as Theme) : THEMES[0],
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
