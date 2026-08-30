import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { notifyUser, notifyUsers } from '../utils/notify.js';
import { AuthRequest } from '../middleware/auth.js';
import { protokolliere, datumKurz, zeitKurz } from '../utils/protokoll.js';
import { minToTime, slotText, benachrichtigeBeiZeitaenderung } from '../utils/schichtzeit.js';

// Hinweis: Das Erzeugen von Shifts erfolgt künftig über die Tag-/Template-basierte
// Generierung (Etappe 2), nicht mehr über manuelles Anlegen einzelner Slots.

export const createShiftSchema = z.object({
  tournamentId: z.number().int().positive(),
  tournamentDayId: z.number().int().positive(),
  daySlotId: z.number().int().positive(),
  tournamentWorkAreaId: z.number().int().positive(),
  minVolunteers: z.number().int().min(0).max(200).optional(),
  maxVolunteers: z.number().int().min(0).max(200).optional(),
  /** Bewusst eine weitere Schicht parallel zur bestehenden anlegen. */
  allowParallel: z.boolean().optional()
});

export const updateShiftSchema = z.object({
  startMin: z.number().int().min(0).max(1440).nullable().optional(),
  endMin: z.number().int().min(0).max(1440).nullable().optional(),
  minVolunteers: z.number().int().min(0).max(200).optional(),
  maxVolunteers: z.number().int().min(0).max(200).optional(),
  description: z.string().max(1000).nullable().optional()
}).refine(
  data => data.startMin == null || data.endMin == null || data.endMin > data.startMin,
  { message: 'Endzeit muss nach der Startzeit liegen.', path: ['endMin'] }
);

export const updateShiftsBatchSchema = z.object({
  changes: z.array(z.object({
    id: z.number().int().positive(),
    startMin: z.number().int().min(0),
    endMin: z.number().int().min(0)
  })).min(1).refine(
    items => items.every(it => it.endMin > it.startMin),
    { message: 'Endzeit muss nach der Startzeit liegen.' }
  ).refine(
    items => new Set(items.map(it => it.id)).size === items.length,
    { message: 'Doppelte Schicht-ID in der Änderungsliste.' }
  )
});

export const getShifts = async (req: Request, res: Response) => {
  const { tournamentId } = req.query;
  if (!tournamentId) return res.json([]);
  const shifts = await prisma.shift.findMany({
    where: { tournamentId: parseInt(tournamentId as string) },
    include: { day: true, daySlot: true, workArea: true },
    orderBy: [{ tournamentDayId: 'asc' }, { daySlotId: 'asc' }, { workArea: { order: 'asc' } }, { id: 'asc' }]
  });
  return res.json(shifts);
};

/**
 * Legt eine einzelne Schicht direkt an - im Unterschied zu generateShifts()
 * NICHT durch den Tagesvorlagen-Katalog eingeschränkt (der Admin entscheidet
 * hier bewusst pro Schicht, nicht der Katalog-Abgleich). Deckt den Fall ab,
 * dass für einen bereits im Dienstplan vorhandenen Arbeitsbereich eine
 * weitere, zusätzliche Schicht in einem anderen Zeit-Slot desselben Tages
 * gebraucht wird - "+ Arbeitsbereich" (generateShifts) hilft dort nicht,
 * weil der Bereich an diesem Tag schon existiert.
 */
/**
 * Ein Arbeitsbereich darf zur selben Zeit mehrfach besetzt sein - zwei
 * Verkaufsstaende etwa laufen parallel und werden getrennt geplant, mit
 * eigenen Helfern und eigenem Stationszettel.
 *
 * Die Pruefung unten ist deshalb keine fachliche Regel mehr, sondern nur noch
 * ein Schutz vor dem versehentlichen Doppelklick: Wer bewusst eine parallele
 * Schicht anlegt, schickt `allowParallel` mit. Die Oberflaeche fragt an der
 * Stelle nach, statt die Entscheidung stillschweigend zu treffen.
 */
