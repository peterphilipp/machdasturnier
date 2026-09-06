import { baueMail, baueText, baueBetreff, maskiere } from './mailLayout.js';
import { Marke, Mailinhalt } from './mailVorlagen.js';

/**
 * Die Mail zu EINER Benachrichtigung (Zusage, Absage, Verschiebung) - das
 * Mail-Gegenstueck zu notifyUser() in notify.ts.
 *
 * Bewusst nicht ueber die Vorlagen aus mailVorlagen.ts: Jene sind fuer
 * Rundschreiben an eine ganze Zielgruppe gedacht (mit Betreff- und Text-
 * Eingabefeld im Admin-Dialog). Hier gibt es weder ein Formular noch eine
 * Auswahl - der Text kommt fertig formuliert aus genau der Stelle im Code,
 * die auch die Push- und In-App-Meldung dazu ausloest, und soll dort auch so
 * bleiben (ein Ereignis, ein Text, drei Kanaele).
 */
export function baueBenachrichtigungsMail(
  titel: string,
  text: string,
  url: string,
  marke: Marke
): Mailinhalt {
  const inhalt = `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;">`
    + `${maskiere(text)}</p>`;

  const aktion = { text: 'In der App ansehen', url: `${marke.appUrl}${url}` };
  const fusszeile = 'Du bekommst diese Mail, weil du bei deinem Konto Benachrichtigungen zu deinen '
    + 'Schichten per Mail aktiviert hast. Abschalten geht jederzeit in deinem Profil.';

  return {
    betreff: baueBetreff(titel, marke.testumgebung),
    html: baueMail({
      titel,
      unterzeile: marke.turniername,
      inhalt,
      aktion,
      logoUrl: marke.logoUrl,
      vereinsname: marke.vereinsname,
      farbe: marke.farbe,
      fusszeile,
      appUrl: marke.appUrl,
      testumgebung: marke.testumgebung
    }),
    text: baueText({ titel, absaetze: [text], aktion, fusszeile, testumgebung: marke.testumgebung })
  };
}
