import prisma from '../config/prisma.js';

/**
 * Die Verpflegungsposten, fuer die noch am meisten fehlt - fuer den
 * Verpflegungsappell per Mail.
 *
 * Dasselbe Prinzip wie bei offeneSchichten.ts: "Kuchen, noch 8 Stueck" in der
 * Mail ist eine Entscheidung, "schau mal in die App" ist eine Aufgabe.
 *
 * Anders als eine Schicht ist ein Posten an einen Jahrgang gebunden, nicht an
 * einen Zeitpunkt - jeder Posten kommt deshalb mit seiner yearGroupId, damit
 * sich die Liste je Empfaenger auf die Jahrgaenge seiner eigenen Kinder
 * eingrenzen laesst (siehe waehleFuerEmpfaenger).
 */

export interface OffenerVerpflegungsPosten {
  slotId: number;
  yearGroupId: number;
  jahrgang: string;
  icon: string;
  name: string;
  beschreibung: string | null;
  ziel: number;
  gesammelt: number;
  offen: number;
}

/** Sortiert nach Groesse der Luecke - die groesste zuerst, wie beim Schichtappell. */
export async function ermittleOffeneVerpflegung(
  tournamentId: number,
  anzahl = 999
): Promise<OffenerVerpflegungsPosten[]> {
  const slots = await prisma.foodDonationSlot.findMany({
    where: { tournamentId },
    include: { yearGroup: true, foodItem: { include: { category: true } } }
  });

  return slots
    .map(s => ({
      slotId: s.id,
      yearGroupId: s.yearGroupId ?? 0,
      jahrgang: s.yearGroup?.name || 'Ohne Jahrgang',
      icon: s.foodItem?.category?.icon || '🍽️',
      name: s.foodItem?.name || s.description || 'Verpflegung',
      beschreibung: s.foodItem ? s.description : null,
      ziel: s.targetQuantity,
      gesammelt: s.collected,
      offen: Math.max(0, s.targetQuantity - s.collected)
    }))
    .filter(p => p.offen > 0)
    .sort((a, b) => b.offen - a.offen)
    .slice(0, anzahl);
}

/** Eine Jahrgangsspanne - dieselbe Form wie YearGroup, aber ohne den Rest des Modells. */
export interface Jahrgangsspanne {
  id: number;
  birthYearStart: number;
  birthYearEnd: number;
}

/**
 * Waehlt aus der turnierweiten Liste die Posten fuer EINEN Empfaenger aus.
 *
 * Reine Funktion, bewusst getrennt von der Datenbankabfrage: Das ist die
 * Stelle mit den meisten Fallunterscheidungen (mehrere Kinder, mehrere
 * Jahrgaenge, eine leere Auswahl) - und genau die Stelle, die sich ohne
 * Datenbank testen laesst.
 *
 * Passende Jahrgaenge werden ueber die Geburtsjahre der eigenen Kinder
 * ermittelt (identisch zur Zuordnung in self.controller.ts), nicht ueber ein
 * eigenes Zuordnungsfeld - das gibt es nicht.
 *
 * Ohne passenden Jahrgang - keine Kinder, oder deren Jahrgang ist bereits
 * vollstaendig gedeckt - faellt die Auswahl auf die turnierweit groessten
 * Luecken zurueck. Eine Mail ohne jede Liste sieht nach einem Fehler aus;
 * eine allgemeine Liste ist besser als gar keine.
 */
export function waehleFuerEmpfaenger(
  alleOffenen: OffenerVerpflegungsPosten[],
  kinderJahre: number[],
  jahrgaenge: Jahrgangsspanne[],
  anzahl = 5
): OffenerVerpflegungsPosten[] {
  const eigeneJahrgangsIds = new Set(
    jahrgaenge
      .filter(j => kinderJahre.some(jahr => jahr >= j.birthYearStart && jahr <= j.birthYearEnd))
      .map(j => j.id)
  );

  const eigene = eigeneJahrgangsIds.size > 0
    ? alleOffenen.filter(p => eigeneJahrgangsIds.has(p.yearGroupId)).slice(0, anzahl)
    : [];

  return eigene.length > 0 ? eigene : alleOffenen.slice(0, anzahl);
}
