export type FhirResourceType = 'Patient' | 'Practitioner' | 'ServiceRequest' | 'Observation';
export interface FhirResource { resourceType: string; id?: string; [key: string]: unknown; }
export interface FhirSearch { count: number; offset: number; id?: string; patientId?: number; status?: 'active' | 'completed'; basedOn?: string; identifierSystem?: string; identifierValue?: string; }
