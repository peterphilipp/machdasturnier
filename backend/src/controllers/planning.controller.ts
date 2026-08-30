import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { protokolliere, datumKurz } from '../utils/protokoll.js';
import prisma from '../config/prisma.js';
import { z } from 'zod';
import { minToTime, slotText, effektiveZeit, benachrichtigeBeiZeitaenderung } from '../utils/schichtzeit.js';

// ==================== Zod-Schemas ====================
export const tournamentWorkAreaUpdateSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).optional(),
  minVolunteers: z.number().int().min(0).optional(),
  maxVolunteers: z.number().int().min(0).optional(),
  operatingStartMin: z.number().int().min(0).max(1439).nullable().optional(),
  operatingEndMin: z.number().int().min(1).max(1440).nullable().optional()
});

export const tournamentWorkAreaAdoptSchema = z.object({
  tournamentId: z.number().int().positive(),
  workAreaId: z.number().int().positive()
});

export const tournamentWorkAreaSyncSchema = z.object({
  tournamentId: z.number().int().positive()
});

export const tournamentDaySchema = z.object({
  tournamentId: z.number().int().positive(),
  date: z.string().or(z.date()),
  label: z.string().nullable().optional(),
  order: z.number().int().optional(),
  templateId: z.number().int().positive().nullable().optional()
});

export const daySlotSchema = z.object({
  tournamentDayId: z.number().int().positive(),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  label: z.string().nullable().optional(),
  color: z.string().optional(),
  order: z.number().int().optional()
});

export const updateTournamentDaySchema = z.object({
  date: z.string().or(z.date()),
  label: z.string().max(200, 'Label darf maximal 200 Zeichen lang sein').nullable(),
  order: z.number().int()
});

/** Body von generate-shifts / clear-shifts: beide nehmen nur die Turnier-ID entgegen. */
export const tournamentIdBodySchema = z.object({
  tournamentId: z.number().int().positive('tournamentId erforderlich')
});

export const exportDayToTemplateSchema = z.object({
  name: z.string().min(1, 'Name der Vorlage erforderlich').max(200, 'Name darf maximal 200 Zeichen lang sein'),
  description: z.string().max(1000, 'Beschreibung darf maximal 1000 Zeichen lang sein').optional()
});

export const dayWorkAreaTargetSchema = z.object({
  targetHelpers: z.number().int().min(0).nullable().optional()
});

export const addDayWorkAreaSchema = z.object({
  tournamentDayId: z.number().int().positive(),
  tournamentWorkAreaId: z.number().int().positive(),
  order: z.number().int().optional()
});

