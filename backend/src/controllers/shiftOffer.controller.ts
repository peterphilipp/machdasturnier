import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { AuthRequest } from '../middleware/auth.js';
import { notifyUsers, notifyUser } from '../utils/notify.js';
import { protokolliere, datumKurz } from '../utils/protokoll.js';
import { minToTime } from '../utils/schichtzeit.js';
import { ROLES, hasAdminAccess } from '../utils/roles.js';
import { getUserRoles } from '../utils/userRoles.js';
import { effektiveZeit } from '../utils/schichtzeit.js';
import { findeKonflikt, konfliktMeldung, utcTag, istVergangen, ueberschneidetSich, Belegung } from '../utils/zeitueberschneidung.js';

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
  /// Wunsch-Arbeitsbereiche, mehrere moeglich - wer Zeit anbietet, kann sich
  /// oft mehr als eine Aufgabe vorstellen. Leer heisst "egal".
  workAreaIds: z.array(z.number().int().positive()).max(20).optional(),
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

/**
 * Sammelt, womit der Helfer an diesem Tag bereits belegt ist, und sucht die
 * erste Ueberschneidung mit dem gewuenschten Zeitraum.
 *
 * Zaehlt beides: bestehende Einplanungen und bereits angenommene Angebote.
 * Ein abgelehntes oder noch offenes Angebot blockiert bewusst nicht - offen
 * heisst, es koennte noch abgelehnt werden.
 */
async function findeBelegungsKonflikt(
  userId: number,
  tournamentId: number,
  datum: Date,
  startMin: number,
  endMin: number
): Promise<Belegung | null> {
  const tag = utcTag(datum);

  const [einplanungen, zusagen] = await Promise.all([
    prisma.volunteerShift.findMany({
      where: { userId, tournamentId },
      include: { shift: { include: { daySlot: true, day: true, workArea: true } } }
    }),
    prisma.shiftOffer.findMany({
      where: { userId, tournamentId, status: 'ANGENOMMEN' }
    })
  ]);

  const belegungen: Belegung[] = [];

  for (const vs of einplanungen) {
    if (!vs.shift) continue;
    const { start, ende } = effektiveZeit(vs.shift, vs.shift.daySlot);
    if (start == null || ende == null) continue;
    // Der Tag der Schicht, nicht der des Eintrags - massgeblich ist, wann
    // tatsaechlich gearbeitet wird.
    const schichtTag = vs.shift.day?.date ? utcTag(vs.shift.day.date) : utcTag(vs.date);
    belegungen.push({
      art: 'schicht',
      tag: schichtTag,
      startMin: start,
      endMin: ende,
      bezeichnung: vs.shift.workArea?.name || vs.role || 'Schicht'
    });
  }

  for (const z of zusagen) {
    belegungen.push({
      art: 'angebot',
      tag: utcTag(z.date),
      startMin: z.startMin,
      endMin: z.endMin,
      bezeichnung: 'dein angenommenes Angebot'
    });
  }

  return findeKonflikt({ tag, startMin, endMin }, belegungen);
}

