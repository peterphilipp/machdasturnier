import { Request, Response } from 'express';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { logJobAssigned, logJobUnassigned } from '../utils/logger.js';
import JWT_SECRET from '../config/jwt.js';
import { getVapidPublicKey as getPubKey } from '../utils/push.js';
import { ensureTournamentMembership } from '../utils/tournamentMembership.js';
import { isTrainer } from '../utils/roles.js';
import { getUserRoles } from '../utils/userRoles.js';
import { berechneTurnierStatistik } from '../utils/turnierStatistik.js';

// Öffentliche Self-Service-Endpunkte: Body-Formen entsprechen exakt dem, was
// das Frontend sendet (SelfServiceView.tsx / utils/push.ts) - hier werden nur
// plausible Grenzen ergänzt, kein neuer Vertrag erfunden.
export const assignShiftSchema = z.object({
  shiftId: z.number().int().positive('shiftId muss eine positive Ganzzahl sein'),
  // Wird vom Frontend mitgeschickt, aber vom Controller aktuell nicht verwendet.
  date: z.string().max(50).optional()
});

export const rateShiftSchema = z.object({
  ratingWorkload: z.number().int().min(1, 'Wert muss zwischen 1 und 5 liegen').max(5, 'Wert muss zwischen 1 und 5 liegen').nullable().optional(),
  ratingOrganization: z.number().int().min(1, 'Wert muss zwischen 1 und 5 liegen').max(5, 'Wert muss zwischen 1 und 5 liegen').nullable().optional(),
  ratingFun: z.number().int().min(1, 'Wert muss zwischen 1 und 5 liegen').max(5, 'Wert muss zwischen 1 und 5 liegen').nullable().optional(),
  ratingComment: z.string().max(1000, 'Kommentar darf maximal 1000 Zeichen lang sein').nullable().optional()
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url('Ungültiger Endpoint').max(2000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh erforderlich').max(500),
    auth: z.string().min(1, 'auth erforderlich').max(500)
  })
});

// Helper: Get userId from token
const getUserId = (req: Request): number | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const bearerToken = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(bearerToken, JWT_SECRET) as { userId: number };
    return decoded.userId;
  } catch {
    return null;
  }
};

/** Minuten seit Mitternacht → "HH:MM". */
const minToTime = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * "HH:MM" → Minuten seit Mitternacht. TimeSlot speichert die Zeiten als
 * Zeichenkette; null bei allem, was nicht diesem Muster entspricht, damit ein
 * gepflegter Unsinn-Wert nicht als 0 Uhr durchrutscht.
 */