export const createShift = async (req: AuthRequest, res: Response) => {
  const { tournamentId, tournamentDayId, daySlotId, tournamentWorkAreaId, minVolunteers, maxVolunteers, allowParallel } = req.body;

  if (!allowParallel) {
    const existing = await prisma.shift.findFirst({ where: { tournamentDayId, daySlotId, tournamentWorkAreaId } });
    if (existing) {
      return res.status(409).json({ error: 'Für diesen Arbeitsbereich existiert in diesem Zeit-Slot bereits eine Schicht.' });
    }
  }

  const area = await prisma.tournamentWorkArea.findUnique({ where: { id: tournamentWorkAreaId } });
  if (!area) return res.status(404).json({ error: 'Arbeitsbereich nicht gefunden' });

  const shift = await prisma.shift.create({
    data: {
      tournamentId,
      tournamentDayId,
      daySlotId,
      tournamentWorkAreaId,
      minVolunteers: minVolunteers ?? area.minVolunteers,
      maxVolunteers: maxVolunteers ?? area.maxVolunteers
    },
    include: { day: true, daySlot: true, workArea: true }
  });

  const zeit = shift.startMin ?? shift.daySlot?.startMin;
  const ende = shift.endMin ?? shift.daySlot?.endMin;
  await protokolliere({
    tournamentId: shift.tournamentId,
    userId: req.userId,
    art: 'schicht',
    beschreibung: `hat die Schicht ${shift.workArea?.name || 'Job'}${shift.day ? ` am ${datumKurz(shift.day.date)}` : ''}`
      + `${zeit != null && ende != null ? `, ${zeitKurz(zeit)}-${zeitKurz(ende)}` : ''} angelegt`
      + `${allowParallel ? ' (parallel zu einer bestehenden)' : ''}`,
    objektTyp: 'shift',
    objektId: shift.id
  });

  return res.status(201).json(shift);
};

// Entfernt eine einzelne, bereits generierte Schicht wieder aus dem
// Dienstplan (z.B. wenn ein Arbeitsbereich doch nicht gebraucht wird) - im
// Unterschied zu clearShifts() betrifft das NUR diese eine Schicht, nicht
// den ganzen Turnier-Plan. Bereits eingeplante Helfer werden vor dem
// Löschen (die Zuweisungen kaskadieren mit) per Push benachrichtigt, statt
// einfach kommentarlos aus ihrem Dienstplan zu verschwinden.
export const deleteShift = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string);
  const shift = await prisma.shift.findUnique({
    where: { id },
    include: { volunteerShifts: { include: { user: true } }, workArea: true, day: true }
  });
  if (!shift) return res.status(404).json({ error: 'Schicht nicht gefunden' });

  await prisma.shift.delete({ where: { id } });

  const areaName = shift.workArea?.name || 'Job';
  const dateStr = shift.day?.date ? new Date(shift.day.date).toLocaleDateString('de-DE') : '';
  await notifyUsers(
    shift.volunteerShifts.map(vs => vs.userId).filter((id): id is number => id != null),
    'Schicht entfallen',
    ({ vertretend, name }) => vertretend
      ? `Die Schicht ${areaName}${dateStr ? ` am ${dateStr}` : ''} wurde entfernt. ${name} ist dort nicht mehr eingeplant.`
      : `Die Schicht ${areaName}${dateStr ? ` am ${dateStr}` : ''} wurde entfernt. Du bist dort nicht mehr eingeplant.`,
    '/'
  );

  await protokolliere({
    tournamentId: shift.tournamentId,
    userId: req.userId,
    art: 'geloescht',
    beschreibung: `hat die Schicht ${areaName}${dateStr ? ` am ${dateStr}` : ''} entfernt`
      + `${shift.volunteerShifts.length > 0 ? ` (${shift.volunteerShifts.length} eingeplante Helfer wurden ausgeplant)` : ''}`,
    objektTyp: 'shift',
    objektId: shift.id
  });

  return res.json({ deletedVolunteerAssignments: shift.volunteerShifts.length });
};

