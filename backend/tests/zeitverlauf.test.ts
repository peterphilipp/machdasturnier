import { describe, it, expect } from 'vitest';
import { berechneZeitverlauf, reaktionAufAufruf, chronik, VerlaufAufruf } from '../src/utils/zeitverlauf.js';

const e = (iso: string | null) => ({ createdAt: iso });
const aufruf = (id: number, iso: string, titel = 'Bitte helft mit'): VerlaufAufruf =>
  ({ id, titel, empfaenger: 'all', erreicht: 12, createdAt: iso });

describe('berechneZeitverlauf', () => {
  it('zählt Zusagen und Spenden je Tag', () => {
    const { tage } = berechneZeitverlauf(
      [e('2026-08-01T10:00:00Z'), e('2026-08-01T18:00:00Z'), e('2026-08-02T09:00:00Z')],
      [e('2026-08-02T12:00:00Z')],
      []
    );
    expect(tage.map(t => [t.datum, t.zusagen, t.spenden])).toEqual([
      ['2026-08-01', 2, 0],
      ['2026-08-02', 1, 1]
    ]);
  });

  // Ohne Lückenfüllung sähe eine Woche Stillstand aus wie ein stetiger Anstieg.
  it('füllt Tage ohne Ereignisse auf', () => {
    const { tage } = berechneZeitverlauf(
      [e('2026-08-01T10:00:00Z'), e('2026-08-05T10:00:00Z')], [], []
    );
    expect(tage).toHaveLength(5);
    expect(tage[1]).toMatchObject({ datum: '2026-08-02', zusagen: 0 });
    expect(tage[2].zusagen).toBe(0);
  });

  it('führt die laufende Summe mit', () => {
    const { tage } = berechneZeitverlauf(
      [e('2026-08-01T10:00:00Z'), e('2026-08-03T10:00:00Z'), e('2026-08-03T11:00:00Z')], [], []
    );
    expect(tage.map(t => t.zusagenKumuliert)).toEqual([1, 1, 3]);
  });

  // Der Altbestand hat keinen Zeitstempel. Ihn stillschweigend wegzulassen
  // wäre irreführend - die Zahl wird deshalb getrennt ausgewiesen.
  it('weist Zusagen ohne Zeitstempel getrennt aus', () => {
    const { tage, ohneZeitstempel } = berechneZeitverlauf(
      [e('2026-08-01T10:00:00Z'), e(null), e(null)], [], []
    );
    expect(ohneZeitstempel).toBe(2);
    expect(tage[0].zusagen).toBe(1);
  });

  it('ordnet Aufrufe ihrem Tag zu', () => {
    const { tage } = berechneZeitverlauf(
      [e('2026-08-02T10:00:00Z')], [], [aufruf(1, '2026-08-01T09:00:00Z', 'Erster Aufruf')]
    );
    expect(tage[0].aufrufe[0].titel).toBe('Erster Aufruf');
    expect(tage[1].aufrufe).toEqual([]);
  });

  it('beginnt die Reihe beim Aufruf, wenn der vor der ersten Zusage liegt', () => {
    const { tage } = berechneZeitverlauf(
      [e('2026-08-03T10:00:00Z')], [], [aufruf(1, '2026-08-01T09:00:00Z')]
    );
    expect(tage[0].datum).toBe('2026-08-01');
    expect(tage).toHaveLength(3);
  });

  it('liefert eine leere Reihe, wenn es nichts zu zeigen gibt', () => {
    expect(berechneZeitverlauf([], [], []).tage).toEqual([]);
  });

  it('kommt mit ausschliesslich zeitstempellosem Altbestand klar', () => {
    const { tage, ohneZeitstempel } = berechneZeitverlauf([e(null), e(null)], [], []);
    expect(tage).toEqual([]);
    expect(ohneZeitstempel).toBe(2);
  });
});

describe('reaktionAufAufruf', () => {
  const a = aufruf(1, '2026-08-01T09:00:00Z');

  it('zählt, was im Fenster danach kam', () => {
    const r = reaktionAufAufruf(
      a,
      [e('2026-08-01T10:00:00Z'), e('2026-08-02T08:00:00Z')],
      [e('2026-08-01T20:00:00Z')]
    );
    expect(r).toEqual({ zusagen: 2, spenden: 1 });
  });

  it('ignoriert, was vor dem Aufruf lag', () => {
    const r = reaktionAufAufruf(a, [e('2026-07-31T10:00:00Z')], []);
    expect(r.zusagen).toBe(0);
  });

  it('ignoriert, was nach dem Fenster kam', () => {
    // 48 Stunden nach 01.08. 09:00 endet am 03.08. 09:00
    const r = reaktionAufAufruf(a, [e('2026-08-03T10:00:00Z')], []);
    expect(r.zusagen).toBe(0);
  });

  it('respektiert ein abweichendes Fenster', () => {
    const r = reaktionAufAufruf(a, [e('2026-08-01T15:00:00Z')], [], 3);
    expect(r.zusagen).toBe(0);   // 3 Stunden reichen nur bis 12:00
  });

  it('ignoriert Einträge ohne Zeitstempel', () => {
    expect(reaktionAufAufruf(a, [e(null)], []).zusagen).toBe(0);
  });
});

describe('chronik', () => {
  it('mischt Schichten und Spenden in zeitlicher Reihenfolge', () => {
    const eintraege = chronik(
      [
        { createdAt: '2026-08-03T10:00:00Z', name: 'Jens Kroening', was: 'Grillstand 10:30-14:00' },
        { createdAt: '2026-08-01T09:00:00Z', name: 'Anna Krischkowski', was: 'Verkaufsstand 09:30-12:00' }
      ],
      [{ createdAt: '2026-08-02T15:00:00Z', name: 'Maria Winter', was: '3 Kuchen' }]
    );

    expect(eintraege.map(e => [e.name, e.art])).toEqual([
      ['Anna Krischkowski', 'schicht'],
      ['Maria Winter', 'spende'],
      ['Jens Kroening', 'schicht']
    ]);
  });

  // Der Altbestand hat keinen Zeitstempel. Ihn mit einem geratenen Datum
  // einzureihen waere schlimmer als ihn wegzulassen.
  it('lässt Einträge ohne Zeitstempel weg', () => {
    expect(chronik([{ createdAt: null, name: 'Ralf' }], [])).toEqual([]);
  });

  it('fällt auf verständliche Bezeichnungen zurück', () => {
    const [e] = chronik([{ createdAt: '2026-08-01T09:00:00Z' }], []);
    expect(e).toMatchObject({ name: 'Unbekannt', was: 'Schicht' });
  });
});