// ==================== TournamentWorkArea ====================
export const listTournamentWorkAreas = async (req: Request, res: Response) => {
  const tournamentId = req.query.tournamentId ? parseInt(String(req.query.tournamentId)) : null;
  if (!tournamentId) return res.status(400).json({ error: 'tournamentId erforderlich' });
  const areas = await prisma.tournamentWorkArea.findMany({ where: { tournamentId }, orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
  return res.json(areas);
};

/** Snapshotet alle nicht-obsoleten Katalog-WorkAreas in dieses Turnier (idempotent). */
export const syncTournamentWorkAreas = async (req: Request, res: Response) => {
  const { tournamentId } = req.body as { tournamentId: number }; // bereits von validate() geparst

  await prisma.$transaction(async (tx) => {
    // Alle nicht-obsoleten Katalog-Bereiche laden
    const catalog = await tx.workArea.findMany({ where: { isObsolete: false } });
    
    // Alle bestehenden Bereiche dieses Turniers laden
    const existing = await tx.tournamentWorkArea.findMany({
      where: { tournamentId },
      select: { id: true, sourceWorkAreaId: true, active: true, name: true }
    });
    
    // Map: sourceWorkAreaId → Eintrag (kann null sein)
    const known = new Map<number | null, typeof existing[number]>();
    for (const e of existing) {
      known.set(e.sourceWorkAreaId, e);
    }
    
    // Standard-Bereiche immer aktivieren
    const standardAreas = catalog.filter(w => w.isStandard);
    for (const stdArea of standardAreas) {
      let existingEntry = known.get(stdArea.id);
      
      // Wenn nicht gefunden: nach Namen suchen (für manuell angelegte Bereiche)
      if (!existingEntry) {
        const manualMatch = existing.find(e => e.sourceWorkAreaId === null && e.name === stdArea.name);
        if (manualMatch) existingEntry = { ...manualMatch, sourceWorkAreaId: null };
      }
      
      if (existingEntry?.id) {
        // Bereits vorhanden → aktivieren
        await tx.tournamentWorkArea.update({
          where: { id: existingEntry.id },
          data: { active: true }
        });
      } else {
        // Neu erstellen und aktivieren
        await tx.tournamentWorkArea.create({
          data: {
            tournamentId,
            sourceWorkAreaId: stdArea.id,
            name: stdArea.name,
            icon: stdArea.icon,
            order: stdArea.order,
            color: stdArea.color,
            minVolunteers: stdArea.minVolunteers,
            maxVolunteers: stdArea.maxVolunteers,
            operatingStartMin: stdArea.operatingStartMin,
            operatingEndMin: stdArea.operatingEndMin,
            active: true
          }
        });
      }
    }
    
    // Alle anderen Katalog-Bereiche nur erstellen, wenn nicht vorhanden (standardmäßig inaktiv)
    const toCreate = catalog
      .filter(w => !w.isStandard && !known.has(w.id))
      .map(w => ({
        tournamentId,
        sourceWorkAreaId: w.id,
        name: w.name,
        icon: w.icon,
        order: w.order,
        color: w.color,
        minVolunteers: w.minVolunteers,
        maxVolunteers: w.maxVolunteers,
        operatingStartMin: w.operatingStartMin,
        operatingEndMin: w.operatingEndMin,
        active: false  // Nicht-Standard-Bereiche standardmäßig inaktiv
      }));
    if (toCreate.length) await tx.tournamentWorkArea.createMany({ data: toCreate });
    
    // WICHTIG: Alle nicht-Standard-Bereiche deaktivieren, die noch aktiv sind
    const nonStandardAreas = catalog.filter(w => !w.isStandard);
    for (const area of nonStandardAreas) {
      const existingEntry = known.get(area.id);
      if (existingEntry && existingEntry.active) {
        await tx.tournamentWorkArea.update({
          where: { id: existingEntry.id },
          data: { active: false }
        });
      }
    }
    
    // Bereinige bestehende Einträge, die auf gelöschte Katalog-Bereiche verweisen
    const orphaned = await tx.tournamentWorkArea.findMany({
      where: {
        tournamentId,
        sourceWorkAreaId: { not: null },
        NOT: { sourceWorkAreaId: { in: catalog.map(w => w.id) } }
      }
    });
    if (orphaned.length > 0) {
      await tx.tournamentWorkArea.deleteMany({
        where: {
          id: { in: orphaned.map(o => o.id) }
        }
      });
    }

    // Bereinige Einträge mit veraltetem Namen (Katalog-Eintrag wurde umbenannt)
    const renamedOrphaned = await tx.tournamentWorkArea.findMany({
      where: {
        tournamentId,
        sourceWorkAreaId: { not: null }
      }
    });
    for (const entry of renamedOrphaned) {
      const catalogEntry = catalog.find(w => w.id === entry.sourceWorkAreaId);
      if (catalogEntry && entry.name !== catalogEntry.name) {
        await tx.tournamentWorkArea.delete({ where: { id: entry.id } });
      }
    }

    // Bereinige auch manuell angelegte Bereiche ohne Katalog-Referenz, die nicht im aktuellen Katalog vorkommen
    const manualOrphaned = await tx.tournamentWorkArea.findMany({
      where: {
        tournamentId,
        sourceWorkAreaId: null,
        NOT: { name: { in: catalog.map(w => w.name) } }
      }
    });
    if (manualOrphaned.length > 0) {
      await tx.tournamentWorkArea.deleteMany({
        where: {
          id: { in: manualOrphaned.map(o => o.id) }
        }
      });
    }

    // Auch bei bestehenden Bereichen die aktuelle Reihenfolge aus dem Katalog synchronisieren
    for (const cat of catalog) {
      await tx.tournamentWorkArea.updateMany({
        where: { tournamentId, sourceWorkAreaId: cat.id },
        data: { order: cat.order }
      });
    }
  });

  const areas = await prisma.tournamentWorkArea.findMany({ where: { tournamentId }, orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
  return res.json(areas);
};

/**
 * Uebernimmt EINEN Katalog-Arbeitsbereich in ein Turnier und aktiviert ihn.
 *
 * Der Weg ueber "sync" holt immer den gesamten Katalog und ist auf die
 * Einrichtung eines Turniers zugeschnitten. Wenn waehrend des laufenden
 * Turniers ein einzelner Bereich dazukommt ("wir brauchen doch noch
 * Fussballgolf"), soll das direkt beim Anlegen der Schicht gehen, ohne Umweg
 * ueber den Generator und ohne alles neu zu erzeugen.
 *
 * Idempotent: ein bereits vorhandener Bereich wird nur aktiviert.
 */
export const adoptTournamentWorkArea = async (req: AuthRequest, res: Response) => {
  const { tournamentId, workAreaId } = req.body as z.infer<typeof tournamentWorkAreaAdoptSchema>;

  const katalog = await prisma.workArea.findUnique({ where: { id: workAreaId } });
  if (!katalog) return res.status(404).json({ error: 'Arbeitsbereich nicht im Katalog gefunden' });

  // Nach Herkunft suchen, ersatzweise nach Namen: manuell angelegte Bereiche
  // eines Turniers tragen keine sourceWorkAreaId.
  const vorhanden = await prisma.tournamentWorkArea.findFirst({
    where: { tournamentId, OR: [{ sourceWorkAreaId: workAreaId }, { sourceWorkAreaId: null, name: katalog.name }] }
  });

  if (vorhanden) {
    const aktiviert = vorhanden.active
      ? vorhanden
      : await prisma.tournamentWorkArea.update({ where: { id: vorhanden.id }, data: { active: true } });
    if (!vorhanden.active) {
      await protokolliere({
        tournamentId, userId: req.userId, art: 'stammdaten',
        beschreibung: `hat den Arbeitsbereich ${aktiviert.name} im Turnier wieder aktiviert`,
        objektTyp: 'tournamentWorkArea', objektId: aktiviert.id
      });
    }
    return res.status(200).json(aktiviert);
  }

  const erstellt = await prisma.tournamentWorkArea.create({
    data: {
      tournamentId,
      sourceWorkAreaId: katalog.id,
      name: katalog.name,
      icon: katalog.icon,
      order: katalog.order,
      color: katalog.color,
      minVolunteers: katalog.minVolunteers,
      maxVolunteers: katalog.maxVolunteers,
      operatingStartMin: katalog.operatingStartMin,
      operatingEndMin: katalog.operatingEndMin,
      active: true
    }
  });
  await protokolliere({
    tournamentId, userId: req.userId, art: 'stammdaten',
    beschreibung: `hat den Arbeitsbereich ${erstellt.name} ins Turnier geholt`,
    objektTyp: 'tournamentWorkArea', objektId: erstellt.id
  });

  return res.status(201).json(erstellt);
};

export const updateTournamentWorkArea = async (req: Request, res: Response) => {
  const area = await prisma.tournamentWorkArea.update({
    where: { id: parseInt(req.params.id as string) },
    data: req.body
  });
  return res.json(area);
};

// ==================== TournamentDay ====================
export const listTournamentDays = async (req: Request, res: Response) => {
  const tournamentId = req.query.tournamentId ? parseInt(String(req.query.tournamentId)) : null;
  if (!tournamentId) return res.status(400).json({ error: 'tournamentId erforderlich' });
  const days = await prisma.tournamentDay.findMany({
    where: { tournamentId },
    orderBy: [{ order: 'asc' }, { date: 'asc' }],
    // Chronologisch sortiert (siehe listDayTemplates) – ein mittig eingefügter
    // Slot erscheint an seiner zeitlichen Position.
    include: { slots: { orderBy: [{ startMin: 'asc' }, { endMin: 'asc' }, { id: 'asc' }] } }
  });
  return res.json(days);
};

/** Legt einen Turniertag an; mit templateId wird pro TemplateWorkArea ein DaySlot angelegt (1:1). */
export const createTournamentDay = async (req: Request, res: Response) => {
  const { tournamentId, date, label, order, templateId } = req.body;
  const day = await prisma.$transaction(async (tx) => {
    const d = await tx.tournamentDay.create({
      data: { tournamentId, date: new Date(date), label: label ?? null, order: order ?? 0, sourceTemplateId: templateId ?? null }
    });
    if (templateId) {
      // Ein Slot je ZEITFENSTER der Vorlage, nicht je Arbeitsbereich: mehrere
      // Bereiche teilen sich dieselbe Uhrzeit und damit denselben Slot.
      const twas = await tx.templateWorkArea.findMany({ where: { templateId }, orderBy: [{ startMin: 'asc' }] });
      const fenster = new Map<string, { startMin: number; endMin: number }>();
      for (const twa of twas) {
        fenster.set(`${twa.startMin}-${twa.endMin}`, { startMin: twa.startMin, endMin: twa.endMin });
      }
      if (fenster.size) {
        // Der Tag wurde eine Anweisung zuvor erst angelegt, es kann hier also
        // noch keine bestehenden Slots geben - createMany genuegt.
        await tx.daySlot.createMany({
          data: Array.from(fenster.values())
            .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
            .map((f, i) => ({
              tournamentDayId: d.id, startMin: f.startMin, endMin: f.endMin,
              label: null, color: '#3b98f8', order: i
            }))
        });
      }
    }
    return d;
  });
  const full = await prisma.tournamentDay.findUnique({ where: { id: day.id }, include: { slots: { orderBy: [{ startMin: 'asc' }, { endMin: 'asc' }, { id: 'asc' }] } } });
  return res.status(201).json(full);
};

export const updateTournamentDay = async (req: Request, res: Response) => {
  const { date, label, order } = req.body;
  const data: Record<string, unknown> = {};
  if (date !== undefined) data.date = new Date(date);
  if (label !== undefined) data.label = label;
  if (order !== undefined) data.order = order;
  const day = await prisma.tournamentDay.update({ where: { id: parseInt(req.params.id as string) }, data });
  return res.json(day);
};

export const deleteTournamentDay = async (req: Request, res: Response) => {
  await prisma.tournamentDay.delete({ where: { id: parseInt(req.params.id as string) } });
  return res.status(204).send();
};

export const exportDayToTemplate = async (req: Request, res: Response) => {
  const tournamentDayId = parseInt(req.params.id as string);
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name der Vorlage erforderlich' });

  const day = await prisma.tournamentDay.findUnique({
    where: { id: tournamentDayId },
    include: {
      slots: true,
      shifts: {
        include: {
          workArea: true,
          daySlot: true
        }
      }
    }
  });
  if (!day) return res.status(404).json({ error: 'Turniertag nicht gefunden' });

  const intervalsMap = new Map<string, { startMin: number; endMin: number; shifts: typeof day.shifts }>();
  
  for (const s of day.shifts) {
    const st = s.startMin ?? s.daySlot?.startMin ?? 480;
    const en = s.endMin ?? s.daySlot?.endMin ?? 1080;
    const key = `${st}-${en}`;
    if (!intervalsMap.has(key)) {
      intervalsMap.set(key, { startMin: st, endMin: en, shifts: [] });
    }
    intervalsMap.get(key)!.shifts.push(s);
  }

  const createdTemplate = await prisma.$transaction(async (tx) => {
    const tmpl = await tx.globalDayTemplate.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null
      }
    });

    // TemplateWorkAreas direkt erstellen (keine GlobalDaySlot-Zwischentabelle mehr)
    const sortedIntervals = Array.from(intervalsMap.values()).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    for (const interval of sortedIntervals) {
      const workAreaIds = new Set<number>();
      for (const s of interval.shifts) {
        if (s.workArea?.sourceWorkAreaId) {
          workAreaIds.add(s.workArea.sourceWorkAreaId);
        } else if (s.workArea?.name) {
          const match = await tx.workArea.findFirst({ where: { name: s.workArea.name, isObsolete: false } });
          if (match) workAreaIds.add(match.id);
        }
      }

      for (const waId of workAreaIds) {
        await tx.templateWorkArea.create({
          data: {
            templateId: tmpl.id,
            workAreaId: waId,
            startMin: interval.startMin,
            endMin: interval.endMin
          }
        });
      }
    }

    return tx.globalDayTemplate.findUnique({
      where: { id: tmpl.id },
      include: { workAreas: true }
    });
  });

  return res.status(201).json(createdTemplate);
};

// ==================== DaySlot ====================
/**
 * Legt ein Zeitfenster fuer einen Tag an - oder liefert das bestehende zurueck,
 * falls es diese Uhrzeit dort schon gibt. Ein Fenster existiert pro Tag genau
 * einmal; ein zweiter Anlauf mit denselben Zeiten ist deshalb kein Fehler,
 * sondern liefert schlicht denselben Slot.
 */
export const addDaySlot = async (req: Request, res: Response) => {
  const { tournamentDayId, startMin, endMin, label, color, order } = req.body;
  if (endMin <= startMin) return res.status(400).json({ error: 'endMin muss größer als startMin sein' });

  const vorhanden = await prisma.daySlot.findUnique({
    where: { tournamentDayId_startMin_endMin: { tournamentDayId, startMin, endMin } }
  });
  if (vorhanden) return res.status(200).json(vorhanden);

  const slot = await prisma.daySlot.create({
    data: { tournamentDayId, startMin, endMin, label: label ?? null, color: color || '#3b98f8', order: order ?? 0 }
  });
  return res.status(201).json(slot);
};

/**
 * Verschiebt ein Zeitfenster - und alles, was daran haengt.
 *
 * Schichten ohne eigene Uhrzeit erben ihre Zeit von diesem Fenster. Wandert es,
 * wandern sie mit, und zwar gleich reihenweise ueber alle Arbeitsbereiche des
 * Tages. Genau hier ist frueher stillschweigend auseinandergelaufen, was die
 * Helfer sehen und wann sie tatsaechlich gebraucht werden: die bei ihnen
 * gespeicherte Zeit blieb stehen, und gesagt hat es ihnen auch niemand.
 *
 * Eine Fensterverschiebung ist inhaltlich dasselbe Ereignis wie eine
 * Schichtverschiebung und verhaelt sich deshalb auch so.
 */
export const updateDaySlot = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string);

  const vorher = await prisma.daySlot.findUnique({
    where: { id },
    include: {
      day: true,
      shifts: {
        include: {
          workArea: true,
          day: true,
          volunteerShifts: { select: { userId: true } }
        }
      }
    }
  });
  if (!vorher) return res.status(404).json({ error: 'Zeitfenster nicht gefunden' });

  // Gegen den Endzustand pruefen, nicht nur gegen den Request: wer allein
  // endMin schickt, koennte es sonst vor den unveraenderten Start legen.
  const startMin = req.body.startMin ?? vorher.startMin;
  const endMin = req.body.endMin ?? vorher.endMin;
  if (endMin <= startMin) {
    return res.status(400).json({ error: 'endMin muss größer als startMin sein' });
  }

  const zeitAenderung = startMin !== vorher.startMin || endMin !== vorher.endMin;

  // Welche Schichten erben ihre Zeit von diesem Fenster und aendern sich damit
  // wirklich? Schichten mit eigener Uhrzeit bleiben, wo sie sind.
  const betroffene = !zeitAenderung ? [] : vorher.shifts.filter(s => {
    const alt = effektiveZeit(s, vorher);
    const neu = effektiveZeit(s, { startMin, endMin });
    return alt.start !== neu.start || alt.ende !== neu.ende;
  });

  // Fenster und abhaengige Helferzeiten zusammen - ein Teilzustand waere
  // schlimmer als der alte, weil dann niemand mehr weiss, was gilt.
  const nachher = await prisma.$transaction(async (tx) => {
    const aktualisiert = await tx.daySlot.update({ where: { id }, data: req.body });

    for (const s of betroffene) {
      if (s.volunteerShifts.length === 0) continue;
      const neu = effektiveZeit(s, { startMin, endMin });
      if (neu.start == null || neu.ende == null) continue;
      await tx.volunteerShift.updateMany({
        where: { shiftId: s.id },
        data: { slot: slotText(neu.start, neu.ende) }
      });
    }

    return aktualisiert;
  });

  if (!zeitAenderung) return res.json(nachher);

  // Erst nach der Transaktion melden: schlaegt sie fehl, wurde nichts geaendert
  // und es darf auch nichts gemeldet werden.
  for (const s of betroffene) {
    await benachrichtigeBeiZeitaenderung(
      { ...s, daySlot: vorher },
      { startMin: s.startMin, endMin: s.endMin, daySlot: { startMin, endMin } }
    );
  }

  const umgetragen = betroffene.reduce((summe, s) => summe + s.volunteerShifts.length, 0);
  await protokolliere({
    tournamentId: vorher.day.tournamentId,
    userId: req.userId,
    art: 'schicht',
    beschreibung: `hat das Zeitfenster am ${datumKurz(vorher.day.date)} von `
      + `${minToTime(vorher.startMin)}-${minToTime(vorher.endMin)} auf `
      + `${minToTime(startMin)}-${minToTime(endMin)} verschoben`
      + (umgetragen > 0 ? ` (${umgetragen} eingeplante Helfer wurden umgetragen)` : ''),
    objektTyp: 'daySlot',
    objektId: id
  });

  return res.json(nachher);
};

