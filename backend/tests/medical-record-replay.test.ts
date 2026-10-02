import { MedicalRecordEventType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { rebuildMedicalRecord } from '../src/services/medical-record-replay.js';

describe('rebuildMedicalRecord', () => {
  it('replays diagnosis and prescription events in the supplied stream order', () => {
    const diagnosis = { diagnosisId: 10, code: 'ABC123', name: 'Example' };
    const oldPrescription = {
      prescriptionId: '11111111-1111-4111-8111-111111111111',
      text: 'Old prescription',
    };
    const newPrescription = {
      prescriptionId: '22222222-2222-4222-8222-222222222222',
      text: 'New prescription',
    };

    const state = rebuildMedicalRecord([
      { type: MedicalRecordEventType.DIAGNOSIS_ADDED, payload: diagnosis },
      { type: MedicalRecordEventType.PRESCRIPTION_ADDED, payload: oldPrescription },
      { type: MedicalRecordEventType.PRESCRIPTION_REMOVED, payload: oldPrescription },
      { type: MedicalRecordEventType.PRESCRIPTION_ADDED, payload: newPrescription },
      { type: MedicalRecordEventType.DIAGNOSIS_REMOVED, payload: diagnosis },
    ]);

    expect(state).toEqual({
      diagnoses: [],
      prescriptions: [newPrescription],
    });
  });
});
