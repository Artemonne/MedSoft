import { accessSync, constants } from 'node:fs';
import type { ConnectionCheckResult, ConnectionInput, ConnectionSettings, ImportPatient, ImportProgress, PatientImportResult, XmlLoadResult } from '../shared/types.js';
import type { ConfigurationStore } from './configuration/store.js';
import { userMessage, ImporterError } from './errors.js';
import { TokenService } from './auth/token-service.js';
import { buildAdtA28, buildConnectionTest, parseAck } from './hl7/codec.js';
import { MllpClient, UnknownOutcomeError } from './hl7/mllp-client.js';
import { DemoXmlAdapter } from './xml/demo-adapter.js';

export class ImporterService {
  private patients: ImportPatient[] = [];
  private importing = false;
  constructor(
    private readonly store: ConfigurationStore,
    private readonly tokens: TokenService,
    private readonly mllp: MllpClient,
    private readonly xml: DemoXmlAdapter,
  ) {}

  settings(): ConnectionSettings | null { return this.store.settings(); }
  loadXml(buffer: Buffer, fileName: string): XmlLoadResult { const result = this.xml.parse(buffer, fileName); this.patients = result.patients; return result; }

  async testConnection(input: ConnectionInput): Promise<ConnectionCheckResult> {
    const initial: ConnectionCheckResult = { ok: false, api: { ok: false, message: 'Не проверено.' }, mllp: { ok: false, message: 'Не проверено.' }, certificate: null };
    let established: { settings: ConnectionSettings; accessToken: string };
    try {
      for (const [label, path] of [['клиентский сертификат', input.clientCertificatePath], ['приватный ключ', input.clientKeyPath], ['корневой CA', input.caCertificatePath]] as const) {
        try { accessSync(path, constants.R_OK); } catch (error) { throw new ImporterError('VALIDATION', `Не удалось прочитать ${label}.`, { cause: error }); }
      }
      established = await this.tokens.establish(input);
      initial.api = { ok: true, message: 'HTTP API: авторизация и /api/testConnection успешны.' };
    } catch (error) {
      initial.api = { ok: false, message: userMessage(error) };
      return initial;
    }
    try {
      const message = buildConnectionTest(established.settings.sourceSystemId, established.accessToken);
      const response = await this.mllp.exchange(established.settings, message.payload);
      initial.certificate = response.certificate;
      const ack = parseAck(response.payload, message.controlId, 'Q11');
      if (ack.code !== 'AA') throw new ImporterError('INVALID_ACK', `MLLP test отклонён: ${ack.text}`);
      await this.tokens.commit(established.settings);
      initial.mllp = { ok: true, message: 'mTLS, MLLP и прикладной ACK проверены.' };
      initial.ok = true;
      return initial;
    } catch (error) {
      initial.mllp = { ok: false, message: userMessage(error) };
      return initial;
    }
  }

  async importPatients(onProgress: (progress: ImportProgress) => void): Promise<PatientImportResult[]> {
    if (this.importing) throw new ImporterError('VALIDATION', 'Импорт уже выполняется.');
    const settings = this.store.settings();
    if (!settings) throw new ImporterError('VALIDATION', 'Сначала успешно проверьте и сохраните подключение.');
    if (this.patients.length === 0) throw new ImporterError('VALIDATION', 'Выберите XML с корректными пациентами.');
    this.importing = true;
    const results: PatientImportResult[] = [];
    try {
      for (const [index, patient] of this.patients.entries()) {
        onProgress({ rowId: patient.rowId, status: 'SENDING', completed: index, total: this.patients.length });
        const result = await this.importOne(patient, settings);
        results.push(result);
        onProgress({ rowId: patient.rowId, status: result.status, completed: index + 1, total: this.patients.length, result });
      }
      return results;
    } finally { this.importing = false; }
  }

  private async importOne(patient: ImportPatient, settings: ConnectionSettings): Promise<PatientImportResult> {
    try {
      let token = await this.tokens.token(settings);
      let result = await this.send(patient, settings, token);
      if (result.code !== 'AA' && /JWT authentication failed/i.test(result.text)) {
        token = await this.tokens.refresh(settings);
        result = await this.send(patient, settings, token);
      }
      if (result.code === 'AA') {
        if (!/^\d+$/.test(result.text)) throw new ImporterError('INVALID_ACK', 'HIS вернул некорректный внутренний ID пациента.');
        return { rowId: patient.rowId, status: 'SUCCESS', hisPatientId: result.text, message: 'Пациент импортирован.' };
      }
      return { rowId: patient.rowId, status: 'REJECTED', hisPatientId: null, message: result.text };
    } catch (error) {
      return { rowId: patient.rowId, status: error instanceof UnknownOutcomeError ? 'UNKNOWN' : 'REJECTED', hisPatientId: null, message: userMessage(error) };
    }
  }

  private async send(patient: ImportPatient, settings: ConnectionSettings, token: string) {
    const message = buildAdtA28(patient, settings.sourceSystemId, token);
    const response = await this.mllp.exchange(settings, message.payload);
    return parseAck(response.payload, message.controlId, 'A28');
  }
}