export const deleteDaySlot = async (req: Request, res: Response) => {
  await prisma.daySlot.delete({ where: { id: parseInt(req.params.id as string) } });
  return res.status(204).send();
};

// ==================== Shift-Generierung ====================
/**
 * Erzeugt Shifts aus (Tag × Slot × Area), aber NUR fuer Kombinationen, die die
 * zugrundeliegende Tag-Vorlage fuer dieses Zeitfenster auch tatsaechlich
 * vorsieht (TemplateWorkArea). Ein aktiver Turnier-Arbeitsbereich, der in
 * KEINER Vorlage einem Fenster zugeordnet ist, wird NICHT automatisch irgendwo
 * eingefuegt - er erscheint stattdessen in `orphanedActiveAreas`, damit der
 * Admin bewusst entscheidet (Vorlage ergaenzen oder Bereich fuers Turnier
 * deaktivieren).
 *
 * Die Zuordnung Fenster → Bereiche laeuft ueber die Uhrzeit. Fuer von Hand
 * angelegte Zeiten, die in der Vorlage nicht vorkommen, gibt es keine
 * Katalog-Einschraenkung - dort darf jeder aktive Bereich eingeplant werden.
 *
 * Idempotent (ueberspringt bereits existierende Kombinationen) und
 * transaktional; bestehende Shifts inkl. Helfer-Zuweisungen bleiben
 * unangetastet.
 */