export const updateShift = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { startMin, endMin, minVolunteers, maxVolunteers, description } = req.body;

  if (startMin !== undefined && endMin !== undefined && startMin != null && endMin != null && Number(endMin) <= Number(startMin)) {
    return res.status(400).json({ error: 'Endzeit muss nach der Startzeit liegen.' });
  }

  const data: Record<string, unknown> = {};
  if (startMin !== undefined) data.startMin = startMin === null ? null : Number(startMin);
  if (endMin !== undefined) data.endMin = endMin === null ? null : Number(endMin);
  if (minVolunteers !== undefined) data.minVolunteers = Number(minVolunteers);
  if (maxVolunteers !== undefined) data.maxVolunteers = Number(maxVolunteers);
  if (description !== undefined) data.description = description;

  // Zustand VOR der Aenderung, um echte Zeitverschiebungen zu erkennen und
  // die eingeplanten Helfer zu erreichen.
  const vorher = await prisma.shift.findUnique({
    where: { id },
    include: { daySlot: true, day: true, workArea: true, volunteerShifts: { select: { userId: true, id: true } } }
  });
  if (!vorher) return res.status(404).json({ error: 'Schicht nicht gefunden' });

  const updated = await prisma.shift.update({
    where: { id },
    data,
    include: { day: true, daySlot: true, workArea: true }
  });

  // Aktualisiere die Zeiten aller eingeplanten Helfer, wenn sich die Schichtzeiten geändert haben
  const altStart = vorher.startMin ?? vorher.daySlot?.startMin ?? null;
  const altEnde = vorher.endMin ?? vorher.daySlot?.endMin ?? null;
  const neuStart = updated.startMin ?? updated.daySlot?.startMin ?? null;
  const neuEnde = updated.endMin ?? updated.daySlot?.endMin ?? null;

  if ((altStart !== neuStart || altEnde !== neuEnde) && neuStart != null && neuEnde != null && vorher.volunteerShifts.length > 0) {
    await prisma.volunteerShift.updateMany({
      where: { shiftId: id },
      data: { slot: slotText(neuStart, neuEnde) }
    });
  }

  await benachrichtigeBeiZeitaenderung(vorher, updated);
  await protokolliereSchichtaenderung(vorher, updated, req.userId);
  return res.json(updated);
};

/**
 * Haelt fest, WAS sich an einer Schicht geaendert hat - in einem Satz, den ein
 * Mensch auf dem Handy lesen kann. Ohne Aenderung kein Eintrag: ein Speichern,
 * das nichts bewegt, soll den Verlauf nicht zumuellen.
 */
