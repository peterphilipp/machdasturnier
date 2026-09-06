import {
  baueMail, baueText, baueBetreff, alsAbsaetze, kennzahlen, maskiere, sterneReihe, kasten
} from './mailLayout.js';

/**
 * Die Vorlagen fuer den Nachrichtenversand.
 *
 * Anlass: Es liegen deutlich mehr Mailadressen vor als Push-Abos - Push
 * erreicht nur, wer die App installiert UND Benachrichtigungen erlaubt hat.
 * Wer den Verein wirklich erreichen will, braucht die Mail.
 *
 * Jede Vorlage ist eine reine Funktion: Daten rein, `{ betreff, html, text }`
 * raus. Kein Datenbankzugriff, kein Versand - dadurch laesst sich jede
 * einzeln testen und im Dialog als Vorschau zeigen, ohne etwas zu schicken.
 */

export interface Marke {
  vereinsname: string;
  farbe: string;
  logoUrl: string | null;
  /** Basis-URL der App, fuer Links. */
  appUrl: string;
  /**
   * Gesetzt, wenn diese Mail aus der Testumgebung kommt. Layout und Betreff
   * kennzeichnen sie dann - siehe mailLayout.ts.
   */
  testumgebung?: { bezeichnung: string } | null;
}

export interface Mailinhalt {
  betreff: string;
  html: string;
  text: string;
}

export type VorlagenId = 'frei' | 'appell' | 'bewertung' | 'danke';

export interface VorlagenBeschreibung {
  id: VorlagenId;
  name: string;
  /** Was diese Vorlage tut - steht im Auswahlfeld. */
  zweck: string;
  /** Vorbelegung fuer Betreff und Text, wenn der Organisator sie waehlt. */
  betreff: string;
  text: string;
}

const FUSS_STANDARD = 'Du bekommst diese Mail, weil du beim TSV Holm als Helfer für dieses Turnier hinterlegt bist.';

/**
 * Die Symbole der Spass-Skala, wie sie auch die App zeigt.
 *
 * Doppelt gepflegt (hier und in RATING_FRAGEN im Frontend), weil Backend und
 * Frontend keinen gemeinsamen Code teilen. Wenn sich die Skala aendert, muss
 * es an beiden Stellen passieren - sonst zeigt die Mail andere Gesichter als
 * die Seite, auf der man nach dem Klick landet.
 */
const SPASS_SYMBOLE = ['😞', '😐', '🙂', '😄', '🤩'];

/**
 * Was im Auswahlfeld steht. Betreff und Text sind Vorbelegungen, die der
 * Organisator ueberschreiben kann - eine Vorlage, die sich nicht anpassen
 * laesst, wird beim ersten Sonderfall umgangen.
 */
export const VORLAGEN: VorlagenBeschreibung[] = [
  {
    id: 'frei',
    name: 'Freie Nachricht',
    zweck: 'Betreff und Text selbst schreiben',
    betreff: '',
    text: ''
  },
  {
    id: 'appell',
    name: 'Aufruf: Wir brauchen noch Helfer',
    zweck: 'Vor dem Turnier – verweist auf die offenen Schichten',
    betreff: 'Wir brauchen noch Helfer für das Turnier',
    text: 'wir sind fast fertig mit der Planung – aber ein paar Schichten sind noch offen.\n\n'
      + 'Ein Blick in die App genügt: Dort siehst du, wo noch Plätze frei sind, und '
      + 'kannst dich mit zwei Klicks eintragen. Auch eine einzige Schicht hilft.\n\n'
      + 'Wenn du zeitlich nur teilweise kannst, trag ein Zeitangebot ein – wir schneiden '
      + 'die Schicht dann passend zu.'
  },
  {
    id: 'bewertung',
    name: 'Bitte um Bewertung',
    zweck: 'Nach dem Turnier – fragt nach Stress, Organisation und Spass',
    betreff: 'Wie war deine Schicht?',
    text: 'danke, dass du beim Turnier mitgeholfen hast!\n\n'
      + 'Zwei Minuten hätten wir noch gerne: Wie war deine Schicht? Wir fragen drei Dinge – '
      + 'wie viel zu tun war, wie gut es organisiert war und ob es Spass gemacht hat.\n\n'
      + 'Das ist keine Höflichkeitsfrage. Die Antworten entscheiden, wie wir das nächste '
      + 'Turnier planen: wo eine Person mehr eingeplant wird und wo es zu ruhig war.'
  },
  {
    id: 'danke',
    name: 'Danke mit Zahlen',
    zweck: 'Nach dem Turnier – Dankesmail mit den Kennzahlen',
    betreff: 'Danke! Das Turnier in Zahlen',
    text: 'das Turnier ist vorbei – und es hat funktioniert, weil viele mitgeholfen haben.\n\n'
      + 'Hier ist, was dabei zusammengekommen ist:'
  }
];

/** Was die Dankesmail an Zahlen zeigt. */
export interface DankeZahlen {
  beteiligte: number;
  stunden: number;
  schichten: number;
  spenden: number;
}

/**
 * Die Schicht, um die es in der Bewertungsmail geht - je Empfaenger anders.
 *
 * Ohne diese Angabe faellt die Vorlage auf einen Verweis in die App zurueck.
 * Das ist der Fall in der Vorschau: Dort gibt es keinen Empfaenger, und ein
 * echtes Token in einer Vorschau waere ein Token, das man nicht braucht.
 */
