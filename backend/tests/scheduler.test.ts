import { describe, it, expect, vi } from 'vitest';

// Der Scheduler zieht beim Import den Prisma-Client und damit eine
// Datenbankverbindung nach. Geprueft wird hier reine Zeitrechnung.
vi.mock('../src/config/prisma.js', () => ({ default: {} }));

import { schichtZeitpunkte } from '../src/utils/scheduler.js';

const TAG = '2026-09-05T00:00:00.000Z';

describe('schichtZeitpunkte', () => {
  it('nimmt die eigene Zeit der Schicht', () => {
    const { beginn, ende } = schichtZeitpunkte({
      date: TAG,
      shift: { startMin: 16 * 60, endMin: 18 * 60, daySlot: null }
    });
    // 16:00 Ortszeit im September = 14:00 UTC
    expect(beginn?.toISOString()).toBe('2026-09-05T14:00:00.000Z');
    expect(ende?.toISOString()).toBe('2026-09-05T16:00:00.000Z');
  });

  // Der Fehler, wegen dem dieser Test existiert: Schichten ohne eigenes
  // start_min erben ihre Zeit vom Zeitfenster des Tages. Der Scheduler hat sie
  // frueher uebersprungen - fuer diese Helfer kam nie ein Reminder.
  it('faellt auf das Zeitfenster des Tages zurueck', () => {
    const { beginn, ende } = schichtZeitpunkte({
      date: TAG,
      shift: { startMin: null, endMin: null, daySlot: { startMin: 16 * 60, endMin: 18 * 60 } }
    });
    expect(beginn?.toISOString()).toBe('2026-09-05T14:00:00.000Z');
    expect(ende?.toISOString()).toBe('2026-09-05T16:00:00.000Z');
  });

  it('laesst die eigene Zeit vorgehen, wenn beide da sind', () => {
    const { beginn } = schichtZeitpunkte({
      date: TAG,
      shift: { startMin: 9 * 60, endMin: 11 * 60, daySlot: { startMin: 16 * 60, endMin: 18 * 60 } }
    });
    expect(beginn?.toISOString()).toBe('2026-09-05T07:00:00.000Z');
  });

  it('liefert null, wenn nirgends eine Zeit steht', () => {
    expect(schichtZeitpunkte({ date: TAG, shift: { startMin: null, endMin: null, daySlot: null } }))
      .toEqual({ beginn: null, ende: null });
  });

  it('liefert null ohne Schicht', () => {
    expect(schichtZeitpunkte({ date: TAG, shift: null })).toEqual({ beginn: null, ende: null });
  });

  // Der zweite Fehler: 16:00 als UTC gelesen ergibt einen Zeitpunkt, der zwei
  // Stunden zu spaet liegt - der 2-Stunden-Reminder faellt damit auf den
  // Schichtbeginn.
  it('liegt nicht auf dem naiven UTC-Zeitpunkt', () => {
    const { beginn } = schichtZeitpunkte({
      date: TAG, shift: { startMin: 16 * 60, endMin: 18 * 60, daySlot: null }
    });
    const naiv = new Date(Date.UTC(2026, 8, 5, 16, 0, 0));
    expect(beginn!.getTime()).toBe(naiv.getTime() - 2 * 3600 * 1000);
  });
});
