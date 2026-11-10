import { describe, expect, it } from 'vitest';
import { capabilityStatement } from '../src/fhir/capability.js';
import { operationOutcome } from '../src/fhir/outcome.js';
import { parseFhirSearch } from '../src/fhir/search.js';
describe('FHIR R5 HTTP primitives', () => {
  it('advertises only read and search-type for FHIR 5.0.0', () => { const capability = capabilityStatement(); expect(capability.fhirVersion).toBe('5.0.0'); expect(capability.rest[0].resource.flatMap((item) => item.interaction.map((interaction) => interaction.code))).not.toContain('create'); });
  it('parses bounded search input and rejects unsupported parameters', () => { const parsed = parseFhirSearch({ query: { _count: '10', _offset: '20', patient: 'Patient/7', status: 'active' } } as any, 'ServiceRequest'); expect(parsed).toMatchObject({ count: 10, offset: 20, patientId: 7, status: 'active' }); expect(() => parseFhirSearch({ query: { name: 'ignored' } } as any, 'Patient')).toThrow(/not supported/); });
  it('creates a FHIR OperationOutcome', () => { expect(operationOutcome('not-found', 'Resource not found')).toEqual({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Resource not found' }] }); });
});
