const DEFAULT_BASE_URL = 'https://localhost:3000/api/fhir/r5';
export function fhirBaseUrl(): string {
  const raw = process.env.FHIR_PUBLIC_BASE_URL ?? DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.search || url.hash) throw new Error('FHIR_PUBLIC_BASE_URL must be an HTTPS URL without query or fragment.');
  return url.toString().replace(/\/$/, '');
}
