import prisma from '../config/prisma.js';
import { effektiveZeit, minToTime } from './schichtzeit.js';

/**
 * Die Schichten, fuer die noch Leute fehlen - fuer den Helferaufruf per Mail.
 *
 * Warum das in die Mail gehoert und nicht nur ein "schau mal in die App":
 * Ein Aufruf ohne Inhalt verlangt vom Empfaenger den ersten Schritt. Steht
 * dagegen "Grillstand Samstag 14-16 Uhr, 2 von 5 besetzt" in der Mail, ist die
 * Entscheidung schon gefallen, bevor die App offen ist.
 *
 * Die Belegung wird genauso gezaehlt wie in self.controller.ts fuer die
 * "3/8"-Anzeige im Dashboard: alle Zusagen dieses Turniers je Schicht. Eine
 * zweite Zaehlweise waere schlimmer als keine Zahl - in der Mail stuende dann
 * eine andere Zahl als auf der Seite, auf die sie verlinkt.
 */

export interface OffeneSchicht {
  shiftId: number;
  bereich: string;
  icon: string;
  /** Der Tag der Schicht, ISO. Null, wenn die Schicht an keinem Tag haengt. */
  datum: Date | null;
  /** "14:00-16:00", oder null wenn die Schicht keine Zeit hat. */
  zeit: string | null;
  plaetze: number;
  besetzt: number;
  offen: number;
}

/**
 * Sortiert nach Groesse der Luecke, bei Gleichstand die frueheste zuerst.
 *
 * Die groesste Luecke oben, weil eine Schicht mit vier fehlenden Leuten der
 * Punkt ist, an dem das Turnier tatsaechlich kippt - eine, bei der einer
 * fehlt, laesst sich noch auffangen. Bei Gleichstand die frueheste: Was
 * naeher liegt, laesst sich schlechter nachbesetzen.
 */
export async function ermittleOffeneSchichten(
  tournamentId: number,
  jetzt = new Date(),
  anzahl = 5
): Promise<OffeneSchicht[]> {
  const [shifts, belegung] = await Promise.all([
    prisma.shift.findMany({
      where: { tournamentId },
      include: { day: true, daySlot: true, workArea: true }
    }),
    prisma.volunteerShift.groupBy({
      by: ['shiftId'],
      where: { tournamentId },
      _count: { _all: true }
    })
  ]);

  const besetztJeShift = new Map<number, number>();
  for (const b of belegung) {
    if (b.shiftId != null) besetztJeShift.set(b.shiftId, b._count._all);
  }

  return shifts
    .map(s => {
      const { start, ende } = effektiveZeit(s, s.daySlot);
      const besetzt = besetztJeShift.get(s.id) ?? 0;
      return {
        shiftId: s.id,
        bereich: s.workArea?.name || 'Ohne Bereich',
        icon: s.workArea?.icon || '📍',
        datum: s.day?.date ? new Date(s.day.date) : null,
        zeit: start != null && ende != null ? `${minToTime(start)}-${minToTime(ende)}` : null,
        plaetze: s.maxVolunteers,
        besetzt,
        offen: Math.max(0, s.maxVolunteers - besetzt),
        // Nur zum Sortieren und Filtern, nicht Teil des Ergebnisses.
        _start: start
      };
    })
    // Abgelaufene Schichten gehoeren nicht in einen Aufruf: Wer daraufhin die
    // App oeffnet und feststellt, dass die Schicht vorbei ist, kommt beim
    // naechsten Aufruf nicht wieder.
    .filter(l => l.offen > 0 && !istVorbei(l.datum, l._start, jetzt))
    .sort((a, b) => b.offen - a.offen || (a.datum?.getTime() ?? 0) - (b.datum?.getTime() ?? 0)
      || (a._start ?? 0) - (b._start ?? 0))
    .slice(0, anzahl)
    .map(({ _start, ...rest }) => rest);
}

/**
 * Ist diese Schicht schon gelaufen?
 *
 * Ohne Datum wird "nein" angenommen: Eine Schicht ohne Tag ist ein
 * Planungsfehler, aber sie stillschweigend aus dem Aufruf zu werfen wuerde
 * bedeuten, dass genau die Luecke unsichtbar bleibt, die jemand uebersehen
 * hat.
 */
function istVorbei(datum: Date | null, startMin: number | null, jetzt: Date): boolean {
  if (!datum) return false;
  const ende = new Date(datum);
  ende.setHours(0, 0, 0, 0);
  ende.setMinutes(startMin ?? 24 * 60);
  return ende.getTime() < jetzt.getTime();
}