/** Ein Helfer bietet Zeit an. Laeuft ueber das eigene Konto, nicht ueber Admin. */
export const createShiftOffer = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { tournamentId, shiftId, workAreaIds, date, startMin, endMin, note } = req.body;

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

  // Nicht anbieten, was schon vergeben ist: Wer zur selben Stunde eingeplant
  // ist oder bereits eine Zusage hat, wuerde den Organisatoren als zweiter
  // Helfer erscheinen, obwohl es derselbe ist.
  const konflikt = await findeBelegungsKonflikt(userId, tournamentId, new Date(date), startMin, endMin);
  if (konflikt) {
    return res.status(409).json({ error: konfliktMeldung(konflikt) });
  }

  const angebot = await prisma.shiftOffer.create({
    data: {
      tournamentId, userId,
      shiftId: shiftId ?? null,
      date: new Date(date),
      startMin, endMin,
      note: note?.trim() || null,
      workAreas: workAreaIds?.length
        ? { connect: workAreaIds.map((id: number) => ({ id })) }
        : undefined
    },
    include: {
      user: { select: { name: true } },
      shift: { include: { workArea: true } },
      workAreas: true
    }
  });

  // Die Organisatoren erfahren davon - sonst liegt das Angebot in einer Liste,
  // in die niemand schaut, und der Helfer wartet vergeblich.
  const organisatoren = await prisma.user.findMany({
    where: { userRoles: { some: { role: { in: [ROLES.ADMIN, ROLES.ORGANIZER] } } } },
    select: { id: true }
  });
  if (organisatoren.length > 0) {
    // Bezug auf eine konkrete Schicht ist praeziser als die Wunsch-Bereiche.
    const bereich = angebot.shift?.workArea?.name
      ?? (angebot.workAreas.length > 0 ? angebot.workAreas.map(w => w.name).join(', ') : undefined);
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
      workAreas: true
    }
  });

  // Fuer "umgesetzt": alle Einplanungen des Turniers, um sie den Zusagen
  // gegenueberzustellen. Eine Abfrage statt einer je Angebot.
  const einplanungen = await prisma.volunteerShift.findMany({
    where: { tournamentId, userId: { not: null } },
    include: { shift: { include: { daySlot: true, day: true, workArea: true } } }
  });

  /**
   * Zwei Kennzeichen, die sich aus dem Bestand ergeben und deshalb nicht
   * gespeichert werden - gespeichert muessten sie gepflegt werden und liefen
   * irgendwann der Wirklichkeit hinterher:
   *
   *  - `umgesetzt`: Zu einer Zusage gibt es inzwischen eine Einplanung im
   *    selben Zeitraum. Das Angebot hat seinen Zweck erfuellt und muss nicht
   *    mehr als Aufgabe in der Ansicht stehen.
   *  - `verfallen`: Der Zeitraum ist vorbei. Ein Angebot fuer gestern laesst
   *    sich nicht mehr sinnvoll annehmen.
   */
  const angereichert = angebote.map(a => {
    const tag = utcTag(a.date);
    const umgesetzt = a.status === 'ANGENOMMEN' && einplanungen.some(vs => {
      if (vs.userId !== a.userId || !vs.shift) return false;
      const { start, ende } = effektiveZeit(vs.shift, vs.shift.daySlot);
      if (start == null || ende == null) return false;
      const schichtTag = vs.shift.day?.date ? utcTag(vs.shift.day.date) : utcTag(vs.date);
      return schichtTag === tag && ueberschneidetSich(a.startMin, a.endMin, start, ende);
    });

    return { ...a, umgesetzt, verfallen: istVergangen(a.date, a.endMin) };
  });

  return res.json(angereichert);
};

/** Die eigenen Angebote - damit im Self-Service sichtbar ist, was laeuft. */
export const getMyShiftOffers = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Nicht angemeldet' });

  const angebote = await prisma.shiftOffer.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
    include: { shift: { include: { workArea: true } }, workAreas: true }
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

/**
 * Entfernen eines Angebots.
 *
 * Zwei Faelle mit unterschiedlichen Regeln:
 *  - Der Helfer zieht sein eigenes zurueck - auch eine Zusage, denn "ich kann
 *    doch nicht" muss moeglich sein. Die Organisatoren werden dann gewarnt.
 *  - Die Organisatoren raeumen auf, auch Entschiedenes: ein angenommenes
 *    Angebot ist erledigt, sobald die Schicht eingetragen ist, und soll dann
 *    nicht dauerhaft in der Ansicht stehenbleiben.
 */