async function protokolliereSchichtaenderung(
  vorher: { id: number; tournamentId: number; startMin: number | null; endMin: number | null; minVolunteers: number; maxVolunteers: number; daySlot?: { startMin: number; endMin: number } | null; day?: { date: Date } | null; workArea?: { name: string } | null },
  nachher: { startMin: number | null; endMin: number | null; minVolunteers: number; maxVolunteers: number; daySlot?: { startMin: number; endMin: number } | null },
  userId?: number
): Promise<void> {
  const altStart = vorher.startMin ?? vorher.daySlot?.startMin ?? null;
  const altEnde = vorher.endMin ?? vorher.daySlot?.endMin ?? null;
  const neuStart = nachher.startMin ?? nachher.daySlot?.startMin ?? null;
  const neuEnde = nachher.endMin ?? nachher.daySlot?.endMin ?? null;

  const teile: string[] = [];
  if (altStart !== neuStart || altEnde !== neuEnde) {
    const alt = altStart != null && altEnde != null ? `${zeitKurz(altStart)}-${zeitKurz(altEnde)}` : 'ohne Zeit';
    const neu = neuStart != null && neuEnde != null ? `${zeitKurz(neuStart)}-${zeitKurz(neuEnde)}` : 'ohne Zeit';
    teile.push(`von ${alt} auf ${neu} verschoben`);
  }
  if (vorher.maxVolunteers !== nachher.maxVolunteers) {
    teile.push(`die Helferzahl von ${vorher.maxVolunteers} auf ${nachher.maxVolunteers} gesetzt`);
  }
  if (vorher.minVolunteers !== nachher.minVolunteers) {
    teile.push(`die Mindestbesetzung von ${vorher.minVolunteers} auf ${nachher.minVolunteers} gesetzt`);
  }
  if (teile.length === 0) return;

  const bereich = vorher.workArea?.name || 'Schicht';
  const datum = vorher.day?.date ? ` am ${datumKurz(vorher.day.date)}` : '';
  await protokolliere({
    tournamentId: vorher.tournamentId,
    userId,
    art: 'schicht',
    beschreibung: `hat ${bereich}${datum} ${teile.join(' und ')}`,
    objektTyp: 'shift',
    objektId: vorher.id
  });
}

/**
 * Übernimmt mehrere Zeit-Änderungen als eine Business-Transaktion (Editiermodus
 * im Dienstplan): entweder werden alle Schichten aktualisiert, oder keine.
 * Verhindert einen Teil-Zustand, falls z. B. Schicht 3 von 5 an einer
 * verletzten Constraint scheitert.
 */
export const updateShiftsBatch = async (req: AuthRequest, res: Response) => {
  const { changes } = req.body as { changes: { id: number; startMin: number; endMin: number }[] };

  const vorherListe = await prisma.shift.findMany({
    where: { id: { in: changes.map(c => c.id) } },
    include: { daySlot: true, day: true, workArea: true, volunteerShifts: { select: { userId: true, id: true } } }
  });

  // Sequenziell statt Promise.all: SQLite kennt nur einen Schreiber, und
  // parallele Queries auf derselben Transaktions-Connection kaufen hier nichts.
  const updated = await prisma.$transaction(async (tx) => {
    const result = [];

    for (const c of changes) {
      const nachher = await tx.shift.update({
        where: { id: c.id },
        data: { startMin: c.startMin, endMin: c.endMin },
        include: { day: true, daySlot: true, workArea: true }
      });
      result.push(nachher);

      // Die gespeicherte Zeit der eingeplanten Helfer mitziehen - sonst zeigt
      // die Uebersicht weiter die Zeit von vor der Verschiebung.
      const vorher = vorherListe.find(v => v.id === nachher.id);
      if (!vorher || vorher.volunteerShifts.length === 0) continue;

      const altStart = vorher.startMin ?? vorher.daySlot?.startMin ?? null;
      const altEnde = vorher.endMin ?? vorher.daySlot?.endMin ?? null;
      const neuStart = nachher.startMin ?? nachher.daySlot?.startMin ?? null;
      const neuEnde = nachher.endMin ?? nachher.daySlot?.endMin ?? null;
      if (altStart === neuStart && altEnde === neuEnde) continue;
      if (neuStart == null || neuEnde == null) continue;

      await tx.volunteerShift.updateMany({
        where: { shiftId: nachher.id },
        data: { slot: slotText(neuStart, neuEnde) }
      });
    }

    return result;
  });

  // Erst nach der Transaktion benachrichtigen: schlaegt sie fehl, wurde nichts
  // geaendert und es darf auch nichts gemeldet werden.
  for (const nachher of updated) {
    const vorher = vorherListe.find(v => v.id === nachher.id);
    if (vorher) {
      await benachrichtigeBeiZeitaenderung(vorher, nachher);
      await protokolliereSchichtaenderung(vorher, nachher, req.userId);
    }
  }

  return res.json(updated);
};
