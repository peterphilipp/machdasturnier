import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import prisma from '../config/prisma.js';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { logVolunteerUpdated, logClubCreated } from '../utils/logger.js';
import { sendPushToUser } from '../utils/push.js';
import { formatPhoneNumber } from '../utils/phone.js';
import { ensureTournamentMembership } from '../utils/tournamentMembership.js';
import { describeUserAgent } from '../utils/userAgent.js';
import { normalizeRoles, highestRole } from '../utils/roles.js';
import { setUserRoles, getUserRoles } from '../utils/userRoles.js';
import { sanitizeChildrenInput } from '../utils/sanitizeChildren.js';

// Gleiche Jahrgangs-Grenzen wie bei den Turnier-Jahrgängen selbst (Jahrgaenge.tsx),
// da genau darüber (childYear innerhalb YearGroup.birthYearStart/-End) die
// Zuordnung eines Kindes zu einem Jahrgang implizit erfolgt - es gibt kein
// eigenes Zuordnungsfeld, nur den Geburtsjahr-Abgleich.
const childSchema = z.object({
  childName: z.string().trim().max(100).nullable().optional(),
  childYear: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      if (typeof val === 'number' && isNaN(val)) return null;
      const parsed = parseInt(String(val), 10);
      return isNaN(parsed) ? null : parsed;
    },
    z.number().int().min(1900).max(2100).nullable().optional()
  )
});

export const volunteerSchema = z.object({
  name: z.string().min(1, 'Name ist erforderlich'),
  email: z.string().email('Ungültige E-Mail').optional().or(z.literal('')),
  phone: z.union([z.string(), z.literal('')]).nullable().optional().transform(val => val === undefined ? undefined : (formatPhoneNumber(val) ?? '')),
  // role bleibt fuer aeltere Clients erlaubt; roles ist der neue Weg.
  role: z.enum(['HELPER', 'ORGANIZER', 'ADMIN', 'TRAINER']).optional(),
  roles: z.array(z.enum(['HELPER', 'ORGANIZER', 'ADMIN', 'TRAINER'])).optional(),
  password: z.string().min(1).optional(),
  /** Helfer ohne App-Zugang (meist Jugendliche ohne eigenes Konto). */
  ohneZugang: z.boolean().optional(),
  /** An wen gehen Benachrichtigungen zu seinen Schichten - in der Regel ein Elternteil. */
  kontaktpersonId: z.number().int().positive().nullable().optional(),
  tournamentId: z.number().int().nullable().optional(),
  children: z.array(childSchema).max(20).optional(),
  trainedYearGroupIds: z.array(z.number().int()).optional()
});

export const updateVolunteerPasswordSchema = z.object({
  password: z.string().min(1, 'Passwort ist erforderlich').max(200, 'Passwort ist zu lang')
});

export const broadcastPushSchema = z.object({
  mode: z.enum(['all', 'shifts', 'users']),
  userIds: z.array(z.number().int().positive()).optional(),
  shiftIds: z.array(z.number().int().positive()).optional(),
  tournamentId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1, 'Titel ist erforderlich').max(200, 'Titel ist zu lang'),
  body: z.string().min(1, 'Nachrichtentext ist erforderlich').max(1000, 'Nachrichtentext ist zu lang'),
  url: z.string().max(500, 'URL ist zu lang').optional().or(z.literal(''))
});

/** Entfernt den Passwort-Hash aus einem User-Objekt, bevor es ausgeliefert wird. */
/**
 * Entfernt Geheimnisse (Passwort-Hash UND recoveryPin) aus einem User-Objekt.
 * Der recoveryPin erlaubt via POST /api/auth/reset-by-pin das Setzen eines neuen
 * Passworts – er darf hier nie ausgeliefert werden. Sonst könnte ein ORGANIZER
 * (requireAdmin lässt diese Rolle durch) den PIN des ADMIN auslesen und dessen
 * Konto übernehmen.
 */
const sanitizeUser = <T extends { password?: string | null; recoveryPin?: string | null }>(
  user: T
): Omit<T, 'password' | 'recoveryPin'> => {
  const { password, recoveryPin, ...safe } = user;
  return safe;
};

