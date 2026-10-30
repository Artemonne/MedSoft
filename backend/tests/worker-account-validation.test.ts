import { describe, expect, it } from 'vitest';
import { createMedicalWorkerSchema, updateMedicalWorkerSchema } from '../src/schemas/medical-worker.js';
import { createAccountSchema } from '../src/schemas/admin-account.js';
import { loginSchema } from '../src/schemas/auth.js';

describe('worker middle name validation', () => {
  const worker = { firstName: 'Иван', lastName: 'Иванов', position: 'Терапевт' };
  for (const schema of [createMedicalWorkerSchema, updateMedicalWorkerSchema]) {
    it('accepts omitted and nullable middle names, normalizes blanks, and limits length', () => {
      expect(schema.parse(worker)).not.toHaveProperty('middleName');
      expect(schema.parse({ ...worker, middleName: null }).middleName).toBeNull();
      expect(schema.parse({ ...worker, middleName: '   ' }).middleName).toBeNull();
      expect(schema.parse({ ...worker, middleName: ' Иванович ' }).middleName).toBe('Иванович');
      expect(schema.safeParse({ ...worker, middleName: 'а'.repeat(24) }).success).toBe(true);
      expect(schema.safeParse({ ...worker, middleName: 'а'.repeat(25) }).success).toBe(false);
    });
  }
});

describe('username boundaries for account creation and login', () => {
  for (const schema of [createAccountSchema, loginSchema]) {
    it.each([2, 3, 16, 17, 32, 33])('validates %i characters', (length) => {
      const body = { username: 'a'.repeat(length), medicalWorkerId: 1, password: 'password' };
      const input = schema === createAccountSchema
        ? { username: body.username, medicalWorkerId: body.medicalWorkerId }
        : { username: body.username, password: body.password };
      expect(schema.safeParse(input).success).toBe(length >= 3 && length <= 32);
    });
  }
});
