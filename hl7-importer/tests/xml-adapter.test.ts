import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemoXmlAdapter } from '../src/main/xml/demo-adapter.js';

describe('DemoXmlAdapter', () => {
  const adapter = new DemoXmlAdapter();

  it('reads multiple UTF-8 patients and Cyrillic fields from the explicit demo fixture', () => {
    const fixture = readFileSync(new URL('../../docs/lab4/demo-patients.xml', import.meta.url));
    const result = adapter.parse(fixture, 'demo-patients.xml');
    expect(result.demonstrationFormat).toBe(true);
    expect(result.patients).toHaveLength(2);
    expect(result.patients[0]).toMatchObject({ externalId: 'DEMO-001', firstName: 'Анна', lastName: 'Иванова', address: 'Москва, улица Тестовая, 1' });
    expect(result.patients[1]?.diagnoses[1]).toEqual({ code: 'C00003', name: 'Текст с & и кириллицей' });
  });

  it('rejects malformed XML and DTD/entity declarations', () => {
    expect(() => adapter.parse(Buffer.from('<medsoft-demo-patients><patient>'))).toThrow('Некорректный XML');
    expect(() => adapter.parse(Buffer.from('<!DOCTYPE x [<!ENTITY remote SYSTEM "https://example.test/x">]><medsoft-demo-patients/>'))).toThrow('DTD и внешние сущности');
  });

  it('keeps valid records when another record is damaged', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><medsoft-demo-patients>
      <patient externalId="GOOD-1"><firstName>Иван</firstName><lastName>Петров</lastName><birthDate>2000-01-02</birthDate><sex>MALE</sex></patient>
      <patient externalId="BAD-1"><firstName>Bad</firstName><birthDate>not-a-date</birthDate><sex>MALE</sex></patient>
    </medsoft-demo-patients>`;
    const result = adapter.parse(Buffer.from(xml));
    expect(result.patients.map((patient) => patient.externalId)).toEqual(['GOOD-1']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Запись 2');
  });
});