export const generateShifts = async (req: Request, res: Response) => {
  const tournamentId = Number(req.body.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'tournamentId erforderlich' });

  const result = await prisma.$transaction(async (tx) => {
    const days = await tx.tournamentDay.findMany({ where: { tournamentId }, include: { slots: true } });

    // Slots NICHT mit Vorlage synchronisieren – nur Shifts aus bestehenden Slots erstellen.
    // Slot-Zeiten werden NUR bei "Tag neu importieren" (createTournamentDay) gesetzt.
    // generateShifts darf bestehende Slot-Zeiten niemals ändern!

    // Reload days
    const daysSynced = await tx.tournamentDay.findMany({ where: { tournamentId }, include: { slots: true } });

    const areas = await tx.tournamentWorkArea.findMany({ where: { tournamentId, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }] });

    const existing = await tx.shift.findMany({
      where: { tournamentId },
      select: { tournamentDayId: true, daySlotId: true, tournamentWorkAreaId: true }
    });
    const seen = new Set(existing.map(e => `${e.tournamentDayId}-${e.daySlotId}-${e.tournamentWorkAreaId}`));

    // Hole alle TemplateWorkAreas für Templates die von Turnier-Tagen verwendet werden
    const templateIds = daysSynced.map(d => d.sourceTemplateId).filter((id): id is number => id != null);
    const allTemplateTWAs = templateIds.length
      ? await tx.templateWorkArea.findMany({ where: { templateId: { in: templateIds } } })
      : [];

    /**
     * Welche Katalog-Bereiche sieht eine Vorlage fuer ein bestimmtes
     * Zeitfenster vor? Die Zuordnung laeuft ueber die Uhrzeit, seit ein Slot
     * ein Zeitfenster des Tages ist und nicht mehr die Kopie eines einzelnen
     * Vorlagen-Eintrags. Mehrere Bereiche im selben Fenster landen damit
     * korrekt im selben Slot.
     */
    const fensterZuBereichen = new Map<string, Set<number>>();
    const fensterKey = (templateId: number, startMin: number, endMin: number) => `${templateId}|${startMin}-${endMin}`;
    for (const twa of allTemplateTWAs) {
      const key = fensterKey(twa.templateId, twa.startMin, twa.endMin);
      if (!fensterZuBereichen.has(key)) fensterZuBereichen.set(key, new Set());
      fensterZuBereichen.get(key)!.add(twa.workAreaId);
    }

    /** Bereiche, die die Vorlage fuer genau diesen Slot vorsieht - leer heisst "keine Einschraenkung". */
    const bereicheFuerSlot = (day: typeof daysSynced[number], slot: { startMin: number; endMin: number }): Set<number> => {
      if (day.sourceTemplateId == null) return new Set();
      return fensterZuBereichen.get(fensterKey(day.sourceTemplateId, slot.startMin, slot.endMin)) ?? new Set();
    };

    // Nur relevant, wenn JEDER Slot des Turniers aus einer Vorlage stammt
    const allSlotsHaveTemplate = daysSynced.every(d => d.slots.every(s => bereicheFuerSlot(d, s).size > 0));
    const usedCatalogWorkAreaIds = new Set<number>();

    // Zielhelfer pro Tag laden (targetHelpers aus DayWorkArea)
    const dayWorkAreasMap = new Map<number, Map<number, number>>();
    for (const day of daysSynced) {
      const dwaList = await tx.tournamentDayWorkArea.findMany({
        where: { tournamentDayId: day.id, active: true },
        select: { id: true, targetHelpers: true, tournamentWorkAreaId: true }
      });
      const map = new Map<number, number>();
      for (const dwa of dwaList) {
        if (dwa.targetHelpers != null && dwa.targetHelpers > 0) {
          map.set(dwa.tournamentWorkAreaId, dwa.targetHelpers);
        }
      }
      dayWorkAreasMap.set(day.id, map);
    }

    const toCreate: { tournamentId: number; tournamentDayId: number; daySlotId: number; tournamentWorkAreaId: number; startMin: number | null; endMin: number | null; minVolunteers: number; maxVolunteers: number }[] = [];
    for (const day of daysSynced) {
      const targetHelpersMap = dayWorkAreasMap.get(day.id);
      
      for (const slot of day.slots) {
        // Welche Katalog-Bereiche sieht die Vorlage fuer dieses Zeitfenster vor?
        const sourceWaIds = bereicheFuerSlot(day, slot);

        for (const area of areas) {
          // Vorlagen-Filter: Bei Slots mit Katalog-Herkunft nur Areas erzeugen,
          // die dort auch zugeordnet sind. Slots ohne Herkunft sind uneingeschränkt.
          if (sourceWaIds.size > 0) {
            const sourceWaId = area.sourceWorkAreaId;
            if (!sourceWaId || !sourceWaIds.has(sourceWaId)) continue;
            usedCatalogWorkAreaIds.add(sourceWaId);
          }

          // Slot-Zeiten unveraendert uebernehmen - keine Zuschneidung durch
          // Betriebszeiten. Template-Slot-Zeiten sind explizit gesetzt und
          // duerfen nicht durch operatingStartMin/EndMin ueberschrieben werden.
          const key = `${day.id}-${slot.id}-${area.id}`;
          if (seen.has(key)) continue;
          
          // Zielhelfer aus DayWorkArea verwenden, wenn gesetzt
          const targetHelpers = targetHelpersMap?.get(area.id);
          toCreate.push({
            tournamentId,
            tournamentDayId: day.id,
            daySlotId: slot.id,
            tournamentWorkAreaId: area.id,
            // Immer null - Schicht folgt immer den Slot-Zeiten.
            startMin: null,
            endMin: null,
            minVolunteers: area.minVolunteers,
            maxVolunteers: targetHelpers ?? area.maxVolunteers
          });
        }
      }
    }
    if (toCreate.length) await tx.shift.createMany({ data: toCreate });

    const orphanedActiveAreas = allSlotsHaveTemplate
      ? areas.filter(a => a.sourceWorkAreaId && !usedCatalogWorkAreaIds.has(a.sourceWorkAreaId)).map(a => a.name)
      : [];

    return { created: toCreate.length, existing: existing.length, orphanedActiveAreas };
  });

  return res.json({ success: true, ...result });
};

