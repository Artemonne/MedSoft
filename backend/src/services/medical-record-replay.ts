import { MedicalRecordEventType, type Prisma } from '@prisma/client';
import { z } from 'zod';

export const diagnosisSnapshotSchema = z
  .object({
    diagnosisId: z.number().int().positive(),
    code: z.string(),
    name: z.string(),
  })
  .strict();

export const prescriptionSnapshotSchema = z
  .object({
    prescriptionId: z.string().uuid(),
    text: z.string(),
  })
  .strict();

export type DiagnosisSnapshot = z.infer<typeof diagnosisSnapshotSchema>;
export type PrescriptionSnapshot = z.infer<typeof prescriptionSnapshotSchema>;

export type ReplayableEvent = {
  type: MedicalRecordEventType;
  payload: Prisma.JsonValue;
};

export type MedicalRecordState = {
  diagnoses: DiagnosisSnapshot[];
  prescriptions: PrescriptionSnapshot[];
};

export function rebuildMedicalRecord(events: ReplayableEvent[]): MedicalRecordState {
  const state: MedicalRecordState = {
    diagnoses: [],
    prescriptions: [],
  };

  for (const event of events) {
    switch (event.type) {
      case MedicalRecordEventType.DIAGNOSIS_ADDED: {
        const diagnosis = diagnosisSnapshotSchema.parse(event.payload);
        state.diagnoses = [
          ...state.diagnoses.filter((item) => item.diagnosisId !== diagnosis.diagnosisId),
          diagnosis,
        ];
        break;
      }
      case MedicalRecordEventType.DIAGNOSIS_REMOVED: {
        const diagnosis = diagnosisSnapshotSchema.parse(event.payload);
        state.diagnoses = state.diagnoses.filter(
          (item) => item.diagnosisId !== diagnosis.diagnosisId,
        );
        break;
      }
      case MedicalRecordEventType.PRESCRIPTION_ADDED: {
        const prescription = prescriptionSnapshotSchema.parse(event.payload);
        state.prescriptions = [
          ...state.prescriptions.filter(
            (item) => item.prescriptionId !== prescription.prescriptionId,
          ),
          prescription,
        ];
        break;
      }
      case MedicalRecordEventType.PRESCRIPTION_REMOVED: {
        const prescription = prescriptionSnapshotSchema.parse(event.payload);
        state.prescriptions = state.prescriptions.filter(
          (item) => item.prescriptionId !== prescription.prescriptionId,
        );
        break;
      }
    }
  }

  return state;
}
