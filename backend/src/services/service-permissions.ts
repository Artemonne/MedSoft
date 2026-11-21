import { ServiceAccountRole } from '@prisma/client';
export type ServiceResource = 'Patient' | 'Practitioner' | 'ServiceRequest' | 'Observation';
export type ServiceOperation = 'read' | 'create' | 'update' | 'delete';
const lisPermissions = new Set(['Patient:read', 'Practitioner:read', 'ServiceRequest:read', 'Observation:read', 'Observation:create']);
export function serviceRoleAllows(role: ServiceAccountRole, resource: ServiceResource, operation: ServiceOperation): boolean { return role === ServiceAccountRole.LIS && lisPermissions.has(`${resource}:${operation}`); }
export function serviceRoleAllowsHl7Import(role: ServiceAccountRole): boolean { return role === ServiceAccountRole.HL7_IMPORT; }
