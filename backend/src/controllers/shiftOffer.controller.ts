import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { notifyUsers, notifyUser } from '../utils/notify.js';
import { protokolliere, datumKurz } from '../utils/protokoll.js';
import { minToTime } from '../utils/schichtzeit.js';
import { ROLES } from '../utils/roles.js';

/**
 * Zeitangebote von Helfern.
 *
 * Wer eine Schicht nur teilweise kann, sagte bisher gar nicht zu - eine Zusage
 * ist alles oder nichts. Hier kann jemand stattdessen sagen "Samstag 9-12
 * haette ich Zeit".
 *
 * Ein angenommenes Angebot plant NIEMANDEN ein. Es ist eine Willensbekundung;
 * die Organisatoren schneiden die Schicht zu und planen dann regulaer ein.
 * Automatisch einzuplanen hiesse, Eintraege mit einer Zeit anzulegen, die von
 * der Schichtzeit abweicht - genau der Zustand, der die Uebersicht monatelang
 * falsche Zeiten anzeigen liess.
 */

export const shiftOfferSchema = z.object({
  tournamentId: z.number().int().positive(),
  shiftId: z.number().int().positive().nullable().optional(),
  /// Wunsch-Arbeitsbereich, unabhaengig von shiftId - "irgendwas am
  /// Grillstand" ist oft leichter zu beantworten als eine konkrete Schicht.
  workAreaId: z.number().int().positive().nullable().optional(),
  date: z.string().or(z.date()),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  note: z.string().max(500).nullable().optional()
}).refine(d => d.endMin > d.startMin, {
  message: 'Die Endzeit muss nach der Startzeit liegen.',
  path: ['endMin']
});

export const entscheidungSchema = z.object({
  status: z.enum(['ANGENOMMEN', 'ABGELEHNT']),
  decisionNote: z.string().max(500).nullable().optional()
});

const zeitraum = (startMin: number, endMin: number) => `${minToTime(startMin)}-${minToTime(endMin)}`;

/** Ein Helfer bietet Zeit an. Laeuft ueber das eigene Konto, nicht ueber Admin. */
export const createShiftOffer = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { tournamentId, shiftId, workAreaId, date, startMin, endMin, note } = req.body;

  // Doppelte Angebote fuer denselben Zeitraum abfangen - ein zweiter Anlauf
  // aus Unsicherheit soll den Organisatoren nicht dieselbe Zeile zweimal in
  // die Liste legen.
  const schonDa = await prisma.shiftOffer.findFirst({
    where: {
      userId, tournamentId, status: 'OFFEN',
      date: new Date(date), startMin, endMin
    }
  });
  if (schonDa) return res.status(200).json(schonDa);

  const angebot = await prisma.shiftOffer.create({
    data: {
      tournamentId, userId,
      shiftId: shiftId ?? null,
      workAreaId: workAreaId ?? null,
      date: new Date(date),
      startMin, endMin,
      note: note?.trim() || null
    },
    include: {
      user: { select: { name: true } },
      shift: { include: { workArea: true } },
      workArea: true
    }
  });

  // Die Organisatoren erfahren davon - sonst liegt das Angebot in einer Liste,
  // in die niemand schaut, und der Helfer wartet vergeblich.
  const organisatoren = await prisma.user.findMany({
    where: { userRoles: { some: { role: { in: [ROLES.ADMIN, ROLES.ORGANIZER] } } } },
    select: { id: true }
  });
  if (organisatoren.length > 0) {
    // Bezug auf eine konkrete Schicht ist praeziser als der reine Wunsch-Bereich.
    const bereich = angebot.shift?.workArea?.name ?? angebot.workArea?.name;
    await notifyUsers(
      organisatoren.map(o => o.id),
      '🙋 Neues Helfer-Angebot',
      () => `${angebot.user?.name ?? 'Ein Helfer'} bietet ${datumKurz(angebot.date)} `
        + `${zeitraum(startMin, endMin)} an${bereich ? ` (${bereich})` : ''}. `
        + 'Unter Organisation → Dienstplan kannst du entscheiden.',
      '/admin/organisation/uebersicht'
    );
  }

  return res.status(201).json(angebot);
};

