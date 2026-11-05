import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DataError } from '../core/types.js';
import type { SecretView } from '../shared/ipc.js';

export interface SafeStorageLike { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }
interface Stored { [id: string]: { sealed: string; 끝4자: string } }

/** API 키를 운영체제 암호화(Windows DPAPI)로 봉인해 둔다. 메인 프로세스만 연다. 평문으로는 절대 쓰지 않는다. */
export class SecretStore {
  constructor(private readonly file: string, private readonly storage: SafeStorageLike) {}

  private async read(): Promise<Stored> {
    try { const v = JSON.parse(await readFile(this.file, 'utf-8')); return typeof v === 'object' && v !== null ? v as Stored : {}; } catch { return {}; }
  }
  private async write(s: Stored): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 1), 'utf-8');
    await rename(tmp, this.file);
  }
  private unseal(sealed: string): string | null {
    try { return this.storage.decryptString(Buffer.from(sealed, 'base64')); } catch { return null; }
  }

  async set(id: string, key: string): Promise<SecretView> {
    const k = key.trim();
    if (!k) throw new DataError('API 키가 비었습니다');
    if (!this.storage.isEncryptionAvailable()) throw new DataError('이 PC에서는 운영체제 암호화를 쓸 수 없어 API 키를 저장하지 않습니다');
    const sealed = this.storage.encryptString(k).toString('base64');
    // 봉인 직후 풀리지 않으면(암호화 키가 아직 디스크에 없는 등) 저장했다고 하지 않는다
    if (this.unseal(sealed) !== k) throw new DataError('API 키를 봉인했지만 다시 열 수 없어 저장하지 않았습니다. 프로그램을 다시 시작한 뒤 해 주세요');
    const all = await this.read();
    all[id] = { sealed, 끝4자: k.slice(-4) };
    await this.write(all);
    return { 저장됨: true, 끝4자: k.slice(-4), 열림: true };
  }

  async view(id: string): Promise<SecretView> {
    const e = (await this.read())[id];
    if (!e) return { 저장됨: false };
    return { 저장됨: true, 끝4자: e.끝4자, 열림: this.storage.isEncryptionAvailable() && this.unseal(e.sealed) !== null };
  }

  async open(id: string): Promise<string | null> {
    const e = (await this.read())[id];
    return e && this.storage.isEncryptionAvailable() ? this.unseal(e.sealed) : null;
  }

  async clear(id: string): Promise<void> {
    const all = await this.read();
    delete all[id];
    await this.write(all);
  }
}
