import { LabResultKind, Sex, type LabOrder, type LabOrderBatch, type LabResult, type MedicalRecord, type MedicalWorker, type Patient } from '@prisma/client';
import { fhirBaseUrl } from './config.js';
import type { FhirResource, FhirResourceType, FhirSearch } from './types.js';

export function patientResource(patient: Patient): FhirResource { const given = [patient.firstName, patient.middleName].filter((item): item is string => Boolean(item)); const gender = patient.sex === Sex.MALE ? 'male' : patient.sex === Sex.FEMALE ? 'female' : 'unknown'; return { resourceType: 'Patient', id: String(patient.id), name: [{ family: patient.lastName, given }], gender, birthDate: patient.birthDate.toISOString().slice(0, 10) }; }
export function practitionerResource(worker: MedicalWorker): FhirResource { return { resourceType: 'Practitioner', id: String(worker.id), active: !worker.isDeleted, name: [{ family: worker.lastName, given: [worker.firstName, worker.middleName].filter((item): item is string => Boolean(item)) }] }; }

type OrderGraph = LabOrder & { result: LabResult | null; batch: LabOrderBatch & { medicalRecord: MedicalRecord } };
export function serviceRequestResource(order: OrderGraph): FhirResource { return { resourceType: 'ServiceRequest', id: order.id, status: order.result ? 'completed' : 'active', intent: 'order', requisition: { system: `${fhirBaseUrl()}/identifier/lab-order-batch`, value: order.batchId }, code: { concept: { coding: [{ system: 'http://loinc.org', code: order.loincCodeSnapshot, display: order.testNameSnapshot }], text: order.testNameSnapshot } }, subject: { reference: `Patient/${order.batch.medicalRecord.patientId}` }, requester: { reference: `Practitioner/${order.batch.requesterId}` }, authoredOn: order.orderedAt.toISOString() }; }

type ResultGraph = LabResult & { labOrder: OrderGraph };
export function observationResource(result: ResultGraph): FhirResource {
  const order = result.labOrder; const resource: FhirResource = { resourceType: 'Observation', id: result.id, status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }], code: { coding: [{ system: 'http://loinc.org', code: order.loincCodeSnapshot, display: order.testNameSnapshot }], text: order.testNameSnapshot }, subject: { reference: `Patient/${order.batch.medicalRecord.patientId}` }, basedOn: [{ reference: `ServiceRequest/${order.id}` }], effectiveDateTime: result.effectiveAt.toISOString(), issued: result.registeredAt.toISOString() };
  if (result.resultKind === LabResultKind.TEXT) resource.valueString = result.textValue;
  else resource.valueQuantity = { value: Number(result.quantityValue), ...(result.unitCode ? { unit: order.unitDisplaySnapshot ?? result.unitCode, system: 'http://unitsofmeasure.org', code: result.unitCode } : {}) };
  return resource;
}

export function searchBundle(resourceType: FhirResourceType, resources: FhirResource[], total: number, search: FhirSearch): FhirResource {
  const base = fhirBaseUrl(); const url = new URL(`${base}/${resourceType}`); const set = (key: string, value: unknown) => { if (value !== undefined) url.searchParams.set(key, String(value)); };
  set('_count', search.count); set('_offset', search.offset); set('_id', search.id); set('patient', search.patientId); set('status', search.status); set('based-on', search.basedOn);
  const links = [{ relation: 'self', url: url.toString() }];
  if (search.offset + resources.length < total) { const next = new URL(url); next.searchParams.set('_offset', String(search.offset + search.count)); links.push({ relation: 'next', url: next.toString() }); }
  return { resourceType: 'Bundle', type: 'searchset', total, link: links, entry: resources.map((resource) => ({ fullUrl: `${base}/${resource.resourceType}/${resource.id}`, resource, search: { mode: 'match' } })) };
}
