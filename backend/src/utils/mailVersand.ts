import { Resend } from 'resend';
import prisma from '../config/prisma.js';
import { resolveEmailFrom, resolveFrontendUrl } from './mailAbsender.js';
import { ermittleUmgebung } from './umgebung.js';
import {
  baueVorlage, Marke, VorlagenId, DankeZahlen, BewertungsSchicht, AufrufSchicht,
  AufrufVerpflegungsPosten
} from './mailVorlagen.js';
import { baueBewertungsToken } from './bewertungsLink.js';
import { ermittleOffeneSchichten } from './offeneSchichten.js';
import { ermittleOffeneVerpflegung, waehleFuerEmpfaenger } from './offeneVerpflegung.js';

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
        select: {
          id: true, name: true, logo: true,
          club: { select: { id: true, name: true, primaryColor: true, logo: true } }
        }
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
    turniername: turnier?.name || null,
    turnierId: turnier?.id ?? null,
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
 * Sucht je Empfaenger ALLE noch unbewerteten Schichten, frueheste zuerst.
 *
 * Eine Abfrage fuer alle statt eine je Person: Bei achtzig Empfaengern waeren
 * das sonst achtzig Abfragen fuer eine Mail.
 *
 * "Unbewertet" heisst: keine der drei Fragen beantwortet. Dieselbe Definition
 * benutzt die App (`bereitsBewertet` in DashboardView) - eine zweite waere
 * schlimmer als eine strenge: Dann stuende eine Schicht in der Mail als
 * offen, die die App als bewertet fuehrt, und niemand koennte erklaeren,
 * warum.
 */
async function ermittleBewertungsSchichten(
  tournamentId: number | null,
  userIds: number[]
): Promise<Map<number, BewertungsSchicht[]>> {
  const treffer = new Map<number, BewertungsSchicht[]>();
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
      shift: {
        select: {
          workArea: { select: { name: true, icon: true } },
          day: { select: { date: true } }
        }
      }
    },
    orderBy: [{ date: 'asc' }, { slot: 'asc' }]
  });

  for (const vs of offene) {
    if (vs.userId == null) continue;
    const datum = vs.shift?.day?.date ?? vs.date;
    const liste = treffer.get(vs.userId) ?? [];
    liste.push({
      token: baueBewertungsToken({ volunteerShiftId: vs.id, userId: vs.userId }),
      bereich: vs.shift?.workArea?.name || vs.role,
      icon: vs.shift?.workArea?.icon || '📍',
      datum: DATUM_LANG.format(new Date(datum)),
      slot: vs.slot
    });
    treffer.set(vs.userId, liste);
  }

  return treffer;
}

const DATUM_KURZ = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin'
});

/** Die groessten Luecken, aufbereitet fuer den Schichtappell. */
async function ermittleAufrufSchichten(tournamentId: number | null): Promise<AufrufSchicht[]> {
  if (!tournamentId) return [];
  const offen = await ermittleOffeneSchichten(tournamentId);
  return offen.map(s => ({
    shiftId: s.shiftId,
    bereich: s.bereich,
    icon: s.icon,
    wann: [s.datum ? DATUM_KURZ.format(s.datum) : null, s.zeit].filter(Boolean).join(', ')
      || 'Zeit noch offen',
    plaetze: s.plaetze,
    besetzt: s.besetzt,
    offen: s.offen
  }));
}

/**
 * Die Verpflegungsposten je Empfaenger, fuer den Verpflegungsappell.
 *
 * Personalisiert: Hat der Empfaenger ein eigenes Kind im Turnier, sieht er
 * die Posten von dessen Jahrgang - sonst die turnierweit groessten Luecken.
 * Die eigentliche Auswahl steckt in der reinen Funktion
 * `waehleFuerEmpfaenger` (offeneVerpflegung.ts); hier steht nur, WAS dafuer
 * aus der Datenbank kommt: die Kinder je Empfaenger und die Jahrgaenge dieses
 * Turniers.
 */
