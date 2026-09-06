import { Resend } from 'resend';
import prisma from '../config/prisma.js';
import { resolveEmailFrom, resolveFrontendUrl } from './mailAbsender.js';
import { ermittleUmgebung } from './umgebung.js';
import { baueVorlage, Marke, VorlagenId, DankeZahlen, BewertungsSchicht } from './mailVorlagen.js';
import { baueBewertungsToken } from './bewertungsLink.js';

/**
 * Der eigentliche Mailversand an eine Gruppe.
 *
 * Getrennt vom Zusammenbauen der Mail (mailVorlagen.ts): Das Bauen ist eine
 * reine Rechnung und laesst sich testen, das Versenden nicht. So bleibt der
 * Teil pruefbar, in dem die Fehler stecken.
 */

/** Woraus die Marke im Mailkopf entsteht - Verein und Turnier des Absenders. */
export async function ermittleMarke(tournamentId: number | null): Promise<Marke> {
  const appUrl = resolveFrontendUrl();
  const umgebung = ermittleUmgebung();
  const testumgebung = umgebung.istTest && umgebung.bezeichnung
    ? { bezeichnung: umgebung.bezeichnung }
    : null;

  const turnier = tournamentId
    ? await prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true, logo: true, club: { select: { id: true, name: true, primaryColor: true, logo: true } } }
      })
    : null;

  const club = turnier?.club;

  // Das Logo NICHT als data:-URL weitergeben: Gmail rendert die in Mails
  // nicht. Stattdessen die Adresse des Bild-Endpunkts, der es ausliefert.
  const logoUrl = club?.logo
    ? `${appUrl}/api/logo/club/${club.id}`
    : turnier?.logo
      ? `${appUrl}/api/logo/tournament/${turnier.id}`
      : null;

  return {
    vereinsname: club?.name || 'TSV Holm',
    farbe: club?.primaryColor || '#0d6efd',
    logoUrl,
    appUrl,
    testumgebung
  };
}

export interface VersandEmpfaenger {
  id: number;
  name: string;
  email: string;
}

const DATUM_LANG = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin'
});

/**
 * Sucht je Empfaenger die Schicht, um die die Bewertungsmail bitten soll.
 *
 * Eine Abfrage fuer alle statt eine je Person: Bei achtzig Empfaengern waeren
 * das sonst achtzig Abfragen fuer eine Mail.
 *
 * Genommen wird die frueheste noch unbewertete Schicht. "Unbewertet" heisst:
 * keine der drei Sternefragen beantwortet - wer schon etwas abgegeben hat,
 * soll nicht dieselbe Schicht noch einmal vorgelegt bekommen. Wer gar keine
 * offene Schicht mehr hat, bekommt in der Mail den Verweis in die App und
 * keine Sterne; ausgelassen wird niemand, weil der Organisator entscheidet,
 * wer die Mail bekommt, nicht diese Funktion.
 */
async function ermittleBewertungsSchichten(
  tournamentId: number | null,
  userIds: number[]
): Promise<Map<number, BewertungsSchicht>> {
  const treffer = new Map<number, BewertungsSchicht>();
  if (userIds.length === 0) return treffer;

  const offene = await prisma.volunteerShift.findMany({
    where: {
      userId: { in: userIds },
      ...(tournamentId ? { tournamentId } : {}),
      ratingWorkload: null,
      ratingOrganization: null,
      ratingFun: null
    },
    select: {
      id: true, userId: true, date: true, slot: true, role: true,
      shift: { select: { workArea: { select: { name: true } }, day: { select: { date: true } } } }
    },
    orderBy: [{ date: 'asc' }, { slot: 'asc' }]
  });

  // Erst zaehlen, dann die erste je Person nehmen - die Anzahl steht in der
  // Mail ("Du hattest 3 Schichten"), und die haengt an allen, nicht an der
  // ausgewaehlten.
  const anzahl = new Map<number, number>();
  for (const vs of offene) {
    if (vs.userId == null) continue;
    anzahl.set(vs.userId, (anzahl.get(vs.userId) ?? 0) + 1);
  }

  for (const vs of offene) {
    if (vs.userId == null || treffer.has(vs.userId)) continue;
    const datum = vs.shift?.day?.date ?? vs.date;
    treffer.set(vs.userId, {
      token: baueBewertungsToken({ volunteerShiftId: vs.id, userId: vs.userId }),
      bereich: vs.shift?.workArea?.name || vs.role,
      datum: DATUM_LANG.format(new Date(datum)),
      slot: vs.slot,
      offen: anzahl.get(vs.userId) ?? 1
    });
  }

  return treffer;
}

export interface VersandErgebnis {
  gesendet: number;
  fehlgeschlagen: number;
  /** Nicht versucht, weil keine Adresse hinterlegt ist. */
  ohneAdresse: number;
}

/**
 * Verschickt die Mail an alle Empfaenger, einzeln adressiert.
 *
 * Bewusst eine Mail je Person und kein Sammel-BCC: Die Anrede nennt den Namen,
 * und ein Rundschreiben, in dem achtzig Adressen im Kopf stehen, waere ein
 * Datenschutzunfall. Einzeln kostet mehr Anfragen, aber das ist bei
 * Vereinsgroesse kein Problem.
 *
 * Ein Fehlschlag bei einer Adresse darf die anderen nicht aufhalten - eine
 * ungueltige Mailadresse im Bestand wuerde sonst den ganzen Versand kippen.
 */
export async function versendeMails(
  empfaenger: VersandEmpfaenger[],
  vorlage: VorlagenId,
  eingabe: { betreff: string; text: string; zahlen?: DankeZahlen | null; tournamentId?: number | null },
  marke: Marke
): Promise<VersandErgebnis> {
  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    console.warn('[mail] RESEND_API_KEY fehlt - es wird nichts versendet.');
    return { gesendet: 0, fehlgeschlagen: empfaenger.length, ohneAdresse: 0 };
  }

  // Nur fuer die Bewertungsmail: Jede andere Vorlage braucht keine Schichten,
  // und eine Abfrage, die nichts beitraegt, soll nicht laufen.
  const schichten = vorlage === 'bewertung'
    ? await ermittleBewertungsSchichten(eingabe.tournamentId ?? null, empfaenger.map(e => e.id))
    : new Map<number, BewertungsSchicht>();

  const resend = new Resend(schluessel);
  const from = resolveEmailFrom();
  let gesendet = 0;
  let fehlgeschlagen = 0;

  for (const e of empfaenger) {
    const mail = baueVorlage(vorlage, {
      betreff: eingabe.betreff,
      text: eingabe.text,
      // Nur der Vorname: "Hallo Anja" liest sich wie von einem Menschen,
      // "Hallo Anja Petersen" wie von einem Serienbrief.
      anrede: e.name.trim().split(/\s+/)[0] || e.name,
      zahlen: eingabe.zahlen ?? null,
      schicht: schichten.get(e.id) ?? null
    }, marke);

    try {
      const antwort = await resend.emails.send({
        from,
        to: e.email,
        subject: mail.betreff,
        html: mail.html,
        text: mail.text
      });
      if (antwort.error) throw new Error(antwort.error.message);
      gesendet++;
    } catch (err) {
      fehlgeschlagen++;
      // Die Adresse mitloggen, nicht den Inhalt: Beim Nachsehen will man
      // wissen, WER nicht erreicht wurde.
      console.error(JSON.stringify({
        event: 'MAIL_SEND_FAILED',
        to: e.email,
        userId: e.id,
        error: (err as Error).message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  return { gesendet, fehlgeschlagen, ohneAdresse: 0 };
}
