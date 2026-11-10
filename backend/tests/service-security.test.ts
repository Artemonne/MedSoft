import { ServiceAccountRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { generateServiceApiKey, parseServiceApiKey, serviceApiHashMatches } from '../src/lib/service-api-key.js';
import { serviceRoleAllows, type ServiceOperation, type ServiceResource } from '../src/services/service-permissions.js';
describe('service account security primitives', () => {
  it('generates and verifies a high-entropy API key', () => { const key = generateServiceApiKey(); const parsed = parseServiceApiKey(key.apiKey)!; expect(parsed.keyId).toBe(key.keyId); expect(parsed.secret).toHaveLength(43); expect(serviceApiHashMatches(key.apiKeyHash, parsed.secret)).toBe(true); expect(serviceApiHashMatches(key.apiKeyHash, 'x'.repeat(43))).toBe(false); });
  it('implements the LIS allowlist with default deny', () => { const resources: ServiceResource[] = ['Patient', 'Practitioner', 'ServiceRequest', 'Observation']; const operations: ServiceOperation[] = ['read', 'create', 'update', 'delete']; const allowed = resources.flatMap((resource) => operations.filter((operation) => serviceRoleAllows(ServiceAccountRole.LIS, resource, operation)).map((operation) => `${resource}:${operation}`)); expect(allowed).toEqual(['Patient:read', 'Practitioner:read', 'ServiceRequest:read', 'Observation:read', 'Observation:create']); });
});