/**
 * Loescht alle generierten Shifts (inkl. daraus resultierender Helfer-
 * Zuweisungen) fuer ein Turnier, um die Planung neu zu konfigurieren.
 */
export const clearShifts = async (req: Request, res: Response) => {
  const tournamentId = Number(req.body.tournamentId);
  if (!tournamentId) return res.status(400).json({ error: 'tournamentId erforderlich' });

  const result = await prisma.$transaction(async (tx) => {
    const shiftCount = await tx.shift.count({ where: { tournamentId } });
    const volunteerShiftCount = await tx.volunteerShift.count({ where: { shift: { tournamentId } } });
    await tx.shift.deleteMany({ where: { tournamentId } }); // kaskadiert VolunteerShift
    return { deletedShifts: shiftCount, deletedVolunteerShifts: volunteerShiftCount };
  });

  return res.json({ success: true, ...result });
};

// ==================== TournamentDayWorkArea ====================
/** Liefert alle WorkAreas für einen Tag: aktive (links) + Katalog (rechts). */
export const getDayWorkAreas = async (req: Request, res: Response) => {
  const dayId = parseInt(req.params.dayId as string);
  if (isNaN(dayId)) return res.status(400).json({ error: 'dayId erforderlich' });

  const day = await prisma.tournamentDay.findUnique({ where: { id: dayId } });
  if (!day) return res.status(404).json({ error: 'Turniertag nicht gefunden' });

  // Aktive WorkAreas dieses Turniers (mit existing DayWorkArea-Einträgen)
  const active = await prisma.tournamentDayWorkArea.findMany({
    where: { tournamentDayId: dayId, active: true },
    include: { workArea: true },
    orderBy: [{ order: 'asc' }]
  });

  // Alle aktiven TournamentWorkAreas (Katalog für dieses Turnier)
  const all = await prisma.tournamentWorkArea.findMany({
    where: { tournamentId: day.tournamentId, active: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }]
  });

  return res.json({ day, active, all });
};