const timeToMin = (t: string | null | undefined): number | null => {
  const treffer = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!treffer) return null;
  const h = Number(treffer[1]);
  const m = Number(treffer[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
};

async function resolveTournamentForUser(
  userId: number,
  requestedTournamentId?: number,
  userPreferredTournamentId?: number | null
) {
  // Alle aktiven Turniere sind grundsätzlich browsebar/umschaltbar - "Relevanz"
  // (Schicht/Spende/Jahrgang/Präferenz) bestimmt weiter unten NUR NOCH die
  // Standard-Vorauswahl, nicht mehr, was überhaupt sichtbar ist. Vorher wurde
  // ein zweites, noch "fremdes" Turnier (ohne bestehende Historie) komplett
  // ausgeblendet, sobald irgendein anderes Turnier für den User relevant war -
  // das war der gemeldete Bug ("neues Turnier wird gar nicht angezeigt").
  const activeTournaments = await prisma.tournament.findMany({
    where: { status: 'aktiv' },
    orderBy: { startDate: 'desc' },
    include: { yearGroups: true }
  });

  // Abgeschlossene Turniere nur, wenn der User dort nachweislich mitgewirkt
  // hat (TournamentMembership) - sonst sähe jeder User auf Dauer jedes
  // jemals abgeschlossene Turnier im Umschalter.
  const membershipRows = await prisma.tournamentMembership.findMany({
    where: { userId },
    select: { tournamentId: true }
  });
  const memberTournamentIds = membershipRows.map(m => m.tournamentId);

  const pastTournaments = memberTournamentIds.length > 0
    ? await prisma.tournament.findMany({
        where: { id: { in: memberTournamentIds }, status: { not: 'aktiv' } },
        orderBy: { startDate: 'desc' },
        include: { yearGroups: true }
      })
    : [];

  // Reihenfolge bewusst: erst alle aktiven (neueste zuerst), dann alle
  // abgeschlossenen (neueste zuerst) - das Frontend gruppiert danach 1:1 in
  // "Anstehend/Aktiv" und "Abgeschlossen", ohne selbst neu sortieren zu müssen.
  const allBrowsable = [...activeTournaments, ...pastTournaments];

  if (allBrowsable.length === 0) {
    return { targetTournamentId: null, availableTournaments: [] };
  }

  const userShifts = await prisma.volunteerShift.findMany({
    where: { userId },
    select: { tournamentId: true }
  });
  const shiftTournamentIds = new Set(userShifts.map(s => s.tournamentId));

  const userDonations = await prisma.foodDonation.findMany({
    where: { userId },
    select: { tournamentId: true }
  });
  const donationTournamentIds = new Set(userDonations.map(d => d.tournamentId));

  const userChildren = await prisma.userChild.findMany({ where: { userId } });
  const userChildYears = userChildren.map(c => c.childYear);

  const isRelevant = (t: (typeof activeTournaments)[number]) => {
    if (shiftTournamentIds.has(t.id)) return true;
    if (donationTournamentIds.has(t.id)) return true;
    if (userPreferredTournamentId === t.id) return true;

    // Check if any year group matches any child year
    const hasMatchingYearGroup = t.yearGroups.some(yg =>
      userChildYears.some(childYear => childYear >= yg.birthYearStart && childYear <= yg.birthYearEnd)
    );
    if (hasMatchingYearGroup) return true;

    return false;
  };

  const relevantActive = activeTournaments.filter(isRelevant);
  // Vorauswahl-Pool: relevante aktive Turniere, sonst irgendein aktives -
  // abgeschlossene Turniere werden nie automatisch vorausgewählt.
  const defaultPool = relevantActive.length > 0 ? relevantActive : activeTournaments;

  let targetTournamentId: number | null = null;
  if (requestedTournamentId && allBrowsable.some(t => t.id === requestedTournamentId)) {
    targetTournamentId = requestedTournamentId;
  } else if (userPreferredTournamentId && allBrowsable.some(t => t.id === userPreferredTournamentId)) {
    targetTournamentId = userPreferredTournamentId;
  } else if (defaultPool.length > 0) {
    targetTournamentId = defaultPool[0].id;
  } else {
    targetTournamentId = allBrowsable[0].id;
  }

  return {
    targetTournamentId,
    availableTournaments: allBrowsable.map(t => ({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, status: t.status }))
  };
}

export const getAvailable = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { children: true, userRoles: { select: { role: true } } }
  });

  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

  const requestedTournamentId = req.query.tournamentId ? parseInt(req.query.tournamentId as string) : undefined;
  
  const { targetTournamentId, availableTournaments } = await resolveTournamentForUser(
    userId,
    requestedTournamentId,
    user.tournamentId
  );

  // Optional: Update preference implicitly if they switched explicitly
  if (requestedTournamentId && targetTournamentId === requestedTournamentId && user.tournamentId !== targetTournamentId) {
    await prisma.user.update({ where: { id: userId }, data: { tournamentId: targetTournamentId } });
  }

  if (!targetTournamentId) {
    return res.json({ shifts: [], volunteerShifts: [], betreuteVolunteerShifts: [], volunteer: null });
  }

  const shifts = await prisma.shift.findMany({
    where: { tournamentId: targetTournamentId },
    include: { day: true, daySlot: true, workArea: true },
    orderBy: [{ tournamentDayId: 'asc' }, { daySlotId: 'asc' }, { workArea: { order: 'asc' } }, { id: 'asc' }]
  });

  // NUR die eigenen Zusagen. Vorher kamen hier alle Zusagen des Turniers
  // zurueck, und das Frontend zeigte sie ungefiltert unter "Deine Jobs" an -
  // jeder sah also die Schichten aller anderen als seine eigenen. Nebenbei
  // gingen dabei die Namen saemtlicher Teilnehmer an jeden Client, obwohl sie
  // im Self-Service nirgends angezeigt werden.
  const volunteerShifts = await prisma.volunteerShift.findMany({
    where: { tournamentId: targetTournamentId, userId },
    include: {
      shift: { include: { day: true, daySlot: true, workArea: true } }
    }
  });

  // Schichten der Helfer ohne App-Zugang, fuer die dieser Nutzer als
  // Kontaktperson hinterlegt ist. Ohne eigenes Konto erfaehrt so jemand von
  // seiner Einteilung nur einmalig per Push an die Kontaktperson - schaut die
  // spaeter nochmal nach, fand sie bisher nichts mehr. Bewusst getrennt von
  // den eigenen Zusagen (volunteerShifts oben), damit die Oberflaeche "meine"
  // und "die von X" nicht vermischt.
  const betreuteVolunteerShifts = await prisma.volunteerShift.findMany({
    where: { tournamentId: targetTournamentId, user: { kontaktpersonId: userId } },
    include: {
      shift: { include: { day: true, daySlot: true, workArea: true } },
      user: { select: { id: true, name: true } }
    }
  });

  // Belegung getrennt als reine Zahlen: das Frontend braucht sie fuer "3/8"
  // und die Fortschrittsbalken, aber ohne zu wissen, WER eingetragen ist.
  const belegung = await prisma.volunteerShift.groupBy({
    by: ['shiftId'],
    where: { tournamentId: targetTournamentId },
    _count: { _all: true }
  });
  const shiftAssignmentCounts: Record<number, number> = {};
  for (const b of belegung) {
    if (b.shiftId != null) shiftAssignmentCounts[b.shiftId] = b._count._all;
  }

  // Spielzeiten der eigenen Kinder: welcher Jahrgang spielt wann. Damit kann
  // die Oberflaeche beim Buchen anzeigen, ob eine Schicht mit den Spielen des
  // eigenen Kindes kollidiert - die haeufigste Rueckfrage bei der Planung.
  // Bewusst nur die wenigen Zeitfenster ausliefern (ein bis zwei je Jahrgang)
  // und die Ueberschneidung im Client rechnen, statt pro Schicht etwas zu
  // schicken.
  const spielzeiten = await prisma.timeSlot.findMany({
    where: { tournamentId: targetTournamentId, yearGroupId: { not: null } },
    include: { yearGroup: true },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
  });

  const childPlaySlots = spielzeiten.flatMap(ts => {
    const yg = ts.yearGroup;
    if (!yg) return [];
    const kinder = (user.children ?? [])
      .filter(c => c.childYear >= yg.birthYearStart && c.childYear <= yg.birthYearEnd)
      .map(c => c.childName);
    if (kinder.length === 0) return [];
    const start = timeToMin(ts.startTime);
    const ende = timeToMin(ts.endTime);
    if (start == null || ende == null) return [];
    return [{ date: ts.date, startMin: start, endMin: ende, yearGroupName: yg.name, children: kinder }];
  });

  // Ungelesene Meldungen (Schicht verschoben/entfallen). Bewusst mit der
  // ohnehin geladenen Uebersicht ausgeliefert - so ist die Meldung sofort da,
  // wenn die App geoeffnet wird, ohne zweiten Aufruf.
  const notifications = await prisma.userNotification.findMany({
    where: { userId, readAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  const tournament = await prisma.tournament.findUnique({
    where: { id: targetTournamentId },
    include: { club: true }
  });

  // Das Frontend ersetzt mit diesem Objekt seinen zwischengespeicherten
  // Nutzer. Die Rollen MUESSEN deshalb mit: fehlen sie, faellt der Client auf
  // die alte Einzelspalte zurueck und ein Admin, der zusaetzlich Trainer ist,
  // verliert den Trainer-Hut bei jedem Laden des Dashboards.
  // password/recoveryPin werden entfernt - beides sind Anmeldegeheimnisse und
  // haben in einer Antwort nichts verloren (recoveryPin erlaubt ueber
  // /reset-by-pin sogar das Setzen eines neuen Passworts).
  const { password: _pw, recoveryPin: _pin, userRoles, ...safeUser } = user;
  const volunteer = {
    ...safeUser,
    roles: userRoles.length > 0 ? userRoles.map(r => r.role) : [user.role]
  };

  res.json({ shifts, volunteerShifts, betreuteVolunteerShifts, shiftAssignmentCounts, childPlaySlots, notifications, volunteer, tournament, availableTournaments });
};

export const assignShift = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const { shiftId } = req.body;
  if (!shiftId) return res.status(400).json({ error: 'shiftId erforderlich' });

  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { day: true, daySlot: true, workArea: true, tournament: true } });
  if (!shift) return res.status(404).json({ error: 'Shift nicht gefunden' });

  // Abgeschlossene Turniere sind im Self-Service jetzt nur noch read-only
  // einsehbar (Historie) - neue Zusagen dort wären inhaltlich sinnlos.
  if (shift.tournament && shift.tournament.status !== 'aktiv') {
    return res.status(400).json({ error: 'Dieses Turnier ist nicht mehr aktiv - eine Zusage ist nicht mehr möglich.' });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

  // Bereits für diesen Job-Slot eingetragen?
  const existing = await prisma.volunteerShift.findFirst({ where: { userId, shiftId } });
  if (existing) {
    return res.status(400).json({ error: 'Du bist für diesen Job-Slot bereits eingetragen.' });
  }

  // Kapazität prüfen. Das fehlte bisher komplett: die Oberfläche zeigte
  // freie Schichten immer als unbesetzt an (die Belegung wurde nie
  // mitgeliefert), und serverseitig gab es keine Grenze - eine Schicht liess
  // sich also beliebig weit über maxVolunteers hinaus füllen.
  if (shift.maxVolunteers > 0) {
    const belegt = await prisma.volunteerShift.count({ where: { shiftId } });
    if (belegt >= shift.maxVolunteers) {
      return res.status(409).json({ error: 'Dieser Job ist bereits voll besetzt.' });
    }
  }

  const shiftDate = shift.day?.date ?? new Date();
  const slotLabel = shift.daySlot ? `${minToTime(shift.daySlot.startMin)}-${minToTime(shift.daySlot.endMin)}` : 'Unbekannt';

  const vs = await prisma.volunteerShift.create({
    data: {
      userId,
      tournamentId: shift.tournamentId,
      shiftId,
      date: shiftDate,
      slot: slotLabel,
      role: shift.workArea?.name || 'Helfer',
      areaId: String(shift.tournamentWorkAreaId)
    }
  });
  await ensureTournamentMembership(userId, shift.tournamentId);

  logJobAssigned(userId, user.name || '', shiftId, shiftDate.toISOString());
  res.json(vs);
};

