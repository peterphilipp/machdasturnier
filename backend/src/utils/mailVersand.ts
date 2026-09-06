import { Resend } from 'resend';
import prisma from '../config/prisma.js';
import { resolveEmailFrom, resolveFrontendUrl } from './mailAbsender.js';
import { ermittleUmgebung } from './umgebung.js';
import { baueVorlage, Marke, VorlagenId, DankeZahlen } from './mailVorlagen.js';

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
  eingabe: { betreff: string; text: string; zahlen?: DankeZahlen | null },
  marke: Marke
): Promise<VersandErgebnis> {
  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    console.warn('[mail] RESEND_API_KEY fehlt - es wird nichts versendet.');
    return { gesendet: 0, fehlgeschlagen: empfaenger.length, ohneAdresse: 0 };
  }

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
      zahlen: eingabe.zahlen ?? null
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
