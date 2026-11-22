import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ConnectionSettings } from '../../shared/types.js';
import { settingsSchema } from './validation.js';

export interface SecretStorage {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Uint8Array>;
  decrypt(value: Uint8Array): Promise<string>;
}
interface StoredConfiguration { version: 1; settings: ConnectionSettings; encryptedRefreshToken: string }

export class ConfigurationStore {
  constructor(private readonly filePath: string, private readonly secrets: SecretStorage) {}

  settings(): ConnectionSettings | null { return this.read()?.settings ?? null; }

  async save(settings: ConnectionSettings, refreshToken: string): Promise<void> {
    if (!(await this.secrets.available())) throw new Error('Защищённое хранилище операционной системы недоступно.');
    const encrypted = await this.secrets.encrypt(refreshToken);
    const value: StoredConfiguration = { version: 1, settings: settingsSchema.parse(settings), encryptedRefreshToken: Buffer.from(encrypted).toString('base64') };
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  async refreshToken(): Promise<string> {
    const stored = this.read();
    if (!stored) throw new Error('Настройки подключения не сохранены.');
    return this.secrets.decrypt(Buffer.from(stored.encryptedRefreshToken, 'base64'));
  }

  private read(): StoredConfiguration | null {
    if (!existsSync(this.filePath)) return null;
    const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredConfiguration;
    if (raw.version !== 1 || typeof raw.encryptedRefreshToken !== 'string') throw new Error('Файл настроек повреждён.');
    return { ...raw, settings: settingsSchema.parse(raw.settings) };
  }
}
