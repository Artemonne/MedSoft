export interface ConnectionInput { hisUrl: string; apiKey: string }
export interface ConnectionStatus {
  state: 'not-configured' | 'connected' | 'disconnected' | 'error';
  hisUrl: string | null;
  fhirVersion: string | null;
  lastCheckedAt: string | null;
  message?: string;
}
export interface LisApi {
  getConnectionStatus(): Promise<ConnectionStatus>;
  configureConnection(input: ConnectionInput): Promise<ConnectionStatus>;
  testConnection(): Promise<ConnectionStatus>;
  disconnect(): Promise<ConnectionStatus>;
}
export const IPC = {
  status: 'lis:connection-status', configure: 'lis:configure-connection',
  test: 'lis:test-connection', disconnect: 'lis:disconnect',
} as const;