export interface BewertungsSchicht {
  /** Signiertes Token aus bewertungsLink.ts - traegt die Berechtigung. */
  token: string;
  bereich: string;
  /** Schon lesbar formatiert, z.B. "Samstag, 5. September". */
  datum: string;
  slot: string;
  /** Wie viele Schichten dieser Person noch unbewertet sind - inklusive dieser. */
  offen: number;
}

/**
 * Baut die versandfertige Mail.
 *
 * `anrede` ist bewusst ein Parameter und nicht fest "Hallo": Beim Versand an
 * eine Gruppe steht dort der Name des jeweiligen Empfaengers, in der Vorschau
 * ein Beispielname. Ohne diese Trennung waere die Vorschau eine andere Mail
 * als die, die rausgeht.
 */
export function baueVorlage(
  id: VorlagenId,
  eingabe: {
    betreff: string;
    text: string;
    anrede: string;
    zahlen?: DankeZahlen | null;
    schicht?: BewertungsSchicht | null;
  },
  marke: Marke
): Mailinhalt {
  const titel = eingabe.betreff.trim() || 'Nachricht vom TSV Holm';
  const anrede = `Hallo ${eingabe.anrede},`;

  // Der Kopfblock ist bei allen Vorlagen gleich: Anrede, dann der Text.
  let inhalt = `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a;font-weight:600;">`
    + `${maskiere(anrede)}</p>`
    + alsAbsaetze(eingabe.text);

  let aktion: { text: string; url: string } | null = null;
  const absaetze = [anrede, ...eingabe.text.split(/\n{2,}/).map(a => a.trim()).filter(Boolean)];

  if (id === 'appell') {
    aktion = { text: 'Offene Schichten ansehen', url: `${marke.appUrl}/` };
  }

  if (id === 'bewertung' && eingabe.schicht) {
    /**
     * Die erste Frage steht in der Mail, die zwei anderen auf der Seite.
     *
     * Nicht alle drei hier: Der erste Klick verlaesst die Mail ohnehin, mehr
     * Sterne in der Mail brauchen also niemand - sie machen sie nur laenger.
     * Und es ist bewusst die Spass-Frage: Sie ist die, die man ohne
     * Nachdenken beantwortet, und genau das ist die Huerde, an der die letzte
     * Runde gescheitert ist (eine einzige Bewertung im ganzen Turnier).
     */
    const s = eingabe.schicht;
    const basis = `${marke.appUrl}/bewerten?t=${encodeURIComponent(s.token)}`;

    inhalt += kasten(
      `<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;`
      + `letter-spacing:0.6px;margin-bottom:2px;">Deine Schicht</div>`
      + `<div style="font-size:16px;font-weight:800;color:#0f172a;line-height:1.3;">`
      + `${maskiere(s.bereich)}</div>`
      + `<div style="font-size:13px;color:#475569;margin:2px 0 16px;">`
      + `${maskiere(s.datum)} · ${maskiere(s.slot)}</div>`
      + sterneReihe({
        frage: 'Spaß & Stimmung',
        hinweis: 'Ein Klick genügt – die beiden anderen Fragen kommen danach.',
        basisUrl: basis,
        feld: 'f',
        symbole: SPASS_SYMBOLE,
        skala: ['Kein Spaß', 'Super Stimmung!'],
        farbe: marke.farbe
      }),
      marke.farbe
    );

    if (s.offen > 1) {
      inhalt += `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#64748b;">`
        + `Du hattest ${s.offen} Schichten – die anderen kannst du direkt danach `
        + `mitbewerten.</p>`;
    }

    aktion = { text: 'Alle drei Fragen beantworten', url: basis };
    absaetze.push(`Deine Schicht: ${s.bereich}, ${s.datum}, ${s.slot}.`);
  } else if (id === 'bewertung') {
    // Ohne Schicht - also in der Vorschau - fuehrt der Knopf in die App.
    aktion = { text: 'Schicht bewerten', url: `${marke.appUrl}/` };
    inhalt += `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#64748b;">`
      + `In der echten Mail stehen hier die Sterne zur eigenen Schicht.</p>`;
  }

  if (id === 'danke' && eingabe.zahlen) {
    const z = eingabe.zahlen;
    inhalt += kennzahlen([
      { wert: String(z.beteiligte), label: 'Menschen haben mitgeholfen' },
      { wert: String(Math.round(z.stunden)), label: 'Stunden geleistet' },
      { wert: String(z.schichten), label: 'übernommene Schichten' },
      { wert: String(z.spenden), label: 'Verpflegungsspenden' }
    ], marke.farbe);
    absaetze.push(
      `${z.beteiligte} Menschen haben mitgeholfen, ${Math.round(z.stunden)} Stunden geleistet, `
      + `${z.schichten} Schichten übernommen und ${z.spenden} Verpflegungsspenden beigesteuert.`
    );
  }

  return {
    betreff: baueBetreff(titel, marke.testumgebung),
    html: baueMail({
      titel,
      inhalt,
      aktion,
      logoUrl: marke.logoUrl,
      vereinsname: marke.vereinsname,
      farbe: marke.farbe,
      fusszeile: FUSS_STANDARD,
      appUrl: marke.appUrl,
      testumgebung: marke.testumgebung
    }),
    text: baueText({ titel, absaetze, aktion, fusszeile: FUSS_STANDARD, testumgebung: marke.testumgebung })
  };
}
