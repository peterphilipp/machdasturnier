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

  // Die Wunsch-Bereiche sind eine Liste: wer sich drei Aufgaben vorstellen kann,
  // soll das sagen duerfen. Leer heisst "egal".
  it('nimmt mehrere Wunsch-Arbeitsbereiche an', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: [7] }).success).toBe(true);
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: [7, 8, 9] }).success).toBe(true);
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: [] }).success).toBe(true);
    expect(shiftOfferSchema.safeParse({ ...gueltig, shiftId: 42, workAreaIds: [7] }).success).toBe(true);
  });

  it('weist unbrauchbare Bereichs-Angaben zurück', () => {
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: [0] }).success).toBe(false);
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: [-3] }).success).toBe(false);
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: 7 }).success).toBe(false);
    // Obergrenze, damit niemand die Zuordnungstabelle vollschreibt
    expect(shiftOfferSchema.safeParse({ ...gueltig, workAreaIds: Array.from({ length: 21 }, (_, i) => i + 1) }).success).toBe(false);
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

  // Der Bereich ist optional - eine Zusage "egal wo gebraucht" bleibt moeglich.
  it('nimmt einen optionalen Bereich an', () => {
    expect(entscheidungSchema.safeParse({ status: 'ANGENOMMEN', bereichId: 3 }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ status: 'ANGENOMMEN', bereichId: null }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ status: 'ANGENOMMEN' }).success).toBe(true);
  });

  it('weist einen unbrauchbaren Bereich zurück', () => {
    expect(entscheidungSchema.safeParse({ status: 'ANGENOMMEN', bereichId: 0 }).success).toBe(false);
    expect(entscheidungSchema.safeParse({ status: 'ANGENOMMEN', bereichId: -1 }).success).toBe(false);
  });
});