export const unassignShift = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const volunteerShiftId = parseInt(req.params.id as string);
  
  const existing = await prisma.volunteerShift.findUnique({ 
    where: { id: volunteerShiftId },
    include: { user: true }
  });
  if (!existing || existing.userId !== userId) {
    return res.status(403).json({ error: 'Zugriff verweigert oder nicht gefunden' });
  }

  const userName = existing.user?.name || 'Unbekannt';
  const shiftDate = existing?.date ? new Date(existing.date).toISOString().split('T')[0] : '';
  await prisma.volunteerShift.delete({ where: { id: volunteerShiftId } });
  logJobUnassigned(userId, userName, existing.shiftId || 0, shiftDate);
  res.json({ success: true });
};

/**
 * Meldungen als gelesen markieren. Ohne ids werden alle offenen bestaetigt -
 * das ist der Normalfall, wenn der Nutzer das Banner schliesst.
 */
export const markNotificationsRead = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const { ids } = req.body ?? {};
  const nurEigene = { userId, readAt: null as Date | null };

  await prisma.userNotification.updateMany({
    // userId bleibt immer Teil der Bedingung: sonst liessen sich mit
    // geratenen IDs fremde Meldungen als gelesen markieren.
    where: Array.isArray(ids) && ids.length > 0
      ? { ...nurEigene, id: { in: ids.filter((i: unknown) => typeof i === 'number') } }
      : nurEigene,
    data: { readAt: new Date() }
  });

  return res.json({ success: true });
};

