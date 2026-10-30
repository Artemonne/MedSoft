export function fullName(person: { lastName: string; firstName: string; middleName?: string | null }): string {
  return [person.lastName, person.firstName, person.middleName].map((part) => part?.trim()).filter(Boolean).join(' ');
}