/** Lädt alle aktiven TournamentDayWorkArea-Einträge für einen Tag (zeigt welche Arbeitsbereiche relevant sind). */
export const getDaySlotsWithWorkAreas = async (req: Request, res: Response) => {
  const dayId = parseInt(req.params.dayId as string);
  if (isNaN(dayId)) return res.status(400).json({ error: 'dayId erforderlich' });

  // Hole alle aktiven WorkArea-Einträge für diesen Tag
  const activeAreas = await prisma.tournamentDayWorkArea.findMany({
    where: { tournamentDayId: dayId, active: true },
    include: {
      workArea: true
    }
  });

  return res.json(activeAreas);
};

/** Sync: Erstellt TournamentDayWorkArea-Einträge NUR für die im Template (Tagtyp) vorgesehenen Arbeitsbereiche.
 * WICHTIG: Nur WorkAreas werden aktiviert, die in den Slots des zugewiesenen Templates verknüpft sind. */
export const syncDayWorkAreas = async (req: Request, res: Response) => {
  const dayId = parseInt(req.params.dayId as string);
  if (isNaN(dayId)) return res.status(400).json({ error: 'dayId erforderlich' });

  const day = await prisma.tournamentDay.findUnique({ where: { id: dayId } });
  if (!day) return res.status(404).json({ error: 'Turniertag nicht gefunden' });

  // Hole Template, falls vorhanden
  let templateWorkAreaIds: number[] = [];
  if (day.sourceTemplateId) {
    const template = await prisma.globalDayTemplate.findUnique({
      where: { id: day.sourceTemplateId },
      include: { workAreas: true }
    });
    if (template && template.workAreas) {
      // Sammle alle workAreaIds aus dem Template
      const ids = new Set<number>();
      for (const twa of template.workAreas) {
        ids.add(twa.workAreaId);
      }
      templateWorkAreaIds = Array.from(ids);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Hole alle aktiven TournamentWorkAreas dieses Turniers
    const allAreas = await tx.tournamentWorkArea.findMany({
      where: { tournamentId: day.tournamentId, active: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }]
    });

    // Filtere auf die, die im Template vorkommen (wenn Template existiert)
    const areas = templateWorkAreaIds.length > 0
      ? allAreas.filter(a => templateWorkAreaIds.includes(a.sourceWorkAreaId!))
      : allAreas;

    // Lösche ALLE bestehenden Einträge für diesen Tag
    await tx.tournamentDayWorkArea.deleteMany({
      where: { tournamentDayId: dayId }
    });

    let created = 0;
    for (const area of areas) {
      await tx.tournamentDayWorkArea.create({
        data: { 
          tournamentId: day.tournamentId, 
          tournamentDayId: dayId, 
          tournamentWorkAreaId: area.id, 
          active: true, 
          order: area.order,
          targetHelpers: area.minVolunteers
        }
      });
      created++;
    }

    return { created };
  });

  return res.json(result);
};

