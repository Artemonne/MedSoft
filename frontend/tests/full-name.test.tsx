import { describe, expect, it } from 'vitest';
import { fullName } from '../src/utils/full-name';

describe('worker full name', () => {
  it.each([null, undefined, '', '   '])('omits an absent middle name (%s)', (middleName) => {
    expect(fullName({ lastName: 'Иванов', firstName: 'Иван', middleName })).toBe('Иванов Иван');
  });
  it('uses surname, first name, middle name order without extra spaces', () => {
    expect(fullName({ lastName: ' Иванов ', firstName: ' Иван ', middleName: ' Иванович ' })).toBe('Иванов Иван Иванович');
  });
});
