import { fhirBaseUrl } from './config.js';
const interactions = [{ code: 'read' }, { code: 'search-type' }];
export function capabilityStatement() { return { resourceType: 'CapabilityStatement', id: 'medsoft-r5', status: 'active', date: '2026-11-10', kind: 'instance', fhirVersion: '5.0.0', format: ['application/fhir+json'], implementation: { description: 'MedSoft HIS educational FHIR R5 endpoint', url: fhirBaseUrl() }, rest: [{ mode: 'server', security: { cors: false, description: 'TLS 1.3 with Bearer JWT authentication for active LIS service accounts. Tokens are issued by the MedSoft service login after API-key verification; OAuth and SMART App Launch are not implemented.' }, resource: [
  { type: 'Patient', interaction: interactions, searchParam: [{ name: '_id', type: 'token' }] },
  { type: 'Practitioner', interaction: interactions, searchParam: [{ name: '_id', type: 'token' }] },
  { type: 'ServiceRequest', interaction: interactions, searchParam: [{ name: '_id', type: 'token' }, { name: 'patient', type: 'reference' }, { name: 'status', type: 'token' }] },
  { type: 'Observation', interaction: [...interactions, { code: 'create' }], conditionalCreate: true, searchParam: [{ name: '_id', type: 'token' }, { name: 'patient', type: 'reference' }, { name: 'based-on', type: 'reference' }, { name: 'identifier', type: 'token' }] },
] }] }; }
