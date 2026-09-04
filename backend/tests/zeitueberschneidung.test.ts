import { describe, it, expect } from 'vitest';
import {
  ueberschneidetSich,
  findeKonflikt,
  konfliktMeldung,
  istVergangen,
  Belegung
} from '../src/utils/zeitueberschneidung.js';

describe('ueberschneidetSich', () => {
  it('erkennt eine echte Überlappung', () => {
    expect(ueberschneidetSich(540, 720, 600, 780)).toBe(true);   // 9-12 vs 10-13
  });

  it('erkennt vollständige Umschliessung in beide Richtungen', () => {
    expect(ueberschneidetSich(540, 780, 600, 660)).toBe(true);   // 9-13 umschliesst 10-11
    expect(ueberschneidetSich(600, 660, 540, 780)).toBe(true);   // 10-11 liegt in 9-13
  });

  // Der Fall, der oft falsch gemacht wird: Ende und Anfang fallen zusammen.
  // Wer bis 12:00 kann und ab 12:00 eingeplant ist, hat keinen Konflikt.
  it('wertet ein nahtloses Aneinander nicht als Konflikt', () => {
    expect(ueberschneidetSich(540, 720, 720, 900)).toBe(false);
    expect(ueberschneidetSich(720, 900, 540, 720)).toBe(false);
  });

  it('erkennt getrennte Zeiträume', () => {
    expect(ueberschneidetSich(540, 660, 780, 900)).toBe(false);
  });

  it('erkennt eine Überlappung von nur einer Minute', () => {
    expect(ueberschneidetSich(540, 721, 720, 900)).toBe(true);
  });
});

describe('findeKonflikt', () => {
  const belegungen: Belegung[] = [
    { art: 'schicht', tag: '2026-09-05', startMin: 600, endMin: 780, bezeichnung: 'Grillstand' },
    { art: 'angebot', tag: '2026-09-06', startMin: 540, endMin: 660, bezeichnung: 'Zeitangebot' }
  ];

  it('meldet die kollidierende Schicht', () => {
    const k = findeKonflikt({ tag: '2026-09-05', startMin: 540, endMin: 720 }, belegungen);
    expect(k?.bezeichnung).toBe('Grillstand');
  });

  // Entscheidend: Ein anderer Tag ist kein Konflikt, auch bei gleicher Uhrzeit.
  it('ignoriert dieselbe Uhrzeit an einem anderen Tag', () => {
    expect(findeKonflikt({ tag: '2026-09-07', startMin: 600, endMin: 780 }, belegungen)).toBeNull();
  });

  it('findet auch ein angenommenes Angebot als Konflikt', () => {
    const k = findeKonflikt({ tag: '2026-09-06', startMin: 600, endMin: 700 }, belegungen);
    expect(k?.art).toBe('angebot');
  });

  it('lässt einen freien Zeitraum durch', () => {
    expect(findeKonflikt({ tag: '2026-09-05', startMin: 780, endMin: 900 }, belegungen)).toBeNull();
  });

  it('kommt mit einem Helfer ohne jede Belegung klar', () => {
    expect(findeKonflikt({ tag: '2026-09-05', startMin: 540, endMin: 720 }, [])).toBeNull();
  });
});

describe('konfliktMeldung', () => {
  it('nennt bei einer Schicht die Einplanung', () => {
    const text = konfliktMeldung({ art: 'schicht', tag: '2026-09-05', startMin: 600, endMin: 780, bezeichnung: 'Küche' });
    expect(text).toMatch(/bereits eingeplant/);
    expect(text).toMatch(/Küche/);
    expect(text).toMatch(/10:00–13:00/);
  });

  it('nennt bei einem Angebot die frühere Zusage', () => {
    const text = konfliktMeldung({ art: 'angebot', tag: '2026-09-05', startMin: 540, endMin: 660, bezeichnung: 'Zeitangebot' });
    expect(text).toMatch(/angenommen/);
  });
});

describe('istVergangen', () => {
  const jetzt = new Date('2026-09-05T14:00:00.000Z');

  it('erkennt einen abgelaufenen Zeitraum am selben Tag', () => {
    // 09:00-12:00 an diesem Tag ist um 14:00 vorbei
    expect(istVergangen('2026-09-05T00:00:00.000Z', 720, jetzt)).toBe(true);
  });

  it('lässt einen laufenden Zeitraum stehen', () => {
    // 13:00-16:00 laeuft gerade - noch nicht gegenstandslos
    expect(istVergangen('2026-09-05T00:00:00.000Z', 960, jetzt)).toBe(false);
  });

  it('lässt einen künftigen Tag stehen', () => {
    expect(istVergangen('2026-09-06T00:00:00.000Z', 600, jetzt)).toBe(false);
  });

  it('erkennt einen vergangenen Tag', () => {
    expect(istVergangen('2026-09-04T00:00:00.000Z', 1400, jetzt)).toBe(true);
  });

  // Die Endzeit ist Ortszeit, nicht UTC. Am 05.09. (MESZ, UTC+2) endet ein
  // Angebot bis 15:00 bereits um 13:00 UTC - um 14:00 UTC ist es vorbei.
  // Als UTC gelesen waere es noch eine Stunde lang "offen".
  it('liest die Endzeit als Ortszeit', () => {
    expect(istVergangen('2026-09-05T00:00:00.000Z', 15 * 60, jetzt)).toBe(true);
    expect(istVergangen('2026-09-05T00:00:00.000Z', 17 * 60, jetzt)).toBe(false);
  });
});