async function ermittleVerpflegungListen(
  tournamentId: number | null,
  userIds: number[]
): Promise<Map<number, AufrufVerpflegungsPosten[]>> {
  const ergebnis = new Map<number, AufrufVerpflegungsPosten[]>();
  if (!tournamentId || userIds.length === 0) return ergebnis;

  const [alleOffenen, kinder, turnier] = await Promise.all([
    ermittleOffeneVerpflegung(tournamentId),
    prisma.userChild.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, childYear: true }
    }),
    prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { yearGroups: { select: { id: true, birthYearStart: true, birthYearEnd: true } } }
    })
  ]);

  const jahrgaenge = turnier?.yearGroups ?? [];
  const kinderJeUser = new Map<number, number[]>();
  for (const k of kinder) {
    if (k.userId == null) continue;
    const jahre = kinderJeUser.get(k.userId) ?? [];
    jahre.push(k.childYear);
    kinderJeUser.set(k.userId, jahre);
  }

  for (const uid of userIds) {
    const ausgewaehlt = waehleFuerEmpfaenger(alleOffenen, kinderJeUser.get(uid) ?? [], jahrgaenge);
    ergebnis.set(uid, ausgewaehlt.map(p => ({
      slotId: p.slotId,
      jahrgang: p.jahrgang,
      icon: p.icon,
      name: p.name,
      beschreibung: p.beschreibung,
      ziel: p.ziel,
      gesammelt: p.gesammelt,
      offen: p.offen
    })));
  }

  return ergebnis;
}

/**
 * Fuehrt eine der Sammel-Abfragen aus und faengt einen Fehlschlag ab.
 *
 * `laden` ist `null`, wenn diese Vorlage die Abfrage gar nicht braucht - dann
 * direkt der Leerwert, ohne zu loggen (das waere kein Fehler, sondern der
 * Normalfall fuer drei von vier Vorlagen).
 */
async function ladeSicher<T>(
  laden: (() => Promise<T>) | null,
  leerwert: T,
  name: string
): Promise<T> {
  if (!laden) return leerwert;
  try {
    return await laden();
  } catch (err) {
    console.error(JSON.stringify({
      event: 'MAIL_VORBEREITUNG_FEHLGESCHLAGEN',
      funktion: name,
      error: (err as Error).message,
      timestamp: new Date().toISOString()
    }));
    return leerwert;
  }
}