export const deleteShiftOffer = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const angebot = await prisma.shiftOffer.findUnique({
    where: { id },
    include: { user: { select: { name: true } } }
  });
  if (!angebot) return res.status(404).json({ error: 'Angebot nicht gefunden' });

  const rollen = req.userId ? await getUserRoles(req.userId) : [];
  const istOrganisator = hasAdminAccess(rollen);
  const eigenes = angebot.userId === req.userId;

  if (!istOrganisator && !eigenes) {
    return res.status(403).json({ error: 'Das ist nicht dein Angebot.' });
  }

  const wann = `${datumKurz(angebot.date)} ${zeitraum(angebot.startMin, angebot.endMin)}`;
  const warAngenommen = angebot.status === 'ANGENOMMEN';
  const warOffen = angebot.status === 'OFFEN';

  await prisma.shiftOffer.delete({ where: { id } });

  if (eigenes && warAngenommen) {
    // Ein Helfer nimmt eine Zusage zurueck. Das muss auffallen: die
    // Organisatoren haben moeglicherweise schon darauf hin geplant. Eine
    // bereits eingetragene Schicht bleibt bestehen - die muessen sie selbst
    // aufloesen, automatisch waere hier zu viel Automatik.
    const organisatoren = await prisma.user.findMany({
      where: { userRoles: { some: { role: { in: [ROLES.ADMIN, ROLES.ORGANIZER] } } } },
      select: { id: true }
    });
    await notifyUsers(
      organisatoren.map(o => o.id),
      '⚠️ Zusage zurückgezogen',
      () => `${angebot.user?.name ?? 'Ein Helfer'} kann für ${wann} doch nicht. `
        + 'Falls dafür schon eine Schicht eingetragen ist, wird sie wieder frei.',
      '/admin/organisation/uebersicht'
    );
  }

  if (istOrganisator && !eigenes && warOffen) {
    // Ein offenes Angebot verschwindet zu lassen, ohne etwas zu sagen, waere
    // schlimmer als eine Absage: der Helfer wartet dann auf eine Antwort, die
    // nie kommt.
    await notifyUser(
      angebot.userId,
      'Dein Angebot',
      ({ vertretend, name }) => vertretend
        ? `Für ${wann} brauchen wir ${name} nicht – danke fürs Anbieten!`
        : `Für ${wann} brauchen wir dich nicht – danke fürs Anbieten!`,
      '/'
    );
  }

  // Nur protokollieren, wenn jemand ein fremdes Angebot entfernt - das eigene
  // Zurueckziehen eines offenen Angebots ist Alltag und muss den Verlauf nicht
  // fuellen. Eine zurueckgezogene Zusage dagegen schon.
  if ((istOrganisator && !eigenes) || (eigenes && warAngenommen)) {
    await protokolliere({
      tournamentId: angebot.tournamentId,
      userId: req.userId,
      art: 'helfer',
      beschreibung: eigenes
        ? `hat die eigene Zusage für ${wann} zurückgezogen`
        : `hat das Zeitangebot von ${angebot.user?.name ?? 'einem Helfer'} für ${wann} entfernt`,
      objektTyp: 'shift',
      objektId: angebot.shiftId
    });
  }

  return res.status(204).send();
};

/**
 * Eine Entscheidung zuruecknehmen - das Angebot ist wieder offen.
 *
 * Ohne diesen Weg waere ein Fehlgriff endgueltig: einmal abgelehnt, koennte
 * der Helfer nur ueber ein neues Angebot wieder ins Spiel kommen, und das
 * kann er nach einer Absage kaum ahnen.
 */
export const oeffneShiftOffer = async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const vorher = await prisma.shiftOffer.findUnique({ where: { id } });
  if (!vorher) return res.status(404).json({ error: 'Angebot nicht gefunden' });
  if (vorher.status === 'OFFEN') return res.json(vorher);

  const angebot = await prisma.shiftOffer.update({
    where: { id },
    data: { status: 'OFFEN', decidedById: null, decidedAt: null, decisionNote: null },
    include: { user: { select: { id: true, name: true } }, workAreas: true }
  });

  await protokolliere({
    tournamentId: angebot.tournamentId,
    userId: req.userId,
    art: 'helfer',
    beschreibung: `hat die Entscheidung zum Zeitangebot von ${angebot.user?.name ?? 'einem Helfer'} `
      + `für ${datumKurz(angebot.date)} ${zeitraum(angebot.startMin, angebot.endMin)} zurückgenommen`,
    objektTyp: 'shift',
    objektId: angebot.shiftId
  });

  return res.json(angebot);
};
