/**
 * Prueft, ob ein Zeitangebot mit etwas kollidiert, das schon feststeht.
 *
 * Ohne diese Pruefung konnte jemand fuer denselben Vormittag dreimal Zeit
 * anbieten oder Zeit anbieten, obwohl er zur selben Stunde bereits eingeplant
 * ist. Fuer die Organisatoren sieht das nach drei Helfern aus, obwohl es
 * einer ist - und im schlimmsten Fall planen sie darauf hin.
 *
 * Reine Rechnung ohne Datenbankzugriff, damit sie testbar bleibt.
 */

/** Zwei Zeitraeume am selben Tag ueberschneiden sich. */
export function ueberschneidetSich(
  aStart: number, aEnde: number,
  bStart: number, bEnde: number
): boolean {
  // Beruehrung zaehlt nicht: Wer bis 12:00 kann und ab 12:00 eingeplant ist,
  // hat keinen Konflikt - das ist ein nahtloser Uebergang, kein Doppel.
  return aStart < bEnde && aEnde > bStart;
}

/** Kalendertag in UTC - dieselbe Sicht wie beim Reminder im Scheduler. */
export function utcTag(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

export interface Belegung {
  /** Woher der Konflikt kommt - fuer eine verstaendliche Fehlermeldung. */
  art: 'schicht' | 'angebot';
  tag: string;
  startMin: number;
  endMin: number;
  bezeichnung: string;
}

/**
 * Findet die erste Belegung, die dem gewuenschten Zeitraum in die Quere kommt.
 * `null`, wenn nichts kollidiert.
 */
export function findeKonflikt(
  wunsch: { tag: string; startMin: number; endMin: number },
  belegungen: Belegung[]
): Belegung | null {
  return belegungen.find(b =>
    b.tag === wunsch.tag && ueberschneidetSich(wunsch.startMin, wunsch.endMin, b.startMin, b.endMin)
  ) ?? null;
}

/** Minuten seit Mitternacht → "HH:MM". */
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Eine Meldung, die sagt, was im Weg ist - nicht nur, dass etwas im Weg ist. */
export function konfliktMeldung(k: Belegung): string {
  const zeit = `${hhmm(k.startMin)}–${hhmm(k.endMin)}`;
  return k.art === 'schicht'
    ? `Du bist in diesem Zeitraum bereits eingeplant: ${k.bezeichnung} (${zeit}).`
    : `Du hast für diesen Zeitraum schon ein Angebot, das angenommen wurde: ${k.bezeichnung} (${zeit}).`;
}

/**
 * Liegt der Zeitraum vollstaendig in der Vergangenheit?
 *
 * Ein Angebot fuer gestern ist gegenstandslos - es soll nicht weiter als
 * offene Aufgabe in der Liste stehen und dort Aufmerksamkeit binden.
 *
 * Gerechnet wird in UTC wie beim Reminder im Scheduler, damit dieselbe
 * Schicht ueberall demselben Kalendertag zugerechnet wird.
 */
export function istVergangen(datum: Date | string, endMin: number, jetzt: Date = new Date()): boolean {
  const d = new Date(datum);
  const ende = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Math.floor(endMin / 60), endMin % 60, 0
  ));
  return ende.getTime() < jetzt.getTime();
}
