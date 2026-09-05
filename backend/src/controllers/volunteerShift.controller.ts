import { Request, Response } from 'express';
import prisma from '../config/prisma.js';
import { z } from 'zod';
import { notifyUser } from '../utils/notify.js';
import { AuthRequest } from '../middleware/auth.js';
import { protokolliere, datumKurz } from '../utils/protokoll.js';
import { aggregateFeedbackByWorkArea } from '../utils/ratingUtils.js';
import { berechneTurnierStatistik } from '../utils/turnierStatistik.js';
import { berechneZeitverlauf, reaktionAufAufruf, chronik } from '../utils/zeitverlauf.js';
import { berechneNutzungsStatistik } from '../utils/nutzungsStatistik.js';

export const volunteerShiftSchema = z.object({
  userId: z.union([z.number(), z.string()]).transform(Number),
  tournamentId: z.union([z.number(), z.string()]).transform(Number).optional().nullable(),
  shiftId: z.union([z.number(), z.string()]).transform(Number).optional().nullable(),
  date: z.string().datetime().or(z.date()),
  slot: z.string().min(1),
  role: z.string().min(1),
  areaId: z.string().optional().nullable()
});

export const getVolunteerShifts = async (req: Request, res: Response) => {
  const { tournamentId } = req.query;
  const where = tournamentId ? { tournamentId: parseInt(tournamentId as string) } : {};
  const shifts = await prisma.volunteerShift.findMany({
    where,
    orderBy: { date: 'asc' },
    include: {
      user: {
        include: { children: true, trainedYearGroups: true }
      }
    },
  });
  return res.json(shifts || []);
};

export const createVolunteerShift = async (req: AuthRequest, res: Response) => {
  const { userId, tournamentId, shiftId, date, slot, role, areaId } = req.body;
  const s = await prisma.volunteerShift.create({
    data: {
      userId: parseInt(userId as string),
      tournamentId: tournamentId ? parseInt(tournamentId as string) : null,
      shiftId: shiftId ? parseInt(shiftId as string) : null,
      date: new Date(date).toISOString(),
      slot, role, areaId: areaId || null,
      // Siehe self.controller: bewusst hier statt als Schema-Default.
      createdAt: new Date(),
    },
    include: { user: true }
  });

  if (s.userId) {
    await notifyUser(
      s.userId,
      'Schicht zugeteilt',
      ({ vertretend, name }) => vertretend
        ? `${name} wurde als ${s.role} (${s.slot}) eingeplant.`
        : `Du wurdest als ${s.role} (${s.slot}) eingeplant.`,
      '/'
    );
  }

  await protokolliere({
    tournamentId: s.tournamentId,
    userId: req.userId,
    art: 'helfer',
    beschreibung: `hat ${s.user?.name || 'einen Helfer'} für ${s.role} am ${datumKurz(s.date)}, ${s.slot} eingeplant`,
    objektTyp: 'shift',
    objektId: s.shiftId
  });

  return res.status(201).json(s);
};

export const updateVolunteerShift = async (req: Request, res: Response) => {
  const body = req.body;
  const { slot, role, userId, areaId, date, shiftId } = body;
  const validDate = date ? new Date(date) : undefined;
  
  const vorher = await prisma.volunteerShift.findUnique({ where: { id: parseInt(req.params.id as string) } });

  const updated = await prisma.volunteerShift.update({
    where: { id: parseInt(req.params.id as string) },
    data: {
      slot: slot || body.slot,
      role: role || body.role,
      userId: userId ? parseInt(userId as string) : body.userId,
      shiftId: shiftId !== undefined ? (shiftId ? parseInt(shiftId as string) : null) : undefined,
      areaId: areaId || body.areaId,
      date: validDate ? validDate.toISOString() : undefined,
    },
    include: { user: true }
  });

  // Umplanen war bisher voellig stumm: wer auf eine andere Zeit oder Aufgabe
  // geschoben wurde, erfuhr es nirgends.
  if (vorher) {
    const zeitOderRolleGeaendert = vorher.slot !== updated.slot || vorher.role !== updated.role
      || new Date(vorher.date).getTime() !== new Date(updated.date).getTime();
    if (zeitOderRolleGeaendert && updated.userId) {
      await notifyUser(
        updated.userId,
        'Schicht geändert',
        ({ vertretend, name }) => vertretend
          ? `Die Schicht von ${name} wurde geändert: jetzt ${updated.role} (${updated.slot}).`
          : `Deine Schicht wurde geändert: jetzt ${updated.role} (${updated.slot}).`,
        '/'
      );
    }
    // Auf eine andere Person umgetragen: die bisherige informieren.
    if (vorher.userId && updated.userId && vorher.userId !== updated.userId) {
      await notifyUser(
        vorher.userId,
        'Schicht entfallen',
        ({ vertretend, name }) => vertretend
          ? `${name} ist für ${vorher.role} (${vorher.slot}) nicht mehr eingeplant.`
          : `Du bist für ${vorher.role} (${vorher.slot}) nicht mehr eingeplant.`,
        '/'
      );
    }
  }

  return res.json(updated);
};

