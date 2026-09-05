import { describe, it, expect } from 'vitest';
import { berechneNutzungsStatistik, NutzungsKonto } from '../src/utils/nutzungsStatistik.js';

const JETZT = new Date('2026-09-05T12:00:00.000Z');

const konto = (p: Partial<NutzungsKonto> & { id: number }): NutzungsKonto => ({
  createdAt: '2026-08-01T10:00:00.000Z',
  lastLoginAt: '2026-09-01T10:00:00.000Z',
  lastActivityAt: '2026-09-04T10:00:00.000Z',
  ohneZugang: false,
  kontaktpersonId: null,
  pushSubscriptions: [],
  webAuthnCredentials: [],
  ...p
});

describe('berechneNutzungsStatistik – Eckdaten', () => {
  it('trennt Konten mit und ohne Zugang', () => {
    const { eckdaten } = berechneNutzungsStatistik([
      konto({ id: 1 }),
      konto({ id: 2, ohneZugang: true, lastLoginAt: null, lastActivityAt: null }),
      konto({ id: 3, ohneZugang: true, kontaktpersonId: 9, lastLoginAt: null, lastActivityAt: null })
    ], [], JETZT);

    expect(eckdaten).toMatchObject({ konten: 3, mitZugang: 1, ohneZugang: 2, unerreichbar: 1 });
  });

  // Helfer ohne Zugang koennen sich gar nicht anmelden. Sie unter "nie
  // angemeldet" zu fuehren wuerde eine Zahl aufblaehen, die als Mahnung
  // gelesen wird.
  it('zählt nur Konten mit Zugang als „nie angemeldet"', () => {
    const { eckdaten } = berechneNutzungsStatistik([
      konto({ id: 1, lastLoginAt: null }),
      konto({ id: 2, ohneZugang: true, lastLoginAt: null })
    ], [], JETZT);
    expect(eckdaten.nieAngemeldet).toBe(1);
  });

  it('zählt Aktivität in den letzten 7 und 30 Tagen', () => {
    const { eckdaten } = berechneNutzungsStatistik([
      konto({ id: 1, lastActivityAt: '2026-09-04T10:00:00.000Z' }),   // gestern
      konto({ id: 2, lastActivityAt: '2026-08-20T10:00:00.000Z' }),   // 16 Tage her
      konto({ id: 3, lastActivityAt: '2026-06-01T10:00:00.000Z' }),   // lange her
      konto({ id: 4, lastActivityAt: null })
    ], [], JETZT);
    expect(eckdaten.aktivLetzte7Tage).toBe(1);
    expect(eckdaten.aktivLetzte30Tage).toBe(2);
  });
});

describe('berechneNutzungsStatistik – Erreichbarkeit', () => {
  it('teilt die Konten überschneidungsfrei auf', () => {
    const konten = [
      konto({ id: 1, pushSubscriptions: [{ id: 1 }, { id: 2 }] }),
      konto({ id: 2, pushSubscriptions: [{ id: 3 }] }),
      konto({ id: 3 }),
      konto({ id: 4, ohneZugang: true, kontaktpersonId: 1 }),
      konto({ id: 5, ohneZugang: true })
    ];
    const { erreichbarkeit } = berechneNutzungsStatistik(konten, [], JETZT);

    expect(erreichbarkeit).toEqual({
      perPush: 2, pushGeraete: 3, nurInDerApp: 1, ueberKontaktperson: 1, garNicht: 1
    });
    // Die Gruppen muessen zusammen alle Konten ergeben, sonst behauptet
    // "gar nicht" etwas Falsches.
    const summe = erreichbarkeit.perPush + erreichbarkeit.nurInDerApp
      + erreichbarkeit.ueberKontaktperson + erreichbarkeit.garNicht;
    expect(summe).toBe(konten.length);
  });
});

describe('berechneNutzungsStatistik – Anmeldeart', () => {
  it('unterscheidet Passkey, Passwort und nie angemeldet', () => {
    const { anmeldeart } = berechneNutzungsStatistik([
      konto({ id: 1, webAuthnCredentials: [{ id: 1 }] }),
      konto({ id: 2 }),
      konto({ id: 3, lastLoginAt: null })
    ], [], JETZT);
    expect(anmeldeart).toEqual({ mitPasskey: 1, nurPasswort: 1, nieAngemeldet: 1 });
  });
});

describe('berechneNutzungsStatistik – Tagesreihe', () => {
  it('zählt Registrierungen je Tag und führt die Summe mit', () => {
    const { tage } = berechneNutzungsStatistik([
      konto({ id: 1, createdAt: '2026-08-01T09:00:00.000Z' }),
      konto({ id: 2, createdAt: '2026-08-01T20:00:00.000Z' }),
      konto({ id: 3, createdAt: '2026-08-03T09:00:00.000Z' })
    ], [], JETZT);

    expect(tage.map(t => [t.datum, t.registrierungen, t.registrierungenKumuliert])).toEqual([
      ['2026-08-01', 2, 2],
      ['2026-08-02', 0, 2],
      ['2026-08-03', 1, 3]
    ]);
  });

  it('zählt aktive Personen je Tag, jede nur einmal', () => {
    const { tage } = berechneNutzungsStatistik(
      [konto({ id: 1, createdAt: '2026-08-01T09:00:00.000Z' })],
      [
        { userId: 1, tag: '2026-08-01', anmeldungen: 1 },
        { userId: 2, tag: '2026-08-01', anmeldungen: 0 },
        { userId: 1, tag: '2026-08-02', anmeldungen: 0 }
      ],
      JETZT
    );
    expect(tage.map(t => [t.datum, t.aktive, t.anmeldungen])).toEqual([
      ['2026-08-01', 2, 1],
      ['2026-08-02', 1, 0]
    ]);
  });

  // Vor der Einfuehrung gibt es keine Nutzungstage. Die Reihe zeigt dort 0
  // aktive Personen - das darf nicht als "niemand war da" gelesen werden,
  // deshalb steht der Beginn der Aufzeichnung getrennt daneben.
  it('nennt den Beginn der Aufzeichnung', () => {
    const s = berechneNutzungsStatistik(
      [konto({ id: 1, createdAt: '2026-07-01T09:00:00.000Z' })],
      [{ userId: 1, tag: '2026-09-04', anmeldungen: 0 }],
      JETZT
    );
    expect(s.aufzeichnungAb).toBe('2026-09-04');
    expect(s.tage[0]).toMatchObject({ datum: '2026-07-01', aktive: 0 });
  });

  it('liefert null, solange nichts aufgezeichnet wurde', () => {
    const s = berechneNutzungsStatistik([konto({ id: 1 })], [], JETZT);
    expect(s.aufzeichnungAb).toBeNull();
  });

  it('kommt ohne jedes Konto klar', () => {
    const s = berechneNutzungsStatistik([], [], JETZT);
    expect(s.tage).toEqual([]);
    expect(s.eckdaten.konten).toBe(0);
  });
});
