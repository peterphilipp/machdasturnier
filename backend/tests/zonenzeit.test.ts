import { describe, it, expect } from 'vitest';
import { zeitpunktOrtszeit } from '../src/utils/zonenzeit.js';

/**
 * Der Fehler, den diese Tests festhalten: "16:00" im Dienstplan ist Ortszeit
 * in Holm, nicht 16:00 UTC. Wer das verwechselt, bekommt einen Zeitpunkt, der
 * fuer sich genommen voellig plausibel aussieht - und einen Reminder, der im
 * Sommer zwei Stunden zu spaet rausgeht.
 */
describe('zeitpunktOrtszeit', () => {
  it('rechnet eine Sommerzeit-Uhrzeit korrekt nach UTC', () => {
    // 5. September: MESZ, UTC+2. 16:00 in Holm = 14:00 UTC.
    const t = zeitpunktOrtszeit('2026-09-05T00:00:00.000Z', 16 * 60);
    expect(t.toISOString()).toBe('2026-09-05T14:00:00.000Z');
  });

  it('rechnet eine Winterzeit-Uhrzeit korrekt nach UTC', () => {
    // 5. Januar: MEZ, UTC+1. 16:00 in Holm = 15:00 UTC.
    const t = zeitpunktOrtszeit('2026-01-05T00:00:00.000Z', 16 * 60);
    expect(t.toISOString()).toBe('2026-01-05T15:00:00.000Z');
  });

  it('trifft Mitternacht', () => {
    const t = zeitpunktOrtszeit('2026-09-05T00:00:00.000Z', 0);
    expect(t.toISOString()).toBe('2026-09-04T22:00:00.000Z');
  });

  it('kommt mit dem Tag der Umstellung auf Sommerzeit klar', () => {
    // 29.03.2026: um 02:00 wird auf 03:00 vorgestellt.
    // 01:00 liegt noch in MEZ (UTC+1), 04:00 schon in MESZ (UTC+2).
    expect(zeitpunktOrtszeit('2026-03-29T00:00:00.000Z', 60).toISOString())
      .toBe('2026-03-29T00:00:00.000Z');
    expect(zeitpunktOrtszeit('2026-03-29T00:00:00.000Z', 4 * 60).toISOString())
      .toBe('2026-03-29T02:00:00.000Z');
  });

  it('kommt mit dem Tag der Umstellung auf Winterzeit klar', () => {
    // 25.10.2026: um 03:00 wird auf 02:00 zurueckgestellt.
    expect(zeitpunktOrtszeit('2026-10-25T00:00:00.000Z', 60).toISOString())
      .toBe('2026-10-24T23:00:00.000Z');
    expect(zeitpunktOrtszeit('2026-10-25T00:00:00.000Z', 6 * 60).toISOString())
      .toBe('2026-10-25T05:00:00.000Z');
  });

  it('nimmt den Kalendertag aus dem Datum und ignoriert dessen Uhrzeit', () => {
    const a = zeitpunktOrtszeit('2026-09-05T00:00:00.000Z', 9 * 60);
    const b = zeitpunktOrtszeit(new Date('2026-09-05T11:37:00.000Z'), 9 * 60);
    expect(b.toISOString()).toBe(a.toISOString());
  });

  it('haengt nicht an der Zeitzone des Servers', () => {
    // Der Aufruf darf nirgends auf die lokale Zone des Prozesses zurueckfallen.
    const vorher = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      expect(zeitpunktOrtszeit('2026-09-05T00:00:00.000Z', 16 * 60).toISOString())
        .toBe('2026-09-05T14:00:00.000Z');
    } finally {
      process.env.TZ = vorher;
    }
  });
});
