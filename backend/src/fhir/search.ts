import type { Request } from 'express';
import { FhirError } from './outcome.js';
import type { FhirResourceType, FhirSearch } from './types.js';

const common = new Set(['_count', '_offset', '_id']);
const allowed: Record<FhirResourceType, Set<string>> = {
  Patient: common, Practitioner: common,
  ServiceRequest: new Set([...common, 'patient', 'status']),
  Observation: new Set([...common, 'patient', 'based-on', 'identifier']),
};
function single(query: Request['query'], name: string): string | undefined { const value = query[name]; if (value === undefined) return undefined; if (typeof value !== 'string' || !value) throw new FhirError(400, 'invalid', `Invalid ${name} search parameter.`); return value; }
function positiveInt(value: string, name: string, minimum: number, maximum: number) { if (!/^\d+$/.test(value)) throw new FhirError(400, 'invalid', `Invalid ${name} search parameter.`); const parsed = Number(value); if (parsed < minimum || parsed > maximum) throw new FhirError(400, 'invalid', `${name} must be between ${minimum} and ${maximum}.`); return parsed; }
function patientReference(value: string) { const raw = value.startsWith('Patient/') ? value.slice(8) : value; return positiveInt(raw, 'patient', 1, Number.MAX_SAFE_INTEGER); }
export function parseFhirSearch(request: Request, resourceType: FhirResourceType): FhirSearch {
  for (const key of Object.keys(request.query)) if (!allowed[resourceType].has(key)) throw new FhirError(400, 'not-supported', `Search parameter ${key} is not supported.`);
  const count = single(request.query, '_count'); const offset = single(request.query, '_offset'); const id = single(request.query, '_id');
  if (id) resourceType === 'Patient' || resourceType === 'Practitioner' ? requireIntegerId(id) : requireUuid(id);
  const result: FhirSearch = { count: count ? positiveInt(count, '_count', 1, 100) : 20, offset: offset ? positiveInt(offset, '_offset', 0, 1_000_000) : 0, ...(id ? { id } : {}) };
  const patient = single(request.query, 'patient'); if (patient) result.patientId = patientReference(patient);
  const status = single(request.query, 'status'); if (status) { if (status !== 'active' && status !== 'completed') throw new FhirError(400, 'invalid', 'ServiceRequest status must be active or completed.'); result.status = status; }
  const basedOn = single(request.query, 'based-on'); if (basedOn) result.basedOn = requireUuid(basedOn.startsWith('ServiceRequest/') ? basedOn.slice(15) : basedOn);
  const identifier = single(request.query, 'identifier'); if (identifier) { const separator = identifier.indexOf('|'); if (separator <= 0 || separator !== identifier.lastIndexOf('|') || separator === identifier.length - 1) throw new FhirError(400, 'invalid', 'Identifier search requires an exact system|value token.'); result.identifierSystem = identifier.slice(0, separator); result.identifierValue = identifier.slice(separator + 1); }
  return result;
}
export function requireIntegerId(value: string) { return positiveInt(value, 'id', 1, Number.MAX_SAFE_INTEGER); }
export function requireUuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new FhirError(400, 'invalid', 'Invalid FHIR resource id.'); return value; }
