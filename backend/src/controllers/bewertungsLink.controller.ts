import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { pruefeBewertungsToken, baueBewertungsToken } from '../utils/bewertungsLink.js';

/**
 * Bewerten ueber den Link aus der Mail - ohne Anmeldung.
 *
 * Bewusste Entscheidung des Vereins: Wer den Link hat, kann fuer diese eine
 * Schicht bewerten. Ein unbeantwortetes Bewertungsformular ist teurer als das
 * Risiko, dass jemand mit fremdem Link eine 4 statt einer 5 abgibt - im
 * letzten Turnier kam genau EINE Bewertung zurueck.
 *
 * Warum das Schreiben trotzdem per POST laeuft und nicht per Klick auf einen
 * GET-Link: Mailprogramme und Sicherheitsscanner rufen Links in Mails
 * teilweise von sich aus ab, um sie zu pruefen. Bei einem schreibenden
 * GET-Link waere die Bewertung damit abgegeben, bevor der Empfaenger die Mail
 * ueberhaupt geoeffnet hat - und zwar mit dem Wert, der im Link stand. Der
 * Link fuehrt deshalb auf eine Seite, die den Wert erst nach dem Laden
 * abschickt.
 */

export const bewertungsLinkSchema = z.object({
  token: z.string().min(10),
  ratingWorkload: z.number().int().min(1).max(5).nullable().optional(),
  ratingOrganization: z.number().int().min(1).max(5).nullable().optional(),
  ratingFun: z.number().int().min(1).max(5).nullable().optional(),
  ratingComment: z.string().max(1000).nullable().optional()
});

/** Was zu diesem Link gehoert - damit die Seite zeigen kann, worum es geht. */
export const getBewertungsKontext = async (req: Request, res: Response) => {
  const anspruch = pruefeBewertungsToken(String(req.query.token || ''));
  if (!anspruch) {
    return res.status(410).json({ error: 'Dieser Link ist nicht mehr gültig.' });
  }

  const vs = await prisma.volunteerShift.findUnique({
    where: { id: anspruch.volunteerShiftId },
    include: {
      user: { select: { name: true } },
      shift: { include: { workArea: true, day: true } },
      // Nur fuer die Farbe: Die Seite ist nicht angemeldet und kann die
      // Vereinsfarben nicht wie die App nachladen. Ohne sie waere die Mail
      // orange und die Seite blau - fuer den Empfaenger sieht das aus wie
      // zwei verschiedene Anwendungen und damit wie ein untergeschobener Link.
      tournament: { select: { club: { select: { primaryColor: true } } } }
    }
  });

  // Auch der Nutzer muss passen: Sonst waere ein Token nach einer Umplanung
  // auf eine andere Person weiter gueltig.
  if (!vs || vs.userId !== anspruch.userId) {
    return res.status(410).json({ error: 'Dieser Link ist nicht mehr gültig.' });
  }

  /**
   * Die anderen noch unbewerteten Schichten derselben Person.
   *
   * Damit die Seite nach dem Absenden weiterfuehren kann: Wer drei Schichten
   * hatte, soll nicht in die Mail zurueckwechseln muessen, um die zweite zu
   * finden. Jede bekommt ihr eigenes Token - ein Token gilt fuer genau eine
   * Schicht, sonst waere die Bewertung auf der falschen gelandet.
   *
   * "Unbewertet" ist dieselbe Definition wie beim Versand und in der App:
   * keine der drei Fragen beantwortet.
   */
  const weitere = await prisma.volunteerShift.findMany({
    where: {
      userId: anspruch.userId,
      id: { not: vs.id },
      ...(vs.tournamentId ? { tournamentId: vs.tournamentId } : {}),
      ratingWorkload: null,
      ratingOrganization: null,
      ratingFun: null
    },
    select: {
      id: true, date: true, slot: true, role: true,
      shift: {
        select: {
          workArea: { select: { name: true, icon: true } },
          day: { select: { date: true } }
        }
      }
    },
    orderBy: [{ date: 'asc' }, { slot: 'asc' }]
  });

  return res.json({
    name: vs.user?.name?.trim().split(/\s+/)[0] ?? null,
    bereich: vs.shift?.workArea?.name ?? vs.role,
    icon: vs.shift?.workArea?.icon ?? null,
    datum: vs.shift?.day?.date ?? vs.date,
    slot: vs.slot,
    farbe: vs.tournament?.club?.primaryColor ?? null,
    weitere: weitere.map(w => ({
      token: baueBewertungsToken({ volunteerShiftId: w.id, userId: anspruch.userId }),
      bereich: w.shift?.workArea?.name ?? w.role,
      icon: w.shift?.workArea?.icon ?? null,
      datum: w.shift?.day?.date ?? w.date,
      slot: w.slot
    })),
    // Damit die Seite schon Abgegebenes anzeigt statt leerer Sterne.
    bereits: {
      ratingWorkload: vs.ratingWorkload,
      ratingOrganization: vs.ratingOrganization,
      ratingFun: vs.ratingFun,
      ratingComment: vs.ratingComment
    }
  });
};

/** Die Bewertung entgegennehmen. */
export const bewerteMitLink = async (req: Request, res: Response) => {
  const { token, ratingWorkload, ratingOrganization, ratingFun, ratingComment } = req.body;

  const anspruch = pruefeBewertungsToken(String(token || ''));
  if (!anspruch) {
    return res.status(410).json({ error: 'Dieser Link ist nicht mehr gültig.' });
  }

  const vs = await prisma.volunteerShift.findUnique({ where: { id: anspruch.volunteerShiftId } });
  if (!vs || vs.userId !== anspruch.userId) {
    return res.status(410).json({ error: 'Dieser Link ist nicht mehr gültig.' });
  }

  /**
   * Nur setzen, was mitkommt.
   *
   * Die Sterne in der Mail schicken zunaechst nur einen Wert; die anderen
   * beiden folgen auf der Seite. Ein pauschales Ueberschreiben mit `null`
   * wuerde die erste Antwort beim zweiten Schritt wieder loeschen - genau der
   * Fehler, der eine halb ausgefuellte Bewertung wertlos macht.
   */
  const daten: Record<string, number | string | null> = {};
  if (ratingWorkload != null) daten.ratingWorkload = ratingWorkload;
  if (ratingOrganization != null) daten.ratingOrganization = ratingOrganization;
  if (ratingFun != null) daten.ratingFun = ratingFun;
  if (ratingComment != null) daten.ratingComment = String(ratingComment).trim() || null;

  if (Object.keys(daten).length === 0) {
    return res.status(400).json({ error: 'Es wurde nichts angegeben.' });
  }

  const aktualisiert = await prisma.volunteerShift.update({
    where: { id: anspruch.volunteerShiftId },
    data: daten,
    select: { ratingWorkload: true, ratingOrganization: true, ratingFun: true, ratingComment: true }
  });

  return res.json({ success: true, bereits: aktualisiert });
};
