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
import { ermittleMarke, versendeMails } from '../utils/mailVersand.js';
import { berechneTurnierStatistik } from '../utils/turnierStatistik.js';
import { VORLAGEN } from '../utils/mailVorlagen.js';
import type { DankeZahlen } from '../utils/mailVorlagen.js';

import { sanitizeChildrenInput } from '../utils/sanitizeChildren.js';

/**
 * Die Zahlen fuer die Dankesmail.
 *
 * Bewusst aus berechneTurnierStatistik() und nicht hier nachgerechnet: Die
 * Mail soll dieselben Zahlen nennen wie die Statistikansicht und der
 * Turnierabschluss. Zwei Rechnungen waeren zwei Wahrheiten, und ein Verein,
 * dem per Mail andere Zahlen genannt werden als im Bericht, glaubt am Ende
 * keiner von beiden.
 */
async function ermittleDankeZahlen(tournamentId: number): Promise<DankeZahlen | null> {
  const [shifts, einplanungen, turnier, mitglieder, spenden] = await Promise.all([
    prisma.shift.findMany({ where: { tournamentId }, include: { daySlot: true, day: true, workArea: true } }),
    prisma.volunteerShift.findMany({
      where: { tournamentId },
      include: { user: { select: { id: true, name: true, children: { select: { childYear: true } }, trainedYearGroups: { select: { id: true } } } } }
    }),
    prisma.tournament.findUnique({ where: { id: tournamentId }, include: { yearGroups: true } }),
    prisma.user.findMany({
      where: { OR: [{ tournamentMemberships: { some: { tournamentId } } }, { tournamentId }] },
      select: { id: true, name: true, children: { select: { childYear: true } }, trainedYearGroups: { select: { id: true } } }
    }),
    prisma.foodDonation.findMany({
      where: { tournamentId },
      select: { userId: true, user: { select: { id: true, children: { select: { childYear: true } }, trainedYearGroups: { select: { id: true } } } } }
    })
  ]);
  if (!turnier) return null;

  const s = berechneTurnierStatistik(shifts, einplanungen, turnier.yearGroups, mitglieder, spenden);
  return {
    beteiligte: s.eckdaten.beteiligte,
    stunden: s.eckdaten.stunden,
    schichten: s.eckdaten.schichten,
    spenden: s.eckdaten.spenden
  };
}

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
  // Fuer die Mail deutlich mehr Platz als fuer Push: Eine Push-Nachricht wird
  // vom Betriebssystem ohnehin nach zwei Zeilen abgeschnitten, eine Mail ist
  // ein Brief.
  body: z.string().min(1, 'Nachrichtentext ist erforderlich').max(5000, 'Nachrichtentext ist zu lang'),
  url: z.string().max(500, 'URL ist zu lang').optional().or(z.literal('')),
  /**
   * Welche Kanaele bedient werden. Leer waere eine Nachricht, die niemand
   * bekommt - deshalb mindestens einer.
   */
  kanaele: z.array(z.enum(['push', 'mail'])).min(1, 'Mindestens ein Kanal').optional(),
  vorlage: z.enum(['frei', 'appell', 'bewertung', 'danke']).optional(),
  /**
   * Nur an das eigene Konto schicken - zum Ansehen, bevor es an alle geht.
   * Ohne diesen Weg ist der erste echte Test immer ein Rundschreiben.
   */
  nurAnMich: z.boolean().optional()
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

/**
 * Die Mail-Vorlagen fuer den Nachrichten-Dialog.
 *
 * Kommen vom Server, statt im Frontend ein zweites Mal zu stehen: Es sind
 * formulierte deutsche Texte, und zwei Fassungen davon laufen unweigerlich
 * auseinander - dann schickt der Verein einen Aufruf, der anders klingt als
 * der, den jemand redigiert hat.
 */