export const getVolunteers = async (req: AuthRequest, res: Response) => {
  const { tournamentId } = req.query;

  // Organisatoren dürfen die Helfer-Liste nur turniergebunden abfragen (z.B.
  // für Push-Targeting im eigenen Turnier, siehe PushBroadcast.tsx) - die
  // vollständige, turnierübergreifende Benutzerverwaltung ist Admins
  // vorbehalten (die Route selbst lässt beide Rollen durch, requireAdmin).
  if (req.role === 'ORGANIZER' && !tournamentId) {
    return res.status(403).json({ error: 'Nur Administratoren können die vollständige Benutzerliste einsehen.' });
  }

  // ODER über TournamentMembership/Schicht-Zuweisung: User.tournamentId ist
  // nur die aktuelle Präferenz (ein einzelner Wert) - ein Helfer kann in
  // mehreren Turnieren aktiv sein, ohne dass genau dieses Turnier gerade
  // sein "tournamentId" ist. Identische OR-Bedingung wie in broadcastPush()
  // weiter unten - diese Liste wird auch als Empfänger-Vorschau vor dem
  // Push-Versand verwendet (PushBroadcast.tsx) und muss deckungsgleich mit
  // den tatsächlichen Empfängern sein, sonst würde die Vorschau weniger
  // Helfer zeigen, als tatsächlich benachrichtigt werden.
  const users = await prisma.user.findMany({
    where: tournamentId ? {
      OR: [
        { tournamentId: Number(tournamentId) },
        { shifts: { some: { tournamentId: Number(tournamentId) } } },
        { tournamentMemberships: { some: { tournamentId: Number(tournamentId) } } }
      ]
    } : undefined,
    orderBy: { name: 'asc' },
    include: { children: true, trainedYearGroups: true, userRoles: true, kontaktperson: { select: { id: true, name: true } }, pushSubscriptions: { select: { id: true, userAgent: true, createdAt: true } } }
  });
  // Rolle als String zurückgeben; Passwort-Hash niemals ausliefern; Geräte-
  // Label serverseitig aus dem User-Agent ableiten (Detailansicht "auf
  // welchen Geräten ist Push aktiviert" in der Benutzerverwaltung).
  return res.json(users?.map(u => {
    const roles = u.userRoles.length > 0 ? normalizeRoles(u.userRoles.map(r => r.role)) : normalizeRoles(u.role);
    const { userRoles, ...rest } = u;
    return {
      ...sanitizeUser(rest),
      roles,
      // Einzelrolle weiterhin mitgeben, solange aeltere Clients sie lesen.
      role: highestRole(roles),
      pushSubscriptions: u.pushSubscriptions.map(ps => ({ ...ps, deviceLabel: describeUserAgent(ps.userAgent) }))
    };
  }) || []);
};

export const createVolunteer = async (req: Request, res: Response) => {
  const { trainedYearGroupIds, children, roles: rolesInput, ...body } = req.body;

  // Rollen bestimmen: bevorzugt die Liste, sonst die alte Einzelrolle.
  const roles = normalizeRoles(rolesInput ?? body.role);
  // users.role bleibt als Spiegel der hoechsten Stufe erhalten (Rollback).
  body.role = highestRole(roles);
  
  if (body.password) {
    body.password = await bcrypt.hash(body.password, 10);
  }

  const data: any = { ...body };
  if (trainedYearGroupIds) {
    data.trainedYearGroups = {
      connect: trainedYearGroupIds.map((id: number) => ({ id }))
    };
  }
  if (children !== undefined && children.length > 0) {
    data.children = {
      create: sanitizeChildrenInput(children as any)
    };
  }

  const user = await prisma.user.create({ data });
  await setUserRoles(user.id, roles);
  await ensureTournamentMembership(user.id, user.tournamentId);
  logVolunteerUpdated(user.id, { name: user.name }, 'created');
  return res.status(201).json(sanitizeUser(user));
};

export const deleteVolunteer = async (req: Request, res: Response) => {
  await prisma.volunteerShift.deleteMany({ where: { userId: parseInt(req.params.id as string) } });
  await prisma.userChild.deleteMany({ where: { userId: parseInt(req.params.id as string) } });
  await prisma.user.delete({ where: { id: parseInt(req.params.id as string) } });
  return res.status(204).send();
};

