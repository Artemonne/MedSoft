import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LisDatabase } from "../src/main/database/index.js";
import { SubmissionService } from "../src/main/fhir/submission-service.js";

const dirs: string[] = [];
const secrets = {
  available: async () => true,
  encrypt: async (value: string) => Buffer.from(`cipher:${value}`),
  decrypt: async (value: Uint8Array) => Buffer.from(value).toString().slice(7),
};
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function setup(kind: "TEXT" | "QUANTITY" = "TEXT") {
  const dir = mkdtempSync(join(tmpdir(), "lis-submit-"));
  dirs.push(dir);
  const db = new LisDatabase(join(dir, "lis.sqlite"));
  db.saveConnection(
    {
      hisUrl: "https://his.test",
      encryptedRefreshToken: new Uint8Array([1]),
      fhirVersion: "5.0.0",
      lastCheckedAt: new Date().toISOString(),
    },
    "33333333-3333-4333-8333-333333333333",
  );
  const detail: any = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "active",
    result: null,
    testName: "Test",
    loincCode: "2345-7",
    patientName: "Иванов Иван",
    practitionerName: "Петрова Анна",
    authoredOn: "2026-11-10T10:00:00Z",
    patient: { id: "3" },
    practitioner: { id: "5" },
    expectedResult: {
      kind,
      unit: kind === "QUANTITY" ? "мг/дл" : null,
      unitCode: kind === "QUANTITY" ? "mg/dL" : null,
    },
  };
  return { db, requests: { details: vi.fn(async () => detail) } };
}

describe("result submission persistence", () => {
  it("encrypts PENDING before POST and atomically creates history after 201", async () => {
    const { db, requests } = setup();
    let pending = false;
    const connection: any = {
      fhirPost: vi.fn(async (_path: string, body: any) => {
        const saved = db.getSubmission(
          "33333333-3333-4333-8333-333333333333",
          body.basedOn[0].reference.slice(15),
        );
        pending =
          saved?.state === "PENDING" &&
          !Buffer.from(saved.observationCipher).toString().includes("Иванов");
        return {
          status: 201,
          body: {
            ...body,
            id: "22222222-2222-4222-8222-222222222222",
            issued: "2026-11-10T11:00:00Z",
          },
        };
      }),
    };
    const service = new SubmissionService(
      db,
      connection,
      requests as any,
      secrets,
    );
    await service.initializeEncryption();
    expect(
      (
        await service.submit({
          requestId: "11111111-1111-4111-8111-111111111111",
          value: " negative ",
        })
      ).state,
    ).toBe("COMPLETED");
    expect(pending).toBe(true);
    const history = await service.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.resultDisplay).toBe("negative");
    db.close();
  });

  it("normalizes a Russian decimal and preserves one stable identifier", async () => {
    const { db, requests } = setup("QUANTITY");
    let sent: any;
    const connection: any = {
      fhirPost: vi.fn(async (_path: string, body: any) => {
        sent = body;
        throw new Error("network");
      }),
    };
    const service = new SubmissionService(
      db,
      connection,
      requests as any,
      secrets,
    );
    expect(
      (
        await service.submit({
          requestId: "11111111-1111-4111-8111-111111111111",
          value: "101,125",
        })
      ).state,
    ).toBe("UNKNOWN");
    const row = db.getSubmission(
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
    )!;
    expect(sent.valueQuantity).toMatchObject({ value: 101.125, code: "mg/dL" });
    const identifier = row.identifierValue;
    await service.submit({ requestId: row.serviceRequestId, value: "999" });
    expect(
      db.getSubmission(row.connectionId, row.serviceRequestId)!.identifierValue,
    ).toBe(identifier);
    db.close();
  });

  it("does not POST when local preparation fails", async () => {
    const { db, requests } = setup("QUANTITY");
    const connection: any = { fhirPost: vi.fn() };
    const service = new SubmissionService(
      db,
      connection,
      requests as any,
      secrets,
    );
    await expect(
      service.submit({
        requestId: "11111111-1111-4111-8111-111111111111",
        value: "not-number",
      }),
    ).rejects.toThrow();
    expect(connection.fhirPost).not.toHaveBeenCalled();
    db.close();
  });
});
