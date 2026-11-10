import type { Request, Response } from 'express';
import { capabilityStatement } from '../fhir/capability.js';
import { sendFhir } from '../fhir/outcome.js';
import { fhirRepository } from '../fhir/repository.js';
import { parseFhirSearch, requireIntegerId, requireUuid } from '../fhir/search.js';
function idParam(request: Request): string { const value = request.params.id; return Array.isArray(value) ? value[0] : value; }
export const fhirController = {
  metadata(_request: Request, response: Response) { sendFhir(response, capabilityStatement()); },
  async patients(request: Request, response: Response) { sendFhir(response, await fhirRepository.patients(parseFhirSearch(request, 'Patient'))); },
  async patient(request: Request, response: Response) { sendFhir(response, await fhirRepository.patient(requireIntegerId(idParam(request)))); },
  async practitioners(request: Request, response: Response) { sendFhir(response, await fhirRepository.practitioners(parseFhirSearch(request, 'Practitioner'))); },
  async practitioner(request: Request, response: Response) { sendFhir(response, await fhirRepository.practitioner(requireIntegerId(idParam(request)))); },
  async serviceRequests(request: Request, response: Response) { sendFhir(response, await fhirRepository.serviceRequests(parseFhirSearch(request, 'ServiceRequest'))); },
  async serviceRequest(request: Request, response: Response) { sendFhir(response, await fhirRepository.serviceRequest(requireUuid(idParam(request)))); },
  async observations(request: Request, response: Response) { sendFhir(response, await fhirRepository.observations(parseFhirSearch(request, 'Observation'))); },
  async observation(request: Request, response: Response) { sendFhir(response, await fhirRepository.observation(requireUuid(idParam(request)))); },
};
