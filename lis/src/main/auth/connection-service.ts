import type { ConnectionStatus } from '../../shared/types.js';
import type { LisDatabase } from '../database/index.js';
import { connectionInputSchema } from '../configuration/validation.js';

interface SecretStorage { available(): Promise<boolean>; encrypt(value: string): Promise<Uint8Array>; decrypt(value: Uint8Array): Promise<string> }
interface TokenResponse { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export class ConnectionService {
  private accessToken: string | null = null;
  private refreshFlight: Promise<string> | null = null;
  constructor(private readonly database: LisDatabase, private readonly secrets: SecretStorage, private readonly fetcher: typeof fetch = fetch) {}
  status(message?: string): ConnectionStatus {
    const stored = this.database.getConnection();
    return { state: stored ? (this.accessToken ? 'connected' : 'disconnected') : 'not-configured', hisUrl: stored?.hisUrl ?? null, fhirVersion: stored?.fhirVersion ?? null, lastCheckedAt: stored?.lastCheckedAt ?? null, ...(message ? { message } : {}) };
  }
  async configure(raw: unknown) {
    const input = connectionInputSchema.parse(raw);
    if (!(await this.secrets.available())) throw new Error('Защищённое хранилище операционной системы недоступно.');
    const tokens = await this.json<TokenResponse>(`${input.hisUrl}/api/service-auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: input.apiKey }) });
    this.validateTokens(tokens);
    await this.verify(input.hisUrl, tokens.accessToken);
    const capability = await this.capability(input.hisUrl, tokens.accessToken);
    const checkedAt = new Date().toISOString();
    this.database.saveConnection({ hisUrl: input.hisUrl, encryptedRefreshToken: await this.secrets.encrypt(tokens.refreshToken), fhirVersion: capability.fhirVersion, lastCheckedAt: checkedAt });
    this.accessToken = tokens.accessToken;
    return this.status();
  }
  async test() {
    const stored = this.database.getConnection(); if (!stored) throw new Error('Подключение к HIS ещё не настроено.');
    const token = this.accessToken ?? await this.refresh();
    await this.verify(stored.hisUrl, token); const capability = await this.capability(stored.hisUrl, token);
    const checkedAt = new Date().toISOString(); this.database.updateSecret(stored.encryptedRefreshToken, checkedAt);
    return { ...this.status(), state: 'connected' as const, fhirVersion: capability.fhirVersion, lastCheckedAt: checkedAt };
  }
  async refresh(): Promise<string> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = this.performRefresh().finally(() => { this.refreshFlight = null; }); return this.refreshFlight;
  }
  private async performRefresh() {
    const stored = this.database.getConnection(); if (!stored) throw new Error('Подключение не настроено.');
    try {
      const refreshToken = await this.secrets.decrypt(stored.encryptedRefreshToken);
      const tokens = await this.json<TokenResponse>(`${stored.hisUrl}/api/service-auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      this.validateTokens(tokens); this.database.updateSecret(await this.secrets.encrypt(tokens.refreshToken), new Date().toISOString()); this.accessToken = tokens.accessToken; return tokens.accessToken;
    } catch (error) { this.accessToken = null; throw new Error('Сессия LIS отозвана или истекла. Выполните подключение заново.', { cause: error }); }
  }
  async disconnect() {
    const stored = this.database.getConnection();
    if (stored) { try { const token = this.accessToken ?? await this.refresh(); await this.fetcher(`${stored.hisUrl}/api/service-auth/logout`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}` } }); } catch { /* local disconnect must still complete */ } }
    this.accessToken = null; this.database.clearConnection(); return this.status();
  }
  async fhirGet<T>(path: string): Promise<T> {
    const stored = this.database.getConnection(); if (!stored) throw new Error('Подключение к HIS не настроено.');
    if (!path.startsWith('/api/fhir/r5/') || path.includes('://')) throw new Error('Недопустимый FHIR путь.');
    const request = (token: string) => this.json<T>(`${stored.hisUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json' } }, true);
    let token = this.accessToken ?? await this.refresh();
    try { return await request(token); } catch (error) { if (!(error instanceof HttpError) || error.status !== 401) throw error; token = await this.refresh(); return request(token); }
  }
  clearAccessTokenForTest() { this.accessToken = null; }
  private async verify(base: string, token: string) { const result = await this.json<{ status: string; role: string }>(`${base}/api/service-auth/test-connection`, { headers: { Authorization: `Bearer ${token}` } }); if (result.status !== 'connected' || result.role !== 'LIS') throw new Error('HIS не подтвердил роль LIS.'); }
  private async capability(base: string, token: string) {
    const value = await this.json<any>(`${base}/api/fhir/r5/metadata`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json' } }, true);
    if (value.resourceType !== 'CapabilityStatement' || value.fhirVersion !== '5.0.0') throw new Error('HIS не поддерживает требуемый FHIR R5 5.0.0.');
    const resources = value.rest?.flatMap((item: any) => item.resource ?? []) ?? [];
    for (const [type, code] of [['Patient', 'read'], ['Practitioner', 'read'], ['ServiceRequest', 'read'], ['Observation', 'create']]) if (!resources.some((resource: any) => resource.type === type && resource.interaction?.some((item: any) => item.code === code))) throw new Error(`FHIR capability ${type}.${code} отсутствует.`);
    return value as { fhirVersion: string };
  }
  private validateTokens(value: TokenResponse) { if (!value?.accessToken || !value.refreshToken || value.tokenType !== 'Bearer' || !Number.isFinite(value.expiresIn)) throw new Error('HIS вернул некорректный ответ авторизации.'); }
  private async json<T>(url: string, init: RequestInit, fhir = false): Promise<T> {
    let response: Response; try { response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }); } catch (error) { throw new Error('Не удалось установить защищённое соединение с HIS.', { cause: error }); }
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) { let message = `HIS вернул HTTP ${response.status}.`; try { const body = await response.json() as any; message = body.error?.message ?? body.issue?.[0]?.details?.text ?? message; } catch {} throw new HttpError(response.status, message); }
    if (!(fhir ? contentType.includes('application/fhir+json') || contentType.includes('application/json') : contentType.includes('application/json'))) throw new Error('HIS вернул неожиданный Content-Type.');
    return await response.json() as T;
  }
}