/** Aktualisiert targetHelpers für einen DayWorkArea-Eintrag. */
export const updateDayWorkAreaTargetHelpers = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: 'id erforderlich' });

  const { targetHelpers } = req.body as { targetHelpers?: number | null };
  const updated = await prisma.tournamentDayWorkArea.update({
    where: { id },
    data: { targetHelpers: targetHelpers ?? null }
  });
  return res.json(updated);
};

/** Entfernt einen WorkArea-Eintrag von einem Tag (inactive setzen). */
export const removeDayWorkArea = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: 'id erforderlich' });

  await prisma.tournamentDayWorkArea.update({
    where: { id },
    data: { active: false }
  });
  return res.status(204).send();
};

/** Fügt einen einzelnen WorkArea-Eintrag zu einem Tag hinzu. */
export const addDayWorkArea = async (req: Request, res: Response) => {
  const { tournamentDayId, tournamentWorkAreaId, order } = req.body as z.infer<typeof addDayWorkAreaSchema>;
  if (!tournamentDayId || !tournamentWorkAreaId) return res.status(400).json({ error: 'tournamentDayId und tournamentWorkAreaId erforderlich' });

  // tournamentId aus dem Tag holen
  const day = await prisma.tournamentDay.findUnique({ where: { id: tournamentDayId } });
  if (!day) return res.status(404).json({ error: 'Turniertag nicht gefunden' });

  const existing = await prisma.tournamentDayWorkArea.findUnique({ where: { tournamentDayId_tournamentWorkAreaId: { tournamentDayId, tournamentWorkAreaId } } });
  if (existing) return res.status(409).json({ error: 'Eintrag existiert bereits' });

  const workArea = await prisma.tournamentWorkArea.findUnique({ where: { id: tournamentWorkAreaId } });
  if (!workArea) return res.status(404).json({ error: 'Arbeitsbereich nicht gefunden' });

  const created = await prisma.tournamentDayWorkArea.create({
    data: { 
      tournamentId: day.tournamentId, 
      tournamentDayId, 
      tournamentWorkAreaId, 
      active: true, 
      order: order ?? workArea.order,
      targetHelpers: workArea.minVolunteers
    }
  });
  return res.status(201).json(created);
};
