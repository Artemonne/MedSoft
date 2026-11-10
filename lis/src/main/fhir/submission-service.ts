import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  HistoryItem,
  PendingSubmission,
  SubmissionResult,
} from "../../shared/types.js";
import type {
  ConnectionService,
  SecretStorage,
} from "../auth/connection-service.js";
import type { LisDatabase, SubmissionRow } from "../database/index.js";
import type { FhirRequestService } from "./request-service.js";

const inputSchema = z
  .object({
    requestId: z.string().uuid(),
    value: z.string().trim().min(1).max(10_000),
  })
  .strict();
export class SubmissionService {
  private flights = new Map<string, Promise<SubmissionResult>>();
  constructor(
    private db: LisDatabase,
    private connection: ConnectionService,
    private requests: FhirRequestService,
    private secrets: SecretStorage,
  ) {}
  async initializeEncryption() {
    if (!(await this.secrets.available()))
      throw new Error(
        "Защищённое хранилище недоступно: медицинские данные не могут быть открыты.",
      );
    const legacy = this.db.legacyMedicalRows();
    const encrypted = [];
    for (const row of legacy)
      encrypted.push({
        table: row.table,
        id: row.id,
        observationCipher: await this.secrets.encrypt(row.observationJson),
        snapshotCipher: await this.secrets.encrypt(row.snapshotJson),
      });
    if (encrypted.length) this.db.secureLegacyRows(encrypted);
    this.db.finalizeMedicalEncryption();
  }
  async submit(raw: unknown): Promise<SubmissionResult> {
    const input = inputSchema.parse(raw);
    const config = this.db.getConnection();
    if (!config) throw new Error("Подключение не настроено.");
    const existing = this.db.getSubmission(
      config.connectionId,
      input.requestId,
    );
    if (existing)
      return existing.state === "COMPLETED"
        ? {
            state: "COMPLETED",
            message: "Результат уже зафиксирован.",
            historyId: existing.id,
          }
        : this.deliver(existing);
    const detail = await this.requests.details(input.requestId);
    if (detail.status !== "active" || detail.result)
      throw new Error("Лабораторный запрос уже выполнен.");
    const value = input.value.trim();
    let normalized: string = value;
    let valuePart: any;
    if (detail.expectedResult.kind === "TEXT")
      valuePart = { valueString: value };
    else {
      normalized = value.replace(",", ".");
      if (
        !/^-?\d+(\.\d+)?$/.test(normalized) ||
        !Number.isFinite(Number(normalized))
      )
        throw new Error("Введите корректное конечное числовое значение.");
      if (!detail.expectedResult.unitCode)
        throw new Error("В назначении отсутствует обязательная UCUM-единица.");
      valuePart = {
        valueQuantity: {
          value: Number(normalized),
          unit: detail.expectedResult.unit ?? detail.expectedResult.unitCode,
          system: "http://unitsofmeasure.org",
          code: detail.expectedResult.unitCode,
        },
      };
    }
    const id = randomUUID(),
      system = `urn:uuid:${config.connectionId}`,
      effectiveDateTime = new Date().toISOString();
    const observation = {
      resourceType: "Observation",
      identifier: [{ system, value: id }],
      status: "final",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            },
          ],
        },
      ],
      code: {
        coding: [{ system: "http://loinc.org", code: detail.loincCode }],
      },
      subject: { reference: `Patient/${detail.patient.id}` },
      basedOn: [{ reference: `ServiceRequest/${detail.id}` }],
      effectiveDateTime,
      ...valuePart,
    };
    const row = {
      id,
      connectionId: config.connectionId,
      serviceRequestId: detail.id,
      identifierSystem: system,
      identifierValue: id,
      observationCipher: await this.secrets.encrypt(
        JSON.stringify(observation),
      ),
      snapshotCipher: await this.secrets.encrypt(JSON.stringify(detail)),
    };
    this.db.createSubmission(row);
    return this.deliver({ ...row, state: "PENDING" });
  }
  async reconcile(requestId: string) {
    const config = this.db.getConnection();
    if (!config) throw new Error("Подключение не настроено.");
    const row = this.db.getSubmission(
      config.connectionId,
      z.string().uuid().parse(requestId),
    );
    if (!row) throw new Error("Локальная операция не найдена.");
    const token = encodeURIComponent(
      `${row.identifierSystem}|${row.identifierValue}`,
    );
    const bundle: any = await this.connection.fhirGet(
      `/api/fhir/r5/Observation?identifier=${token}&_count=2`,
    );
    if (bundle.total === 1 && bundle.entry?.length === 1)
      return this.confirm(row, bundle.entry[0].resource);
    if (bundle.total > 1) {
      this.db.markSubmission(row.id, "CONFLICT");
      return {
        state: "CONFLICT",
        message: "Найдено несколько результатов с одним identifier.",
      } as const;
    }
    return this.deliver(row);
  }
  async listHistory(): Promise<HistoryItem[]> {
    const result = [];
    for (const row of this.db.listHistoryRows())
      result.push(await this.historyRow(row));
    return result;
  }
  async historyDetails(id: string) {
    const item = (await this.listHistory()).find(
      (row) => row.id === z.string().uuid().parse(id),
    );
    if (!item) throw new Error("Запись истории не найдена.");
    return item;
  }
  async listPending(): Promise<PendingSubmission[]> {
    const result = [];
    for (const raw of this.db.listOpenSubmissions()) {
      const snapshot = JSON.parse(
        await this.secrets.decrypt(raw.snapshot_cipher),
      );
      const observation = JSON.parse(
        await this.secrets.decrypt(raw.observation_cipher),
      );
      result.push({
        id: raw.id,
        serviceRequestId: raw.service_request_id,
        state: raw.state,
        testName: snapshot.testName,
        patientName: snapshot.patientName,
        createdValue:
          observation.valueString ?? String(observation.valueQuantity?.value),
      });
    }
    return result;
  }
  private async historyRow(row: any): Promise<HistoryItem> {
    const snapshot = JSON.parse(
        await this.secrets.decrypt(row.snapshot_cipher),
      ),
      observation = JSON.parse(
        await this.secrets.decrypt(row.observation_cipher),
      );
    const result =
      observation.valueString ??
      `${observation.valueQuantity?.value}${observation.valueQuantity?.unit ? " " + observation.valueQuantity.unit : ""}`;
    return {
      id: row.id,
      serviceRequestId: row.service_request_id,
      observationId: row.observation_id,
      testName: snapshot.testName,
      loincCode: snapshot.loincCode,
      patientName: snapshot.patientName,
      practitionerName: snapshot.practitionerName,
      resultDisplay: result,
      effectiveAt: row.effective_at,
      issued: row.issued,
      confirmedAt: row.confirmed_at,
    };
  }
  private async deliver(row: SubmissionRow): Promise<SubmissionResult> {
    const active = this.flights.get(row.id);
    if (active) return active;
    const flight = this.doDeliver(row).finally(() =>
      this.flights.delete(row.id),
    );
    this.flights.set(row.id, flight);
    return flight;
  }
  private async doDeliver(row: SubmissionRow): Promise<SubmissionResult> {
    try {
      const observation = JSON.parse(
        await this.secrets.decrypt(row.observationCipher),
      );
      const condition = `identifier=${encodeURIComponent(`${row.identifierSystem}|${row.identifierValue}`)}`;
      const response = await this.connection.fhirPost<any>(
        "/api/fhir/r5/Observation",
        observation,
        condition,
      );
      if (response.status !== 200 && response.status !== 201)
        throw new Error("Неожиданный статус HIS.");
      return await this.confirm(row, response.body);
    } catch (error: any) {
      if (error?.status === 409) {
        this.db.markSubmission(row.id, "CONFLICT");
        return {
          state: "CONFLICT",
          message: "В HIS уже существует другой результат для назначения.",
        };
      }
      this.db.markSubmission(row.id, "UNKNOWN");
      return {
        state: "UNKNOWN",
        message: "Исход отправки неизвестен. Выполните сверку.",
      };
    }
  }
  private async confirm(
    row: SubmissionRow,
    observation: any,
  ): Promise<SubmissionResult> {
    const expected = JSON.parse(
      await this.secrets.decrypt(row.observationCipher),
    );
    const sameValue =
      expected.valueString !== undefined
        ? observation.valueString === expected.valueString
        : Number(observation.valueQuantity?.value) ===
            Number(expected.valueQuantity?.value) &&
          observation.valueQuantity?.code === expected.valueQuantity?.code;
    if (
      !observation?.id ||
      observation.identifier?.[0]?.system !== row.identifierSystem ||
      observation.identifier?.[0]?.value !== row.identifierValue ||
      observation.basedOn?.[0]?.reference !== expected.basedOn[0].reference ||
      observation.subject?.reference !== expected.subject.reference ||
      observation.code?.coding?.[0]?.code !== expected.code.coding[0].code ||
      observation.effectiveDateTime !== expected.effectiveDateTime ||
      !sameValue ||
      !observation.issued
    )
      throw new Error("Ответ HIS не соответствует отправленному Observation.");
    const cipher = await this.secrets.encrypt(JSON.stringify(observation));
    this.db.completeSubmission(
      row,
      observation.id,
      cipher,
      observation.effectiveDateTime,
      observation.issued,
    );
    return {
      state: "COMPLETED",
      message: "Результат зафиксирован.",
      historyId: row.id,
    };
  }
}
