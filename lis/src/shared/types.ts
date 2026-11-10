export interface ConnectionInput {
  hisUrl: string;
  apiKey: string;
}
export interface ConnectionStatus {
  state: "not-configured" | "connected" | "disconnected" | "error";
  hisUrl: string | null;
  fhirVersion: string | null;
  lastCheckedAt: string | null;
  message?: string;
}
export type RequestFilter = "all" | "active" | "completed";
export interface LabRequestSummary {
  id: string;
  testName: string;
  loincCode: string;
  patientName: string;
  practitionerName: string;
  authoredOn: string;
  status: "active" | "completed";
}
export interface LabRequestPage {
  items: LabRequestSummary[];
  total: number;
  nextOffset: number | null;
  loadedAt: string;
}
export interface LabRequestDetails extends LabRequestSummary {
  requisitionId: string | null;
  patient: {
    id: string;
    family: string;
    given: string[];
    birthDate: string | null;
    gender: string | null;
  };
  practitioner: {
    id: string;
    family: string;
    given: string[];
    active: boolean | null;
  };
  result: null | {
    id: string;
    kind: "TEXT" | "QUANTITY";
    textValue: string | null;
    quantityValue: string | null;
    unit: string | null;
    unitCode: string | null;
    effectiveAt: string | null;
    issued: string | null;
  };
  expectedResult: {
    kind: "TEXT" | "QUANTITY";
    unit: string | null;
    unitCode: string | null;
  };
}
export interface SubmissionResult {
  state: "COMPLETED" | "UNKNOWN" | "CONFLICT";
  message: string;
  historyId?: string;
}
export interface HistoryItem {
  id: string;
  serviceRequestId: string;
  observationId: string;
  testName: string;
  loincCode: string;
  patientName: string;
  practitionerName: string;
  resultDisplay: string;
  effectiveAt: string;
  issued: string;
  confirmedAt: string;
}
export interface PendingSubmission {
  id: string;
  serviceRequestId: string;
  state: "PENDING" | "UNKNOWN" | "CONFLICT";
  testName: string;
  patientName: string;
  createdValue: string;
}
export interface LisApi {
  getConnectionStatus(): Promise<ConnectionStatus>;
  configureConnection(input: ConnectionInput): Promise<ConnectionStatus>;
  testConnection(): Promise<ConnectionStatus>;
  disconnect(): Promise<ConnectionStatus>;
  listRequests(input: {
    filter: RequestFilter;
    offset: number;
  }): Promise<LabRequestPage>;
  getRequestDetails(id: string): Promise<LabRequestDetails>;
  submitResult(input: {
    requestId: string;
    value: string;
  }): Promise<SubmissionResult>;
  reconcileSubmission(requestId: string): Promise<SubmissionResult>;
  listHistory(): Promise<HistoryItem[]>;
  listPendingSubmissions(): Promise<PendingSubmission[]>;
  getHistoryDetails(id: string): Promise<HistoryItem>;
}
export const IPC = {
  status: "lis:connection-status",
  configure: "lis:configure-connection",
  test: "lis:test-connection",
  disconnect: "lis:disconnect",
  listRequests: "lis:list-requests",
  requestDetails: "lis:request-details",
  submitResult: "lis:submit-result",
  reconcile: "lis:reconcile-submission",
  history: "lis:list-history",
  pending: "lis:list-pending-submissions",
  historyDetails: "lis:history-details",
} as const;
