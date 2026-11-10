import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { FhirError } from './outcome.js';
import { observationResource, patientResource, practitionerResource, searchBundle, serviceRequestResource } from './mappers.js';
import type { FhirResourceType, FhirSearch } from './types.js';

const orderInclude = { result: true, batch: { include: { medicalRecord: true } } } as const;
const resultInclude = { labOrder: { include: orderInclude } } as const;
function missing(type: FhirResourceType): never { throw new FhirError(404, 'not-found', `${type} resource not found.`); }
export const fhirRepository = {
  async patient(id: number) { const item = await prisma.patient.findUnique({ where: { id } }); return item ? patientResource(item) : missing('Patient'); },
  async patients(search: FhirSearch) { const where: Prisma.PatientWhereInput = search.id ? { id: Number(search.id) } : {}; const [items, total] = await prisma.$transaction([prisma.patient.findMany({ where, orderBy: { id: 'asc' }, skip: search.offset, take: search.count }), prisma.patient.count({ where })]); return searchBundle('Patient', items.map(patientResource), total, search); },
  async practitioner(id: number) { const item = await prisma.medicalWorker.findUnique({ where: { id } }); return item ? practitionerResource(item) : missing('Practitioner'); },
  async practitioners(search: FhirSearch) { const where: Prisma.MedicalWorkerWhereInput = search.id ? { id: Number(search.id) } : {}; const [items, total] = await prisma.$transaction([prisma.medicalWorker.findMany({ where, orderBy: { id: 'asc' }, skip: search.offset, take: search.count }), prisma.medicalWorker.count({ where })]); return searchBundle('Practitioner', items.map(practitionerResource), total, search); },
  async serviceRequest(id: string) { const item = await prisma.labOrder.findUnique({ where: { id }, include: orderInclude }); return item ? serviceRequestResource(item) : missing('ServiceRequest'); },
  async serviceRequests(search: FhirSearch) { const where: Prisma.LabOrderWhereInput = { ...(search.id ? { id: search.id } : {}), ...(search.patientId ? { batch: { medicalRecord: { patientId: search.patientId } } } : {}), ...(search.status === 'active' ? { result: null } : search.status === 'completed' ? { result: { isNot: null } } : {}) }; const [items, total] = await prisma.$transaction([prisma.labOrder.findMany({ where, include: orderInclude, orderBy: { id: 'asc' }, skip: search.offset, take: search.count }), prisma.labOrder.count({ where })]); return searchBundle('ServiceRequest', items.map(serviceRequestResource), total, search); },
  async observation(id: string) { const item = await prisma.labResult.findUnique({ where: { id }, include: resultInclude }); return item ? observationResource(item) : missing('Observation'); },
  async observations(search: FhirSearch) { const where: Prisma.LabResultWhereInput = { ...(search.id ? { id: search.id } : {}), ...(search.patientId ? { labOrder: { batch: { medicalRecord: { patientId: search.patientId } } } } : {}), ...(search.basedOn ? { labOrderId: search.basedOn } : {}), ...(search.identifierSystem && search.identifierValue ? { identifierSystem: search.identifierSystem, identifierValue: search.identifierValue } : {}) }; const [items, total] = await prisma.$transaction([prisma.labResult.findMany({ where, include: resultInclude, orderBy: { id: 'asc' }, skip: search.offset, take: search.count }), prisma.labResult.count({ where })]); return searchBundle('Observation', items.map(observationResource), total, search); },
};