/** Alle Angebote eines Turniers - fuer die Organisatoren. */
export const getShiftOffers = async (req: AuthRequest, res: Response) => {
  const tournamentId = parseInt(req.query.tournamentId as string, 10);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return res.status(400).json({ error: 'tournamentId ist erforderlich.' });
  }

  const angebote = await prisma.shiftOffer.findMany({
    where: { tournamentId },
    orderBy: [{ status: 'asc' }, { date: 'asc' }, { startMin: 'asc' }],
    include: {
      user: { select: { id: true, name: true, email: true } },
      shift: { include: { workArea: true, day: true } },
      workArea: true
    }
  });

  return res.json(angebote);
};

/** Die eigenen Angebote - damit im Self-Service sichtbar ist, was laeuft. */
export const getMyShiftOffers = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Nicht angemeldet' });

  const angebote = await prisma.shiftOffer.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
    include: { shift: { include: { workArea: true } }, workArea: true }
  });
  return res.json(angebote);
};

/**
 * Annehmen oder ablehnen.
 *
 * Beim Annehmen wird bewusst nichts eingeplant (siehe Kopf der Datei). Der
 * Helfer erfaehrt in beiden Faellen, woran er ist - ein Angebot, auf das nie
 * jemand antwortet, ist schlimmer als eine Absage.
 */
export const entscheideShiftOffer = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const { status, decisionNote } = req.body as { status: 'ANGENOMMEN' | 'ABGELEHNT'; decisionNote?: string | null };

  const vorher = await prisma.shiftOffer.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } }, shift: { include: { workArea: true } } }
  });
  if (!vorher) return res.status(404).json({ error: 'Angebot nicht gefunden' });
  if (vorher.status !== 'OFFEN') {
    return res.status(409).json({ error: 'Über dieses Angebot wurde bereits entschieden.' });
  }

  const angebot = await prisma.shiftOffer.update({
    where: { id },
    data: {
      status,
      decidedById: req.userId ?? null,
      decidedAt: new Date(),
      decisionNote: decisionNote?.trim() || null
    },
    include: { user: { select: { id: true, name: true } }, shift: { include: { workArea: true } } }
  });

  const zeit = zeitraum(angebot.startMin, angebot.endMin);
  const wann = `${datumKurz(angebot.date)} ${zeit}`;
  const zusatz = angebot.decisionNote ? ` (${angebot.decisionNote})` : '';

  await notifyUser(
    angebot.userId,
    status === 'ANGENOMMEN' ? '👍 Dein Angebot passt' : 'Dein Angebot',
    ({ vertretend, name }) => status === 'ANGENOMMEN'
      ? (vertretend
        ? `Das Angebot von ${name} für ${wann} passt uns. Die Schicht wird eingetragen.${zusatz}`
        : `Danke! Dein Angebot für ${wann} passt uns. Wir tragen die Schicht ein.${zusatz}`)
      : (vertretend
        ? `Für ${wann} brauchen wir ${name} nicht – danke fürs Anbieten!${zusatz}`
        : `Für ${wann} brauchen wir dich nicht – danke fürs Anbieten!${zusatz}`),
    '/'
  );

  await protokolliere({
    tournamentId: angebot.tournamentId,
    userId: req.userId,
    art: 'helfer',
    beschreibung: `hat das Zeitangebot von ${angebot.user?.name ?? 'einem Helfer'} für ${wann} `
      + (status === 'ANGENOMMEN' ? 'angenommen' : 'abgelehnt'),
    objektTyp: 'shift',
    objektId: angebot.shiftId
  });

  return res.json(angebot);
};

/** Zurueckziehen durch den Helfer selbst - solange noch nicht entschieden. */
export const deleteShiftOffer = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const angebot = await prisma.shiftOffer.findUnique({ where: { id } });
  if (!angebot) return res.status(404).json({ error: 'Angebot nicht gefunden' });
  if (angebot.userId !== req.userId) {
    return res.status(403).json({ error: 'Das ist nicht dein Angebot.' });
  }
  if (angebot.status !== 'OFFEN') {
    return res.status(409).json({ error: 'Über dieses Angebot wurde bereits entschieden.' });
  }

  await prisma.shiftOffer.delete({ where: { id } });
  return res.status(204).send();
};