export const getVapidPublicKey = (req: Request, res: Response) => {
  res.json({ publicKey: getPubKey() });
};

export const subscribePush = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Ungültige Subscription-Daten' });
  }

  // Nur fuer eine lesbare Geraete-Anzeige in der Benutzerverwaltung (welches
  // Geraet/Browser) - kein Tracking-Zweck, daher keine Zustimmung noetig.
  const userAgent = (req.headers['user-agent'] as string | undefined) || null;

  // Sicherstellen, dass der User noch existiert (Token könnte nach Account-Löschung
  // noch gültig sein → würde sonst P2003 Foreign Key Fehler werfen).
  const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!userExists) {
    return res.status(401).json({ error: 'Benutzer nicht gefunden – bitte neu anmelden' });
  }

  const existing = await prisma.pushSubscription.findFirst({
    where: { endpoint }
  });

  if (existing) {
    if (existing.userId !== userId || existing.p256dh !== keys.p256dh || existing.auth !== keys.auth || existing.userAgent !== userAgent) {
      await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          userId,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent
        }
      });
    }
  } else {
    await prisma.pushSubscription.create({
      data: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent
      }
    });
  }

  res.status(201).json({ success: true });
};

export const rateShift = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Ungültige ID' });

  const existing = await prisma.volunteerShift.findUnique({
    where: { id }
  });

  if (!existing || existing.userId !== userId) {
    return res.status(403).json({ error: 'Diese Schicht gehört dir nicht' });
  }

  const { ratingWorkload, ratingOrganization, ratingFun, ratingComment } = req.body;

  const updated = await prisma.volunteerShift.update({
    where: { id },
    data: {
      ratingWorkload: ratingWorkload != null ? parseInt(ratingWorkload, 10) : null,
      ratingOrganization: ratingOrganization != null ? parseInt(ratingOrganization, 10) : null,
      ratingFun: ratingFun != null ? parseInt(ratingFun, 10) : null,
      ratingComment: ratingComment ? String(ratingComment).trim() : null
    }
  });

  res.json(updated);
};