export const deleteVolunteerShift = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string);
  const existing = await prisma.volunteerShift.findUnique({ where: { id }, include: { user: true } });
  await prisma.volunteerShift.delete({ where: { id } });
  
  if (existing && existing.userId) {
    await notifyUser(
      existing.userId,
      'Schicht entfallen',
      ({ vertretend, name }) => vertretend
        ? `${name} wurde aus der Schicht ${existing.role} (${existing.slot}) ausgeplant.`
        : `Du wurdest aus der Schicht ${existing.role} (${existing.slot}) ausgeplant.`,
      '/'
    );
  }
  
  if (existing) {
    await protokolliere({
      tournamentId: existing.tournamentId,
      userId: req.userId,
      art: 'helfer',
      beschreibung: `hat ${existing.user?.name || 'einen Helfer'} aus ${existing.role} am ${datumKurz(existing.date)}, ${existing.slot} ausgeplant`,
      objektTyp: 'shift',
      objektId: existing.shiftId
    });
  }

  return res.status(204).send();
};

/**
 * Das Helfer-Feedback eines Turniers - mit Namen, Mailadressen und teils sehr
 * offenen Kommentaren.
 *
 * `tournamentId` ist Pflicht: ohne die Einschraenkung lieferte die Abfrage
 * frueher das Feedback saemtlicher Turniere auf einmal aus. Wer ein Turnier
 * organisiert, soll dessen Rueckmeldungen sehen - nicht das Archiv aller
 * anderen gleich mit.
 */
export const getFeedback = async (req: Request, res: Response) => {
  const tournamentId = parseInt(req.query.tournamentId as string, 10);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return res.status(400).json({ error: 'tournamentId ist erforderlich.' });
  }

  const where: Record<string, unknown> = { tournamentId };
  where.OR = [
    { ratingWorkload: { not: null } },
    { ratingOrganization: { not: null } },
    { ratingFun: { not: null } },
    { ratingComment: { not: null } }
  ];

  const feedbacks = await prisma.volunteerShift.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
      shift: { include: { workArea: true, daySlot: true, day: true } }
    }
  });

  // Die Auswertung entsteht hier und nicht im Browser: dieselbe Rechnung lag
  // frueher in beiden Schichten vor - und in beiden mit demselben Fehler.
  return res.json({
    feedbacks,
    auswertung: aggregateFeedbackByWorkArea(feedbacks)
  });
};


/**
 * Auswertung eines Turniers: Beteiligung, Lastverteilung, Jahrgänge, Lücken.
 *
 * Gerechnet wird in berechneTurnierStatistik() - hier wird nur geladen. Wie
 * beim Feedback ist tournamentId Pflicht: die Zahlen eines Turniers ergeben
 * nur für dieses Turnier einen Sinn, und die Namen darin gehen niemanden
 * etwas an, der ein anderes organisiert.
 */
