import type { ConnectionInput, ConnectionSettings } from '../../shared/types.js';
import { connectionInputSchema } from '../configuration/validation.js';
import type { ConfigurationStore } from '../configuration/store.js';
import { ImporterError } from '../errors.js';
import { requestJson, type JsonResponse } from './http-client.js';

interface TokenResponse { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number }
interface ErrorBody { error?: { message?: string } }
type Requester = typeof requestJson;

export class TokenService {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private pendingRefreshToken: string | null = null;
  private refreshFlight: Promise<string> | null = null;

  constructor(private readonly store: ConfigurationStore, private readonly requester: Requester = requestJson) {}

  async establish(raw: unknown): Promise<{ settings: ConnectionSettings; accessToken: string }> {
    const input = connectionInputSchema.parse(raw);
    const settings = this.withoutApiKey(input);
    const response = await this.request<TokenResponse>(`${settings.hisUrl}/api/service-auth/token`, settings, { method: 'POST', body: { apiKey: input.apiKey } });
    const tokens = this.tokens(response);
    this.setTokens(tokens);
    await this.verify(settings, tokens.accessToken);
    return { settings, accessToken: tokens.accessToken };
  }

  async commit(settings: ConnectionSettings): Promise<void> {
    if (!this.pendingRefreshToken) throw new Error('Refresh token is unavailable.');
    await this.store.save(settings, this.pendingRefreshToken);
  }

  async token(settings = this.store.settings()): Promise<string> {
    if (!settings) throw new ImporterError('AUTHENTICATION', 'Подключение к HIS ещё не настроено.');
    if (this.accessToken && Date.now() < this.expiresAt - 30_000) return this.accessToken;
    return this.refresh(settings);
  }

  async refresh(settings: ConnectionSettings): Promise<string> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = this.performRefresh(settings).finally(() => { this.refreshFlight = null; });
    return this.refreshFlight;
  }

  private async performRefresh(settings: ConnectionSettings): Promise<string> {
    try {
      const refreshToken = this.pendingRefreshToken ?? await this.store.refreshToken();
      const response = await this.request<TokenResponse>(`${settings.hisUrl}/api/service-auth/refresh`, settings, { method: 'POST', body: { refreshToken } });
      const tokens = this.tokens(response);
      this.setTokens(tokens);
      await this.store.save(settings, tokens.refreshToken);
      return tokens.accessToken;
    } catch (error) {
      this.accessToken = null;
      throw error instanceof ImporterError ? error : new ImporterError('AUTHENTICATION', 'Не удалось обновить сессию. Проверьте API-ключ.', { cause: error });
    }
  }

  private async verify(settings: ConnectionSettings, token: string): Promise<void> {
    const response = await this.request<{ status?: string; role?: string }>(`${settings.hisUrl}/api/testConnection`, settings, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status !== 'connected') throw new ImporterError('AUTHENTICATION', 'HIS не подтвердил подключение.');
    if (response.role !== 'HL7_IMPORT') throw new ImporterError('FORBIDDEN', 'Сервисный аккаунт не имеет роли HL7 Import.');
  }

  private async request<T>(url: string, settings: ConnectionSettings, input: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown }): Promise<T> {
    const response: JsonResponse<T | ErrorBody> = await this.requester<T | ErrorBody>(url, { ...input, timeoutMs: settings.timeoutMs, caCertificatePath: settings.caCertificatePath });
    if (response.status === 401) throw new ImporterError('AUTHENTICATION', (response.body as ErrorBody).error?.message ?? 'Ошибка авторизации HIS.');
    if (response.status === 403) throw new ImporterError('FORBIDDEN', (response.body as ErrorBody).error?.message ?? 'Недостаточно прав в HIS.');
    if (response.status < 200 || response.status >= 300) throw new ImporterError('UNAVAILABLE', (response.body as ErrorBody).error?.message ?? `HIS вернул HTTP ${response.status}.`);
    return response.body as T;
  }

  private tokens(value: TokenResponse): TokenResponse {
    if (!value?.accessToken || !value.refreshToken || value.tokenType !== 'Bearer' || !Number.isFinite(value.expiresIn) || value.expiresIn <= 0) {
      throw new ImporterError('AUTHENTICATION', 'HIS вернул некорректный ответ авторизации.');
    }
    return value;
  }
  private setTokens(tokens: TokenResponse) { this.accessToken = tokens.accessToken; this.pendingRefreshToken = tokens.refreshToken; this.expiresAt = Date.now() + tokens.expiresIn * 1_000; }
  private withoutApiKey({ apiKey: _apiKey, ...settings }: ConnectionInput): ConnectionSettings { return settings; }
}
