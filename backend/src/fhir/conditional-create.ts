import { FhirError } from './outcome.js';
export interface FhirIdentifier { system: string; value: string; }
export function parseIfNoneExist(header: string | undefined, bodyIdentifier: FhirIdentifier): boolean {
  if (header === undefined) return false;
  let entries: [string, string][];
  try { entries = [...new URLSearchParams(header).entries()]; } catch { throw new FhirError(400, 'invalid', 'Invalid If-None-Exist condition.'); }
  if (entries.length !== 1 || entries[0][0] !== 'identifier') throw new FhirError(400, 'invalid', 'Only one exact identifier conditional create is supported.');
  const value = entries[0][1]; const separator = value.indexOf('|');
  if (separator <= 0 || separator !== value.lastIndexOf('|') || separator === value.length - 1) throw new FhirError(400, 'invalid', 'Conditional identifier must contain system and value.');
  if (value.slice(0, separator) !== bodyIdentifier.system || value.slice(separator + 1) !== bodyIdentifier.value) throw new FhirError(400, 'invalid', 'Conditional identifier must match the Observation identifier.');
  return true;
}
