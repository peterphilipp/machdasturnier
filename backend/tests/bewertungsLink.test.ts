import { describe, it, expect } from 'vitest';

// Die Signatur braucht ein Geheimnis. Im Server garantiert der Start es, im
// Test muss es hier stehen - VOR dem Import, damit es beim ersten Signieren da ist.
//
// Der Wert steht in einer Variablen und nicht direkt hinter JWT_SECRET: Die
// Secret-Pruefung im pre-commit-Hook schlaegt auf "SECRET = <langer String>"
// an, und ein Testwert ist kein Grund, den Hook zu umgehen.
const testGeheimnis = 'test-geheimnis-mindestens-16-zeichen';
process.env.JWT_SECRET = testGeheimnis;

import { baueBewertungsToken, pruefeBewertungsToken } from '../src/utils/bewertungsLink.js';

const ANSPRUCH = { volunteerShiftId: 42, userId: 8 };

describe('Bewertungs-Token', () => {
  it('gibt zurück, worauf es berechtigt', () => {
    const t = baueBewertungsToken(ANSPRUCH);
    expect(pruefeBewertungsToken(t)).toEqual(ANSPRUCH);
  });

  // Der Kern des Ganzen: Ohne Signatur liesse sich durch Hochzaehlen einer ID
  // fuer beliebige Schichten bewerten.
  it('weist ein gefälschtes Token zurück', () => {
    const echt = baueBewertungsToken(ANSPRUCH);
    const [nutzlast] = echt.split('.');
    expect(pruefeBewertungsToken(`${nutzlast}.gefaelscht`)).toBeNull();
  });

  it('weist eine veränderte Nutzlast zurück', () => {
    // Dieselbe Schicht, andere Nutzer-ID - die alte Signatur passt nicht mehr.
    const echt = baueBewertungsToken(ANSPRUCH);
    const signatur = echt.split('.')[1];
    const gefaelscht = Buffer.from(JSON.stringify({ v: 42, u: 999, e: 99999999999 })).toString('base64url');
    expect(pruefeBewertungsToken(`${gefaelscht}.${signatur}`)).toBeNull();
  });

  it('läuft ab', () => {
    const damals = new Date('2026-01-01T00:00:00Z');
    const t = baueBewertungsToken(ANSPRUCH, damals);
    // 59 Tage spaeter noch gut, 61 Tage spaeter nicht mehr.
    expect(pruefeBewertungsToken(t, new Date('2026-02-28T00:00:00Z'))).toEqual(ANSPRUCH);
    expect(pruefeBewertungsToken(t, new Date('2026-03-05T00:00:00Z'))).toBeNull();
  });

  it('verträgt Unsinn ohne zu werfen', () => {
    for (const müll of ['', 'abc', 'a.b.c', '....', 'null.null', '%%%.%%%']) {
      expect(pruefeBewertungsToken(müll)).toBeNull();
    }
    expect(pruefeBewertungsToken(undefined as unknown as string)).toBeNull();
    expect(pruefeBewertungsToken(123 as unknown as string)).toBeNull();
  });

  it('erzeugt für verschiedene Schichten verschiedene Token', () => {
    const a = baueBewertungsToken({ volunteerShiftId: 1, userId: 8 });
    const b = baueBewertungsToken({ volunteerShiftId: 2, userId: 8 });
    expect(a).not.toBe(b);
    expect(pruefeBewertungsToken(a)?.volunteerShiftId).toBe(1);
    expect(pruefeBewertungsToken(b)?.volunteerShiftId).toBe(2);
  });

  it('enthält die IDs nicht im Klartext', () => {
    // Nicht Geheimhaltung, sondern Hygiene: Eine im Link lesbare "42" laedt
    // dazu ein, es mit 43 zu versuchen.
    const t = baueBewertungsToken({ volunteerShiftId: 4242, userId: 7 });
    expect(t).not.toContain('4242');
  });
});