export const getStatistik = async (req: Request, res: Response) => {
  const tournamentId = parseInt(req.query.tournamentId as string, 10);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return res.status(400).json({ error: 'tournamentId ist erforderlich.' });
  }

  const [shifts, einplanungen, tournament, mitglieder, spenden, aufrufe] = await Promise.all([
    prisma.shift.findMany({
      where: { tournamentId },
      include: { daySlot: true, day: true, workArea: true }
    }),
    prisma.volunteerShift.findMany({
      where: { tournamentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            children: { select: { childYear: true } },
            trainedYearGroups: { select: { id: true } }
          }
        }
      }
    }),
    prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { yearGroups: true }
    }),
    // Alle Turnier-Teilnehmer, nicht nur die eingeplanten: erst dadurch laesst
    // sich sagen, wer zum Jahrgang gehoert und nichts uebernommen hat.
    // Zwei Quellen, weil die Mitgliedschaft nachtraeglich eingefuehrt wurde
    // und die Turnier-Praeferenz am Nutzer bei manchen der einzige Hinweis ist.
    prisma.user.findMany({
      where: {
        OR: [
          { tournamentMemberships: { some: { tournamentId } } },
          { tournamentId }
        ]
      },
      select: {
        id: true,
        name: true,
        children: { select: { childYear: true } },
        trainedYearGroups: { select: { id: true } },
        // Fuer die App-Nutzung: wer ist erreichbar, wer war je da.
        createdAt: true,
        lastLoginAt: true,
        lastActivityAt: true,
        ohneZugang: true,
        kontaktpersonId: true,
        pushSubscriptions: { select: { id: true } },
        webAuthnCredentials: { select: { id: true } }
      }
    }),
    // Verpflegungsspenden zaehlen als Beteiligung - wer Kuchen beisteuert,
    // hat beigetragen, auch ohne Schicht.
    prisma.foodDonation.findMany({
      where: { tournamentId },
      select: {
        userId: true,
        createdAt: true,
        quantity: true,
        foodItem: { select: { name: true, unit: true } },
        user: {
          select: {
            id: true,
            name: true,
            children: { select: { childYear: true } },
            trainedYearGroups: { select: { id: true } }
          }
        }
      }
    }),
    // Die versendeten Aufrufe als Bezugspunkte im Verlauf.
    prisma.aufruf.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, titel: true, empfaenger: true, erreicht: true, createdAt: true }
    })
  ]);

  if (!tournament) return res.status(404).json({ error: 'Turnier nicht gefunden' });

  const statistik = berechneTurnierStatistik(
    shifts, einplanungen, tournament.yearGroups, mitglieder, spenden
  );

  // Zeitlicher Verlauf: wann kam was zusammen, und was ging an Aufrufen raus.
  const verlauf = berechneZeitverlauf(einplanungen, spenden, aufrufe);

  // App-Nutzung: nur fuer die Teilnehmer dieses Turniers, wie ueberall in
  // dieser Auswertung. Die Tagesreihe gibt es erst ab Einfuehrung der
  // Erfassung - lastLoginAt wird ueberschrieben und trug nie eine Historie.
  const nutzung = await prisma.nutzungTag.findMany({
    where: { userId: { in: mitglieder.map(m => m.id) } },
    select: { userId: true, tag: true, anmeldungen: true }
  });

  return res.json({
    ...statistik,
    nutzung: berechneNutzungsStatistik(mitglieder, nutzung),
    verlauf: {
      ...verlauf,
      // Wer wann was zugesagt hat - im Frontend hinter einem Schalter, weil es
      // Namen sind und nicht jeder Blick auf die Kurve sie braucht.
      chronik: chronik(
        einplanungen.map(e => ({
          createdAt: e.createdAt,
          name: e.user?.name,
          was: `${e.role}${e.slot ? ` ${e.slot}` : ''}`
        })),
        spenden.map(s => ({
          createdAt: s.createdAt,
          name: s.user?.name,
          was: s.foodItem ? `${s.quantity} ${s.foodItem.unit} ${s.foodItem.name}`.trim() : 'Spende'
        }))
      ),
      // Je Aufruf, was im Fenster danach passierte. Ein Anhaltspunkt, kein
      // Beweis - deshalb steht das Fenster als Zahl dabei.
      aufrufe: aufrufe.map(a => ({
        ...a,
        reaktion: reaktionAufAufruf(a, einplanungen, spenden)
      })),
      fensterStunden: 48
    }
  });
};