export const updateVolunteer = async (req: Request, res: Response) => {
  const { children, trainedYearGroupIds, ...rest } = req.body;

  // Rollen: die Liste hat Vorrang, die Einzelrolle bleibt als Rueckfallweg.
  const rolesInput = (rest as Record<string, unknown>).roles;
  delete (rest as Record<string, unknown>).roles;
  const neueRollen = (rolesInput !== undefined || rest.role !== undefined)
    ? normalizeRoles(rolesInput ?? rest.role)
    : null;
  if (neueRollen) rest.role = highestRole(neueRollen);

  const data: Record<string, unknown> = { ...rest };
  if (children !== undefined) {
    // Komplettersatz statt Diff: die Admin-Oberfläche schickt immer die volle,
    // aktuelle Liste - einfacher und robuster als einzelne Kinder per ID zu
    // matchen, und deckt sich mit dem Registrierungs-Flow (dort ebenfalls
    // vollstaendiges create statt Einzel-Updates). childName/childYear sind
    // in der DB Pflichtfelder (nicht nullable) - unvollstaendige Zeilen (nur
    // Name ODER nur Jahr) werden daher verworfen statt einen DB-Fehler zu
    // riskieren; das Frontend verhindert das ohnehin schon vor dem Absenden.
    data.children = {
      deleteMany: {},
      create: sanitizeChildrenInput(children as any)
    };
  }
  
  if (trainedYearGroupIds !== undefined) {
    data.trainedYearGroups = {
      set: trainedYearGroupIds.map((id: number) => ({ id }))
    };
  }

  const user = await prisma.user.update({
    where: { id: parseInt(req.params.id as string) },
    data,
    include: { children: true, trainedYearGroups: true }
  });
  if (neueRollen) await setUserRoles(user.id, neueRollen);
  if (data.tournamentId) await ensureTournamentMembership(user.id, data.tournamentId as number);
  logVolunteerUpdated(user.id, Object.keys(rest));
  return res.json({ ...sanitizeUser(user), roles: neueRollen ?? await getUserRoles(user.id) });
};

export const updateVolunteerPassword = async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Passwort fehlt' });
  
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({
    where: { id: parseInt(req.params.id as string) },
    data: { password: hashed }
  });
  return res.json({ success: true });
};

export const broadcastPush = async (req: Request, res: Response) => {
  const { mode, userIds, shiftIds, tournamentId, title, body, url } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Titel und Nachrichtentext sind erforderlich' });
  }

  let targetUserIds: number[] = [];

  if (mode === 'all') {
    if (tournamentId) {
      const usersInTournament = await prisma.user.findMany({
        where: {
          OR: [
            { tournamentId: Number(tournamentId) },
            { shifts: { some: { tournamentId: Number(tournamentId) } } },
            { tournamentMemberships: { some: { tournamentId: Number(tournamentId) } } }
          ]
        },
        select: { id: true }
      });
      targetUserIds = usersInTournament.map(u => u.id);
    } else {
      const allSubs = await prisma.pushSubscription.findMany({ select: { userId: true } });
      targetUserIds = allSubs.map(s => s.userId);
    }
  } else if (mode === 'users') {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Keine Empfänger ausgewählt' });
    }
    targetUserIds = userIds.map(Number).filter(id => !isNaN(id));
  } else if (mode === 'shifts') {
    if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
      return res.status(400).json({ error: 'Keine Schichten ausgewählt' });
    }
    const volShifts = await prisma.volunteerShift.findMany({
      where: { shiftId: { in: shiftIds.map(Number) } },
      select: { userId: true }
    });
    targetUserIds = volShifts.map(vs => vs.userId).filter((id): id is number => id !== null && id !== undefined);
  } else {
    return res.status(400).json({ error: 'Ungültiger Modus' });
  }

  const uniqueIds = Array.from(new Set(targetUserIds));
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: uniqueIds } },
    select: { userId: true }
  });
  const usersWithPush = Array.from(new Set(subscriptions.map(s => s.userId)));

  let sentCount = 0;
  for (const uid of usersWithPush) {
    await sendPushToUser(uid, title, body, url || '/');
    sentCount++;
  }

  return res.json({ success: true, targetedUsers: uniqueIds.length, sentPushCount: sentCount });
};

