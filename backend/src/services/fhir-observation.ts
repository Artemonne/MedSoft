import { LabResultKind } from '@prisma/client';
import { FhirError } from '../fhir/outcome.js';
import { requireIntegerId, requireUuid } from '../fhir/search.js';
import type { FhirObservationCreateInput } from '../schemas/fhir-observation.js';
import type { ServiceAuthContext } from '../types/auth.js';
import { laboratoryService } from './laboratory.js';

function referenceId(reference: string, resourceType: 'Patient' | 'ServiceRequest'): string {
  const prefix = `${resourceType}/`;
  if (!reference.startsWith(prefix) || reference.slice(prefix.length).includes('/')) throw new FhirError(400, 'invalid', `Expected a relative ${resourceType} reference.`);
  return reference.slice(prefix.length);
}

export async function createFhirObservation(actor: ServiceAuthContext, input: FhirObservationCreateInput, conditional: boolean) {
  const patientId = requireIntegerId(referenceId(input.subject.reference, 'Patient'));
  const labOrderId = requireUuid(referenceId(input.basedOn[0].reference, 'ServiceRequest'));
  const coding = input.code.coding[0];
  if (coding.system !== 'http://loinc.org') throw new FhirError(400, 'code-invalid', 'Observation code must use the LOINC system.');
  const effectiveAt = new Date(input.effectiveDateTime);
  const resultInput = input.valueString !== undefined
    ? { resultKind: LabResultKind.TEXT, textValue: input.valueString, effectiveAt }
    : { resultKind: LabResultKind.QUANTITY, quantityValue: input.valueQuantity!.value, unitCode: input.valueQuantity!.code, effectiveAt };
  try {
    return await laboratoryService.createServiceResult(actor, labOrderId, { ...resultInput, identifier: input.identifier[0], patientId, loincCode: coding.code, conditional });
  } catch (error: any) {
    if (error?.status === 404) throw new FhirError(404, 'not-found', 'Referenced ServiceRequest was not found.');
    if (error?.status === 409) throw new FhirError(409, 'conflict', error.message);
    throw error;
  }
}