export interface VersandErgebnis {
  gesendet: number;
  fehlgeschlagen: number;
  /** Nicht versucht, weil keine Adresse hinterlegt ist. */
  ohneAdresse: number;
  /**
   * Nicht versucht, weil es fuer diese Person nichts zu bewerten gibt.
   *
   * Wird gezaehlt und gemeldet, nicht verschwiegen: Der Organisator waehlt
   * die Zielgruppe aus und muss sehen, dass sie kleiner war als gedacht -
   * sonst wartet er auf Antworten von Leuten, die nie gefragt wurden.
   */
  ohneOffeneBewertung: number;
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
  eingabe: {
    betreff: string;
    text: string;
    zahlen?: DankeZahlen | null;
    tournamentId?: number | null;
    /**
     * Testversand an sich selbst - die Sperre "nur an noch nicht Bewertete"
     * gilt hier NICHT.
     *
     * Sonst liesse sich die Bewertungsmail nicht mehr ansehen, sobald man sie
     * einmal fuer die eigene Schicht abgeschlossen hat: Jeder Testversand
     * wuerde sich selbst uebersprungen sehen, und eine Vorschau waere gar
     * nicht mehr moeglich. Gibt es fuer die eigene Person keine offene
     * Schicht, faellt die Vorlage auf den Platzhaltertext zurueck (siehe
     * mailVorlagen.ts) - das ist fuer einen Test kein Fehler, nur kein
     * Beispiel mit echten Sternen.
     */
    istTestversand?: boolean;
  },
  marke: Marke
): Promise<VersandErgebnis> {
  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    console.warn('[mail] RESEND_API_KEY fehlt - es wird nichts versendet.');
    return {
      gesendet: 0, fehlgeschlagen: empfaenger.length, ohneAdresse: 0, ohneOffeneBewertung: 0
    };
  }

  /**
   * Was diese Vorlage an Daten braucht - einmal fuer alle, nicht je Mail.
   *
   * Die Bewertungs- und die Dankesvorlage brauchen die unbewerteten Schichten
   * je Person, der Schichtappell die groessten Luecken des Turniers, der
   * Verpflegungsappell die Listen je Empfaenger. Eine Abfrage, die eine
   * Vorlage nicht braucht, laeuft nicht.
   *
   * Jede einzeln abgesichert: Scheitert eine dieser Abfragen (z.B. weil die
   * Datenbank kurz nicht erreichbar war), soll das nicht den kompletten
   * Versand verhindern - eine Bewertungsmail ohne die personalisierte Liste
   * waere zwar unvollstaendiger als gedacht, aber immer noch besser als eine
   * Mail, die bei niemandem ankommt.
   */
  const schichten = await ladeSicher(
    vorlage === 'bewertung' || vorlage === 'danke'
      ? () => ermittleBewertungsSchichten(eingabe.tournamentId ?? null, empfaenger.map(e => e.id))
      : null,
    new Map<number, BewertungsSchicht[]>(),
    'ermittleBewertungsSchichten'
  );
  const offeneSchichten = await ladeSicher(
    vorlage === 'appell-schicht' ? () => ermittleAufrufSchichten(eingabe.tournamentId ?? null) : null,
    [] as AufrufSchicht[],
    'ermittleAufrufSchichten'
  );
  const verpflegungListen = await ladeSicher(
    vorlage === 'appell-verpflegung'
      ? () => ermittleVerpflegungListen(eingabe.tournamentId ?? null, empfaenger.map(e => e.id))
      : null,
    new Map<number, AufrufVerpflegungsPosten[]>(),
    'ermittleVerpflegungListen'
  );

  const resend = new Resend(schluessel);
  const from = resolveEmailFrom();
  let gesendet = 0;
  let fehlgeschlagen = 0;
  let ohneOffeneBewertung = 0;

  for (const e of empfaenger) {
    const unbewertet = schichten.get(e.id) ?? [];

    /**
     * Wer nichts zu bewerten hat, bekommt die Bewertungsmail nicht.
     *
     * Sonst kaeme eine Mail mit dem Betreff "Wie war deine Schicht?" bei
     * jemandem an, der schon geantwortet hat - oder bei jemandem, der gar
     * keine Schicht hatte. Beides kostet Glaubwuerdigkeit fuer den naechsten
     * Aufruf, und der ist das eigentliche Kapital.
     *
     * Bei der Dankesmail ist es umgekehrt: Die geht an alle, denn gedankt
     * wird auch dem, der schon bewertet hat. Dort entfaellt nur der
     * Bewertungsteil.
     */
    if (vorlage === 'bewertung' && unbewertet.length === 0 && !eingabe.istTestversand) {
      ohneOffeneBewertung++;
      continue;
    }

    try {
      /**
       * Der Bau der Mail steht MIT im try-Block, nicht davor.
       *
       * Stand er davor (wie frueher), riss ein einziger fehlerhafter
       * Datensatz - eine Schicht ohne Bereich, ein Empfaenger mit
       * ungewoehnlichen Daten - den gesamten Versand ab: Die Ausnahme flog
       * unbehandelt aus dem Schleifenkoerper, `versendeMails` brach ab, und
       * NIEMAND bekam eine Mail, nicht einmal die Empfaenger vor der
       * fehlerhaften Stelle. Mit dem Bau im try-Block scheitert nur diese
       * eine Mail - der Rest der Zielgruppe wird trotzdem erreicht.
       */
      const mail = baueVorlage(vorlage, {
        betreff: eingabe.betreff,
        text: eingabe.text,
        // Nur der Vorname: "Hallo Anja" liest sich wie von einem Menschen,
        // "Hallo Anja Petersen" wie von einem Serienbrief.
        anrede: e.name.trim().split(/\s+/)[0] || e.name,
        zahlen: eingabe.zahlen ?? null,
        schichten: unbewertet,
        offeneSchichten,
        offeneVerpflegung: verpflegungListen.get(e.id) ?? []
      }, marke);

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

  return { gesendet, fehlgeschlagen, ohneAdresse: 0, ohneOffeneBewertung };
}
