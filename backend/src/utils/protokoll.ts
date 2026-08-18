import prisma from '../config/prisma.js';

/**
 * Sichtbare Aenderungshistorie des Dienstplans.
 *
 * Mehrere Organisatoren planen gleichzeitig und ueberschreiben sich dabei
 * gelegentlich, ohne dass es auffaellt. Diese Eintraege machen nachvollziehbar,
 * wer wann was getan hat - im Reiter "Verlauf" und als Zeile im Schicht-Dialog.
 *
 * Abgrenzung zum Logger (utils/logger.ts): der schreibt nach stdout und dient
 * dem Betrieb. Was hier landet, ist fuer die Turnierleitung in der App gedacht
 * und muss deshalb dauerhaft und lesbar sein.
 */
export type AenderungsArt = 'schicht' | 'helfer' | 'stammdaten' | 'geloescht';

interface Eintrag {
  tournamentId?: number | null;
  userId?: number | null;
  userName?: string | null;
  art: AenderungsArt;
  /** Fertiger deutscher Satz OHNE den Namen - der wird beim Anzeigen davorgesetzt. */
  beschreibung: string;
  objektTyp?: string | null;
  objektId?: number | null;
}

/**
 * Schreibt einen Eintrag. Bewusst fehlertolerant: Ein Problem beim
 * Protokollieren darf die eigentliche Aenderung am Dienstplan nie scheitern
 * lassen - der Verlauf ist Beiwerk, der Dienstplan ist die Arbeit.
 */
export async function protokolliere(eintrag: Eintrag): Promise<void> {
  try {
    let name = eintrag.userName?.trim();
    if (!name && eintrag.userId) {
      const u = await prisma.user.findUnique({ where: { id: eintrag.userId }, select: { name: true } });
      name = u?.name;
    }
    await prisma.aenderung.create({
      data: {
        tournamentId: eintrag.tournamentId ?? null,
        userId: eintrag.userId ?? null,
        userName: name || 'Unbekannt',
        art: eintrag.art,
        beschreibung: eintrag.beschreibung,
        objektTyp: eintrag.objektTyp ?? null,
        objektId: eintrag.objektId ?? null
      }
    });
  } catch (err) {
    console.error('[Protokoll] Eintrag konnte nicht gespeichert werden:', (err as Error).message);
  }
}

/** "2.8.2026" - kurz, wie im Dienstplan gesprochen wird. */
export function datumKurz(d: Date | string): string {
  const datum = typeof d === 'string' ? new Date(d) : d;
  return `${datum.getDate()}.${datum.getMonth() + 1}.${datum.getFullYear()}`;
}

/** Minuten seit Mitternacht als "09:00". */
export function zeitKurz(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
