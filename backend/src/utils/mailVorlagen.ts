import {
  baueMail, baueText, baueBetreff, alsAbsaetze, kennzahlen, maskiere, sterneReihe, kasten,
  schichtListe, jubelBand
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
  /** Steht im Mailkopf unter der Ueberschrift - wie in der App. */
  turniername: string | null;
  farbe: string;
  logoUrl: string | null;
  /** Basis-URL der App, fuer Links. */
  appUrl: string;
  /**
   * Turnier, um das es geht - steht in den Links mit drin.
   *
   * Ein Helfer kann in mehreren Turnieren stehen, und das Dashboard zeigt
   * eines davon. Ohne diese Angabe fuehrt ein Link auf eine Schicht des einen
   * Turniers in die Liste des anderen.
   */
  turnierId?: number | null;
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
 * Die drei Bewertungsfragen, wie sie auch die App stellt.
 *
 * Doppelt gepflegt (hier und in RATING_FRAGEN im Frontend), weil Backend und
 * Frontend keinen gemeinsamen Code teilen. Wenn sich die Skala aendert, muss
 * es an beiden Stellen passieren - sonst zeigt die Mail andere Gesichter und
 * andere Worte als die Seite, auf der man nach dem Klick landet, und die
 * Auswertung rechnet Antworten auf zwei verschiedene Fragen zusammen.
 *
 * `feld` ist der Kurzname im Link; die Bewertungsseite loest ihn auf
 * (AUS_MAIL in BewertungsLinkView.tsx).
 */
const FRAGEN: {
  feld: 'w' | 'o' | 'f';
  frage: string;
  hinweis: string;
  symbole: string[];
  skala: [string, string];
}[] = [
  {
    feld: 'w',
    frage: '1. Stress & Auslastung',
    hinweis: 'War genug zu tun – oder zu viel?',
    symbole: ['😴', '🙂', '😊', '🥵', '🚨'],
    skala: ['Viel zu ruhig', 'Überlastet']
  },
  {
    feld: 'o',
    frage: '2. Organisation & Einweisung',
    hinweis: 'Wusstest du, was zu tun ist?',
    symbole: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'],
    skala: ['Chaotisch', 'Perfekt']
  },
  {
    feld: 'f',
    frage: '3. Spaß & Stimmung',
    hinweis: 'Ein Klick genügt – der Rest geht auf der Seite weiter.',
    symbole: ['😞', '😐', '🙂', '😄', '🤩'],
    skala: ['Kein Spaß', 'Super Stimmung!']
  }
];

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
 * Eine noch unbewertete Schicht dieses Empfaengers.
 *
 * Ohne Angabe faellt die Vorlage auf einen Verweis in die App zurueck. Das ist
 * der Fall in der Vorschau: Dort gibt es keinen Empfaenger, und ein echtes
 * Token in einer Vorschau waere ein Token, das man nicht braucht.
 */
export interface BewertungsSchicht {
  /** Signiertes Token aus bewertungsLink.ts - traegt die Berechtigung. */
  token: string;
  bereich: string;
  icon: string;
  /** Schon lesbar formatiert, z.B. "Samstag, 5. September". */
  datum: string;
  slot: string;
}

/** Eine Schicht, fuer die noch Leute fehlen - fuer den Helferaufruf. */
export interface AufrufSchicht {
  shiftId: number;
  bereich: string;
  icon: string;
  /** Schon lesbar formatiert, z.B. "Sa, 5. September". */
  wann: string;
  plaetze: number;
  besetzt: number;
  offen: number;
}

/**
 * Alle drei Fragen zur ersten unbewerteten Schicht, plus Links auf die
 * weiteren.
 *
 * Warum alle drei in der Mail und nicht nur eine: Wer die Frage sieht, weiss,
 * worauf er sich einlaesst - "drei Klicks" ist eine Zusage, die man mit einem
 * Blick pruefen kann. Der erste Klick verlaesst die Mail und die Seite fuehrt
 * den Rest zu Ende; die anderen beiden Reihen sind dort schon beantwortet,
 * wenn man sie hier angeklickt hat.
 *
 * Mehrere Schichten bekommen NICHT je drei Reihen: Bei drei Schichten waeren
 * das neun Sternereihen, und niemand liest eine Mail, die scrollt wie ein
 * Formular. Die weiteren stehen als Zeile mit eigenem Link darunter - jede mit
 * ihrem eigenen Token, sonst wuerde die Bewertung auf der falschen Schicht
 * landen.
 *
 * `absaetze` wird ergaenzt (nicht ersetzt): Die Textfassung muss dieselben
 * Links enthalten, sonst ist die Mail fuer jeden ohne HTML wertlos.
 */
function bewertungsBlock(
  schichten: BewertungsSchicht[],
  marke: Marke,
  absaetze: string[]
): string {
  const erste = schichten[0];
  const basis = `${marke.appUrl}/bewerten?t=${encodeURIComponent(erste.token)}`;

  const reihen = FRAGEN.map(f => sterneReihe({
    frage: f.frage,
    hinweis: f.hinweis,
    basisUrl: basis,
    feld: f.feld,
    symbole: f.symbole,
    skala: f.skala,
    farbe: marke.farbe
  })).join('');

  let html = kasten(
    `<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;`
    + `letter-spacing:0.6px;margin-bottom:2px;">Deine Schicht</div>`
    + `<div style="font-size:16px;font-weight:800;color:#0f172a;line-height:1.3;">`
    + `${maskiere(erste.icon)} ${maskiere(erste.bereich)}</div>`
    + `<div style="font-size:13px;color:#475569;margin:2px 0 18px;">`
    + `${maskiere(erste.datum)} · ${maskiere(erste.slot)}</div>`
    + reihen,
    marke.farbe
  );

  absaetze.push(`Deine Schicht: ${erste.bereich}, ${erste.datum}, ${erste.slot}.`);
  absaetze.push(`Bewerten: ${basis}`);

  const weitere = schichten.slice(1);
  if (weitere.length > 0) {
    html += `<div style="font-size:14px;font-weight:700;color:#0f172a;margin:6px 0 8px;">`
      + `${weitere.length === 1 ? 'Du hattest noch eine Schicht:' : `Du hattest noch ${weitere.length} Schichten:`}`
      + `</div>`;
    html += schichtListe(weitere.map(s => ({
      icon: s.icon,
      bereich: s.bereich,
      wann: `${s.datum} · ${s.slot}`,
      url: `${marke.appUrl}/bewerten?t=${encodeURIComponent(s.token)}`
    })), marke.farbe, 'Bewerten');

    for (const s of weitere) {
      absaetze.push(`${s.bereich}, ${s.datum}, ${s.slot} bewerten: `
        + `${marke.appUrl}/bewerten?t=${encodeURIComponent(s.token)}`);
    }
  }

  return html;
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
    /**
     * Die noch unbewerteten Schichten dieses Empfaengers, frueheste zuerst.
     * Die erste bekommt die Sternereihen, die weiteren je einen Link.
     */
    schichten?: BewertungsSchicht[] | null;
    /** Die Schichten mit den groessten Luecken - fuer den Aufruf. */
    offeneSchichten?: AufrufSchicht[] | null;
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
    /**
     * Die groessten Luecken stehen in der Mail, nicht nur ein Verweis.
     *
     * Ein Aufruf ohne Inhalt verlangt den ersten Schritt vom Empfaenger. Steht
     * dagegen "Grillstand, Sa 5. September 14-16, 2 von 5 besetzt" da, ist die
     * Entscheidung gefallen, bevor die App offen ist. Jede Zeile verlinkt in
     * die App auf genau diese Schicht (?schicht=<id>), damit niemand sie
     * dort suchen muss.
     */
    const offen = eingabe.offeneSchichten ?? [];
    const turnier = marke.turnierId ? `&turnier=${marke.turnierId}` : '';
    if (offen.length > 0) {
      inhalt += `<div style="font-size:14px;font-weight:700;color:#0f172a;margin:4px 0 8px;">`
        + `Hier fehlen gerade die meisten Leute:</div>`;
      inhalt += schichtListe(offen.map(s => ({
        icon: s.icon,
        bereich: s.bereich,
        wann: s.wann,
        hinweis: s.offen === 1 ? 'noch 1 Platz frei' : `noch ${s.offen} Plätze frei`,
        url: `${marke.appUrl}/?schicht=${s.shiftId}${turnier}`
      })), marke.farbe);

      for (const s of offen) {
        absaetze.push(`${s.bereich}, ${s.wann} – ${s.besetzt} von ${s.plaetze} besetzt: `
          + `${marke.appUrl}/?schicht=${s.shiftId}${turnier}`);
      }
    }

    /**
     * Der zweite Weg fuer die, denen keine dieser Schichten passt.
     *
     * Ohne ihn endet die Mail fuer jeden, der zu den genannten Zeiten nicht
     * kann, in einer Sackgasse - und eine Stunde, die nicht ins Raster passt,
     * ist immer noch eine Stunde mehr als gar keine. Derselbe Weg wie der
     * Knopf "Zeit anbieten" im Dashboard.
     */
    inhalt += kasten(
      `<div style="font-size:14px;font-weight:700;color:#0f172a;">Nichts dabei, das passt?</div>`
      + `<div style="font-size:13px;line-height:1.6;color:#475569;margin:4px 0 12px;">`
      + `Sag uns einfach, wann du Zeit hättest – wir schauen, ob wir daraus eine `
      + `Schicht machen können. Auch eine einzelne Stunde hilft.</div>`
      + `<a href="${maskiere(`${marke.appUrl}/?zeitangebot=1${turnier}`)}"`
      + ` style="display:inline-block;padding:11px 18px;font-size:14px;font-weight:700;`
      + `color:#ffffff;background:${marke.farbe};border-radius:8px;text-decoration:none;">`
      + `🙋 Zeit anbieten</a>`,
      marke.farbe
    );
    absaetze.push(`Keine passende Schicht? Zeit anbieten: ${marke.appUrl}/?zeitangebot=1${turnier}`);

    aktion = { text: 'Alle offenen Schichten ansehen', url: `${marke.appUrl}/` };
  }

  const unbewertet = eingabe.schichten ?? [];

  if (id === 'bewertung' && unbewertet.length > 0) {
    inhalt += bewertungsBlock(unbewertet, marke, absaetze);
    aktion = {
      text: 'Bewertung im Browser öffnen',
      url: `${marke.appUrl}/bewerten?t=${encodeURIComponent(unbewertet[0].token)}`
    };
  } else if (id === 'bewertung') {
    // Ohne Schicht - also in der Vorschau - fuehrt der Knopf in die App.
    aktion = { text: 'Schicht bewerten', url: `${marke.appUrl}/` };
    inhalt += `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#64748b;">`
      + `In der echten Mail stehen hier die Fragen zur eigenen Schicht.</p>`;
  }

  if (id === 'danke') {
    /**
     * Der Aufmacher steht VOR dem Text, nicht dahinter.
     *
     * Eine Dankesmail, die mit einer Textwand beginnt, liest sich wie ein
     * Rundschreiben. Das Band ist das Erste, was im Inhalt steht - danach
     * kommt die Anrede.
     */
    inhalt = jubelBand({ symbole: '🎉 🏆 🙌', text: 'Danke fürs Mithelfen!', farbe: marke.farbe })
      + inhalt;

    if (eingabe.zahlen) {
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

    /**
     * Die Bitte um Bewertung haengt hier mit dran - aber nur fuer die, die
     * noch nicht bewertet haben.
     *
     * Zwei Mails weniger fuer den Organisator, und fuer den Empfaenger die
     * naheliegendste Gelegenheit: Er liest gerade, was zusammengekommen ist,
     * und wird im selben Moment gefragt, wie es fuer ihn war. Wer schon
     * bewertet hat, sieht diesen Teil nicht - eine Erinnerung an etwas
     * Erledigtes ist der schnellste Weg, ueberlesen zu werden.
     */
    if (unbewertet.length > 0) {
      // Eine Ueberleitung, sonst springt die Mail von den Zahlen ohne Wort in
      // ein Formular - und ein Formular ohne Frage sieht nach Versehen aus.
      const frage = 'Und wie war es für dich? Das haben wir von dir noch nicht gehört – '
        + 'drei Klicks genügen, und es zählt in die Planung fürs nächste Mal.';
      inhalt += `<p style="margin:6px 0 14px;font-size:15px;line-height:1.6;color:#334155;">`
        + `${maskiere(frage)}</p>`;
      absaetze.push(frage);

      inhalt += bewertungsBlock(unbewertet, marke, absaetze);
      aktion = {
        text: 'Bewertung im Browser öffnen',
        url: `${marke.appUrl}/bewerten?t=${encodeURIComponent(unbewertet[0].token)}`
      };
    }
  }

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
      fusszeile: FUSS_STANDARD,
      appUrl: marke.appUrl,
      testumgebung: marke.testumgebung
    }),
    text: baueText({ titel, absaetze, aktion, fusszeile: FUSS_STANDARD, testumgebung: marke.testumgebung })
  };
}