export const getTrainerDashboard = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Nicht authentifiziert' });

  const { tournamentId } = req.query;
  // Number(undefined) ist NaN und damit falsy - ohne diese Pruefung fiele der
  // Turnier-Filter unten still weg und der Trainer saehe Spendenaufrufe und
  // Schichten aus ALLEN Turnieren.
  const parsedTid = Number(tournamentId);
  const tid = Number.isFinite(parsedTid) && parsedTid > 0 ? parsedTid : undefined;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { trainedYearGroups: true }
    });

    // Rollen aus der Zuordnungstabelle: ein Admin, der zusaetzlich Trainer
    // ist, muss hier durchkommen - mit der alten Einzelrolle ging das nicht.
    const rollen = await getUserRoles(userId);
    if (!user || !isTrainer(rollen)) {
      return res.status(403).json({ error: 'Nur Trainer haben Zugriff auf diesen Bereich.' });
    }

    const yearGroupIds = user.trainedYearGroups.map(yg => yg.id);

    if (yearGroupIds.length === 0) {
      // trainedYearGroups MUSS mit: das Frontend liest es ohne Guard aus, ein
      // Fehlen wuerde die Ansicht mit einem TypeError abschiessen - und genau
      // dieser Fall (Trainer noch ohne Jahrgang) ist der Erstzustand.
      return res.json({ trainedYearGroups: [], foodDonationSlots: [], volunteerShifts: [], beteiligung: [] });
    }

    // 1. Verpflegungsspenden für diese Jahrgänge
    const foodDonationSlots = await prisma.foodDonationSlot.findMany({
      where: {
        tournamentId: tid,
        yearGroupId: { in: yearGroupIds }
      },
      include: {
        yearGroup: true,
        foodItem: true,
        donations: {
          include: {
            user: { select: { name: true, phone: true } }
          }
        }
      },
      orderBy: [
        { yearGroup: { order: 'asc' } },
        { foodItem: { categoryId: 'asc' } },
        { foodItem: { name: 'asc' } }
      ]
    });

    // 2. Schichten von Helfern, die Kinder in diesen Jahrgängen haben
    const volunteerShifts = await prisma.volunteerShift.findMany({
      where: {
        tournamentId: tid,
        user: {
          children: {
            some: {
              OR: user.trainedYearGroups.map(yg => ({
                childYear: {
                  gte: yg.birthYearStart,
                  lte: yg.birthYearEnd
                }
              }))
            }
          }
        }
      },
      include: {
        // Geburtsjahre nur, um die Schicht dem Jahrgang zuordnen zu koennen -
        // sie werden unten ausgewertet und NICHT mit ausgeliefert.
        user: { select: { name: true, phone: true, children: { select: { childYear: true } } } },
        shift: {
          include: {
            day: true,
            daySlot: true,
            workArea: true
          }
        }
      },
      orderBy: { date: 'asc' }
    });

    // Jede Schicht den Jahrgaengen zuordnen, ueber die sie gefunden wurde.
    // Ein Elternteil kann Kinder in mehreren betreuten Jahrgaengen haben -
    // dann erscheint die Schicht bei jedem davon. Die Geburtsjahre selbst
    // werden bewusst nicht ausgeliefert, nur die abgeleiteten Jahrgangs-IDs.
    const shiftsMitJahrgang = volunteerShifts.map(vs => {
      const jahre = vs.user?.children?.map(c => c.childYear) ?? [];
      const yearGroupIds = user.trainedYearGroups
        .filter(yg => jahre.some(j => j >= yg.birthYearStart && j <= yg.birthYearEnd))
        .map(yg => yg.id);
      const { children, ...userOhneKinder } = vs.user ?? { children: [] };
      return { ...vs, user: vs.user ? userOhneKinder : vs.user, yearGroupIds };
    });

    /**
     * Beteiligung der eigenen Jahrgaenge - wer traegt, wer war noch nicht dabei.
     *
     * Dieselbe Rechnung wie im Organisatoren-Bereich, damit beide Seiten
     * dieselben Zahlen sehen. Anschliessend hart auf die betreuten Jahrgaenge
     * gefiltert: Ein Trainer soll seinen Jahrgang kennen, nicht die anderen.
     *
     * Ohne Turnierbezug bleibt es leer - eine Beteiligung ueber alle Turniere
     * hinweg waere keine Aussage, sondern eine Vermischung.
     */
    let beteiligung: unknown[] = [];
    if (tid) {
      const [alleShifts, alleEinplanungen, mitglieder, alleSpenden] = await Promise.all([
        prisma.shift.findMany({
          where: { tournamentId: tid },
          include: { daySlot: true, day: true, workArea: true }
        }),
        prisma.volunteerShift.findMany({
          where: { tournamentId: tid },
          include: {
            user: {
              select: {
                id: true, name: true,
                children: { select: { childYear: true } },
                trainedYearGroups: { select: { id: true } }
              }
            }
          }
        }),
        prisma.user.findMany({
          where: {
            OR: [
              { tournamentMemberships: { some: { tournamentId: tid } } },
              { tournamentId: tid }
            ]
          },
          select: {
            id: true, name: true, phone: true,
            children: { select: { childYear: true } },
            trainedYearGroups: { select: { id: true } }
          }
        }),
        prisma.foodDonation.findMany({
          where: { tournamentId: tid },
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                children: { select: { childYear: true } },
                trainedYearGroups: { select: { id: true } }
              }
            }
          }
        })
      ]);

      const statistik = berechneTurnierStatistik(
        alleShifts, alleEinplanungen, user.trainedYearGroups, mitglieder, alleSpenden
      );

      // Telefonnummern nur fuer die Unbeteiligten der eigenen Jahrgaenge -
      // die Aktiven tragen sie ohnehin schon in der Schichtliste. Wer
      // angesprochen werden soll, soll auch erreichbar sein.
      const telefonBuch = new Map(mitglieder.map(m => [m.id, m.phone]));

      beteiligung = statistik.jahrgaenge.liste
        .filter(j => yearGroupIds.includes(j.id))
        .map(j => ({
          ...j,
          ohneBeteiligung: j.ohneBeteiligung.map(pp => ({
            ...pp,
            phone: telefonBuch.get(pp.userId) ?? null
          }))
        }));
    }

    return res.json({
      trainedYearGroups: user.trainedYearGroups,
      foodDonationSlots,
      volunteerShifts: shiftsMitJahrgang,
      beteiligung
    });
  } catch (error) {
    console.error('Error in getTrainerDashboard:', error);
    return res.status(500).json({ error: 'Interner Serverfehler' });
  }
};