export const getMailVorlagen = async (_req: Request, res: Response) => {
  return res.json(VORLAGEN);
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

  const kanaele: ('push' | 'mail')[] = req.body.kanaele?.length ? req.body.kanaele : ['push'];
  const vorlage = req.body.vorlage ?? 'frei';
  const eigeneId = (req as AuthRequest).userId ?? null;

  // Testversand: nur an das eigene Konto. Steht bewusst NACH der Ermittlung
  // der Zielgruppe, damit die angezeigte Reichweite dieselbe bleibt - man
  // testet die Nachricht, nicht einen anderen Empfaengerkreis.
  let uniqueIds = Array.from(new Set(targetUserIds));
  if (req.body.nurAnMich) {
    if (!eigeneId) return res.status(401).json({ error: 'Nicht angemeldet.' });
    uniqueIds = [eigeneId];
  }

  let sentCount = 0;
  if (kanaele.includes('push')) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: uniqueIds } },
      select: { userId: true }
    });
    const usersWithPush = Array.from(new Set(subscriptions.map(s => s.userId)));
    for (const uid of usersWithPush) {
      await sendPushToUser(uid, title, body, url || '/');
      sentCount++;
    }
  }

  /**
   * Der Mailkanal.
   *
   * Anlass: Es liegen deutlich mehr Mailadressen vor als Push-Abos - Push
   * erreicht nur, wer die App installiert UND Benachrichtigungen erlaubt hat.
   * Wer den Verein wirklich erreichen will, braucht die Mail.
   *
   * Helfer ohne App-Zugang bekommen keine eigene Mail: Sie haben in der Regel
   * gar keine Adresse hinterlegt, und wenn doch, gehoert sie oft der
   * Kontaktperson. Diese Kette hier nachzubauen waere eine zweite Wahrheit
   * neben notifyUser() - die Adressauswahl bleibt deshalb schlicht "wer eine
   * eigene Adresse hat".
   */
  let mailErgebnis = { gesendet: 0, fehlgeschlagen: 0, ohneAdresse: 0 };
  if (kanaele.includes('mail')) {
    const kandidaten = await prisma.user.findMany({
      where: { id: { in: uniqueIds }, ohneZugang: false },
      select: { id: true, name: true, email: true }
    });
    const mitAdresse = kandidaten.filter(
      (k): k is { id: number; name: string; email: string } => !!k.email?.trim()
    );

    const marke = await ermittleMarke(tournamentId ? Number(tournamentId) : null);
    const zahlen = vorlage === 'danke' && tournamentId
      ? await ermittleDankeZahlen(Number(tournamentId))
      : null;

    mailErgebnis = await versendeMails(
      mitAdresse,
      vorlage,
      // Das Turnier wird mitgegeben, weil die Bewertungsvorlage je Empfaenger
      // die zu bewertende Schicht braucht - siehe mailVersand.ts.
      { betreff: title, text: body, zahlen, tournamentId: tournamentId ? Number(tournamentId) : null },
      marke
    );
    mailErgebnis.ohneAdresse = kandidaten.length - mitAdresse.length;
  }

  // Den Aufruf festhalten, damit spaeter nachvollziehbar ist, was er bewirkt
  // hat. Ohne diesen Eintrag zeigt die Verlaufskurve nur Ausschlaege, aber
  // keinen Anlass. Festgehalten wird die erreichte Zahl, nicht die
  // angepeilte: Push kommt nur bei denen an, die es erlaubt haben.
  // Ein Testversand an einen selbst ist kein Aufruf an den Verein - er wuerde
  // die Verlaufskurve mit Ausschlaegen fuellen, die niemanden erreicht haben.
  if (tournamentId && !req.body.nurAnMich) {
    try {
      await prisma.aufruf.create({
        data: {
          tournamentId: Number(tournamentId),
          userId: eigeneId,
          titel: title,
          text: body,
          empfaenger: mode,
          erreicht: sentCount,
          erreichtMail: mailErgebnis.gesendet,
          kanaele: kanaele.join(',')
        }
      });
    } catch (err) {
      // Ein misslungener Protokolleintrag darf den Versand nicht nachtraeglich
      // als Fehler erscheinen lassen - die Nachricht ist raus.
      console.error('[broadcast] Aufruf konnte nicht protokolliert werden:', (err as Error).message);
    }
  }

  return res.json({
    success: true,
    targetedUsers: uniqueIds.length,
    sentPushCount: sentCount,
    mail: mailErgebnis,
    nurAnMich: !!req.body.nurAnMich
  });
};

