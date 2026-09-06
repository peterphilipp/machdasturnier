import { describe, it, expect } from 'vitest';
import { waehleFuerEmpfaenger, OffenerVerpflegungsPosten, Jahrgangsspanne } from '../src/utils/offeneVerpflegung.js';

/**
 * Die eigentliche Entscheidung des Verpflegungsappells: personalisiert fuer
 * Eltern mit passendem Kind, sonst die turnierweit groessten Luecken.
 *
 * Bewusst als reine Funktion getestet, getrennt von der Datenbankabfrage -
 * hier stecken die Fallunterscheidungen (mehrere Kinder, mehrere Jahrgaenge,
 * ein leerer Treffer), nicht in der Abfrage selbst.
 */

const POSTEN = (yearGroupId: number, offen = 5): OffenerVerpflegungsPosten => ({
  slotId: yearGroupId * 100,
  yearGroupId,
  jahrgang: `Jahrgang ${yearGroupId}`,
  icon: '🍰',
  name: `Posten ${yearGroupId}`,
  beschreibung: null,
  ziel: 10,
  gesammelt: 10 - offen,
  offen
});

const JG2014: Jahrgangsspanne = { id: 1, birthYearStart: 2014, birthYearEnd: 2014 };
const JG2016: Jahrgangsspanne = { id: 2, birthYearStart: 2016, birthYearEnd: 2016 };
const JAHRGAENGE = [JG2014, JG2016];

describe('waehleFuerEmpfaenger', () => {
  it('wählt die Posten des Jahrgangs, in den das eigene Kind fällt', () => {
    const alle = [POSTEN(1), POSTEN(2)];
    const gewaehlt = waehleFuerEmpfaenger(alle, [2014], JAHRGAENGE);
    expect(gewaehlt).toEqual([POSTEN(1)]);
  });

  it('vereint die Jahrgänge mehrerer Kinder', () => {
    const alle = [POSTEN(1), POSTEN(2)];
    const gewaehlt = waehleFuerEmpfaenger(alle, [2014, 2016], JAHRGAENGE);
    expect(gewaehlt.map(p => p.yearGroupId).sort()).toEqual([1, 2]);
  });

  // Kein Kind im Turnier - der Fall, den der Verein ausdrücklich so wollte:
  // dann die turnierweit größten Lücken statt gar nichts. Die Sortierung
  // selbst ist Sache des Aufrufers (ermittleOffeneVerpflegung) - hier steht
  // die Liste deshalb schon sortiert an, wie sie in echt ankäme.
  it('fällt ohne eigenes Kind auf die turnierweit größten Lücken zurück', () => {
    const alle = [POSTEN(2, 9), POSTEN(1, 3)];
    const gewaehlt = waehleFuerEmpfaenger(alle, [], JAHRGAENGE);
    expect(gewaehlt).toEqual([POSTEN(2, 9), POSTEN(1, 3)]);
  });

  // Das Kind ist da, aber sein Jahrgang ist bereits vollständig gedeckt -
  // eine leere Liste wäre schlimmer als eine allgemeine.
  it('fällt auch zurück, wenn der eigene Jahrgang schon gedeckt ist', () => {
    const alle = [POSTEN(2, 4)]; // Jahrgang 1 (das eigene Kind) hat keine offenen Posten
    const gewaehlt = waehleFuerEmpfaenger(alle, [2014], JAHRGAENGE);
    expect(gewaehlt).toEqual([POSTEN(2, 4)]);
  });

  it('kürzt auf die angegebene Anzahl', () => {
    const alle = [POSTEN(1, 1), POSTEN(1, 2), POSTEN(1, 3)];
    const gewaehlt = waehleFuerEmpfaenger(alle, [2014], JAHRGAENGE, 2);
    expect(gewaehlt).toHaveLength(2);
  });

  it('kommt ohne Jahrgänge im Turnier klar', () => {
    const alle = [POSTEN(1, 5)];
    expect(waehleFuerEmpfaenger(alle, [2014], [])).toEqual([POSTEN(1, 5)]);
  });

  it('kommt mit einer leeren Gesamtliste klar', () => {
    expect(waehleFuerEmpfaenger([], [2014], JAHRGAENGE)).toEqual([]);
  });
});
