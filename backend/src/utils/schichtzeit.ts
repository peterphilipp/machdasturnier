import { notifyUsers } from './notify.js';

/**
 * Gemeinsame Logik fuer "die Zeit einer Schicht hat sich geaendert".
 *
 * Eine Schicht kann auf zwei Wegen verschoben werden: direkt (shift.startMin)
 * oder indirekt, indem das Zeitfenster des Tages wandert, von dem sie ihre Zeit
 * erbt. Beide Wege muessen dasselbe tun - sonst gibt es wieder den Zustand, in
 * dem eingeplante Helfer eine Zeit sehen, die es nicht mehr gibt.
 */

/** Minuten seit Mitternacht → "HH:MM". */
export function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Die Zeit, die tatsaechlich gilt: die der Schicht, ersatzweise die des Slots. */
export function effektiveZeit(
  shift: { startMin: number | null; endMin: number | null },
  slot?: { startMin: number; endMin: number } | null
): { start: number | null; ende: number | null } {
  return {
    start: shift.startMin ?? slot?.startMin ?? null,
    ende: shift.endMin ?? slot?.endMin ?? null
  };
}

/**
 * Die Schreibweise, in der eine Zeitspanne bei den Helfern gespeichert wird
 * (`volunteer_shifts.slot`).
 *
 * Dieses Feld ist eine Kopie der Schichtzeit zum Zeitpunkt der Einplanung.
 * Bleibt sie nach einer Verschiebung stehen, zeigt die Uebersicht die alte Zeit
 * - fuer die Helfer nicht als Fehler erkennbar, weil dort einfach eine
 * plausible Uhrzeit steht. Jede Zeitaenderung muss sie deshalb mitziehen.
 */
export function slotText(start: number, ende: number): string {
  return `${minToTime(start)}-${minToTime(ende)}`;
}

/**
 * Meldet eine verschobene Schicht an die bereits eingeplanten Helfer.
 *
 * Nur bei tatsaechlich geaenderter Uhrzeit - ein Speichern ohne Zeitwechsel
 * (etwa nur die Helferzahl) soll niemanden behelligen.
 */
export async function benachrichtigeBeiZeitaenderung(
  vorher: {
    startMin: number | null;
    endMin: number | null;
    daySlot?: { startMin: number; endMin: number } | null;
    day?: { date: Date } | null;
    workArea?: { name: string } | null;
    volunteerShifts: { userId: number | null }[];
  },
  nachher: {
    startMin: number | null;
    endMin: number | null;
    daySlot?: { startMin: number; endMin: number } | null;
  }
): Promise<void> {
  const alt = effektiveZeit(vorher, vorher.daySlot);
  const neu = effektiveZeit(nachher, nachher.daySlot);
  if (alt.start === neu.start && alt.ende === neu.ende) return;

  const betroffene = vorher.volunteerShifts.map(vs => vs.userId).filter((id): id is number => id != null);
  if (betroffene.length === 0) return;

  const bereich = vorher.workArea?.name || 'Deine Schicht';
  const datum = vorher.day?.date ? new Date(vorher.day.date).toLocaleDateString('de-DE') : '';
  const altText = alt.start != null && alt.ende != null ? `${minToTime(alt.start)}-${minToTime(alt.ende)}` : 'bisher';
  const neuText = neu.start != null && neu.ende != null ? `${minToTime(neu.start)}-${minToTime(neu.ende)}` : 'neu';

  await notifyUsers(
    betroffene,
    'Schicht verschoben',
    ({ vertretend, name }) => vertretend
      ? `${bereich}${datum ? ` am ${datum}` : ''}: neue Zeit ${neuText} (vorher ${altText}). Bitte prüfe, ob das für ${name} passt.`
      : `${bereich}${datum ? ` am ${datum}` : ''}: neue Zeit ${neuText} (vorher ${altText}). Bitte prüfe, ob das für dich passt.`,
    '/'
  );
}
