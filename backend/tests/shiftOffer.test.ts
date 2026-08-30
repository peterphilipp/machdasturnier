import { describe, it, expect } from 'vitest';
import { shiftOfferSchema, entscheidungSchema } from '../src/controllers/shiftOffer.controller.js';

const gueltig = {
  tournamentId: 1,
  date: '2026-09-05T00:00:00.000Z',
  startMin: 540,
  endMin: 720
};

describe('shiftOfferSchema', () => {
  it('nimmt ein freies Zeitangebot ohne Schichtbezug an', () => {
    const r = shiftOfferSchema.safeParse(gueltig);
    expect(r.success).toBe(true);
  });

  it('nimmt ein Angebot mit Bezug auf eine konkrete Schicht an', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, shiftId: 42, note: 'nur bis 12' }).success).toBe(true);
  });

  // workAreaId ist der Wunsch-Bereich, unabhaengig von einer konkreten Schicht -
  // beide Bezuege duerfen gleichzeitig fehlen, vorkommen oder kombiniert sein.
  it('nimmt einen Wunsch-Arbeitsbereich unabhängig von shiftId an', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaId: 7 }).success).toBe(true);
    expect(shiftOfferSchema.safeParse({ ...gueltig, shiftId: 42, workAreaId: 7 }).success).toBe(true);
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaId: null }).success).toBe(true);
  });

  // Der haeufigste Fehlgriff im Formular: Von und Bis vertauscht.
  it('weist eine Endzeit vor der Startzeit zurück', () => {
    const r = shiftOfferSchema.safeParse({ ...gueltig, startMin: 720, endMin: 540 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/Endzeit/);
  });

  it('weist einen Zeitraum ohne Dauer zurück', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, startMin: 600, endMin: 600 }).success).toBe(false);
  });

  it('weist Zeiten ausserhalb eines Tages zurück', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, startMin: -1 }).success).toBe(false);
    expect(shiftOfferSchema.safeParse({ ...gueltig, endMin: 1441 }).success).toBe(false);
  });

  it('begrenzt die Anmerkung', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, note: 'x'.repeat(501) }).success).toBe(false);
    expect(shiftOfferSchema.safeParse({ ...gueltig, note: 'x'.repeat(500) }).success).toBe(true);
  });

  // Mass-Assignment: Der Status darf nicht vom Client kommen, sonst legt sich
  // jemand sein eigenes Angebot gleich als angenommen an.
  it('verwirft einen mitgeschickten Status', () => {
    const r = shiftOfferSchema.safeParse({ ...gueltig, status: 'ANGENOMMEN' });
    expect(r.success).toBe(true);
    if (r.success) expect('status' in r.data).toBe(false);
  });
});

describe('entscheidungSchema', () => {
  it('lässt nur die beiden vorgesehenen Entscheidungen zu', () => {
    expect(entscheidungSchema.safeParse({ status: 'ANGENOMMEN' }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ status: 'ABGELEHNT' }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ status: 'OFFEN' }).success).toBe(false);
    expect(entscheidungSchema.safeParse({ status: 'VIELLEICHT' }).success).toBe(false);
  });

  it('nimmt eine optionale Rückmeldung an', () => {
    expect(entscheidungSchema.safeParse({ status: 'ABGELEHNT', decisionNote: 'diesmal voll' }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ status: 'ABGELEHNT', decisionNote: null }).success).toBe(true);
  });
});
