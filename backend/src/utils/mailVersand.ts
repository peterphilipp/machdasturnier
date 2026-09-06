import { Resend } from 'resend';
import prisma from '../config/prisma.js';
import { resolveEmailFrom, resolveFrontendUrl } from './mailAbsender.js';
import { ermittleUmgebung } from './umgebung.js';
import {
  baueVorlage, Marke, VorlagenId, DankeZahlen, BewertungsSchicht, AufrufSchicht,
  AufrufVerpflegungsPosten, Mailinhalt
} from './mailVorlagen.js';
import { baueBewertungsToken } from './bewertungsLink.js';
import { ermittleOffeneSchichten } from './offeneSchichten.js';
import { ermittleOffeneVerpflegung, waehleFuerEmpfaenger } from './offeneVerpflegung.js';
import { aktuelleSchichtzeit } from './schichtzeit.js';
import { berechneTurnierStatistik } from './turnierStatistik.js';

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

/**
 * Die Zahlen fuer die Dankesmail.
 *
 * Bewusst aus berechneTurnierStatistik() und nicht hier nachgerechnet: Die
 * Mail soll dieselben Zahlen nennen wie die Statistikansicht und der
 * Turnierabschluss. Zwei Rechnungen waeren zwei Wahrheiten, und ein Verein,
 * dem per Mail andere Zahlen genannt werden als im Bericht, glaubt am Ende
 * keiner von beiden.
 *
 * Hier statt im Controller, weil ein Versandauftrag (siehe scheduler.ts) die
 * Zahlen bei jedem Tick frisch braucht, nicht nur beim allerersten Aufruf -
 * sonst zeigte die Danke-Mail an einem spaeteren Tag noch den Stand von
 * vorgestern.
 */
export async function ermittleDankeZahlen(tournamentId: number): Promise<DankeZahlen | null> {
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
          startMin: true, endMin: true,
          daySlot: { select: { startMin: true, endMin: true } },
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
      // Live berechnet, nicht die beim Einplanen gespeicherte Kopie - siehe
      // aktuelleSchichtzeit() fuer den Grund (Tagesraster-Aenderungen ziehen
      // die Kopie sonst nicht nach).
      slot: aktuelleSchichtzeit(vs.shift, vs.slot)
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

/**
 * Verschickt EINE fertig gebaute Mail an EINE Adresse.
 *
 * Der gemeinsame letzte Schritt fuer beide Versandwege: den Rundschreiben aus
 * dem Nachrichten-Tab (versendeMails, unten) und die einzelne Benachrichtigung
 * bei einer Zusage/Absage/Verschiebung (notify.ts). Eine einzige Stelle, die
 * pruefen kann, ob RESEND_API_KEY fehlt, und die Fehler einheitlich loggt -
 * zwei Kopien dieser Logik wuerden bei der naechsten Aenderung garantiert
 * auseinanderlaufen.
 */
function warte(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resends Tageskontingent, mit Puffer.
 *
 * Der kostenlose Plan deckelt hart bei 100 Mails pro Kalendertag (UTC - das
 * ist Resends eigene Reset-Grenze, nicht Berliner Mitternacht). Der Standard
 * hier liegt bewusst darunter: Reminder, Bestaetigungen und Versandauftraege
 * teilen sich denselben Zaehler, und ein Puffer verhindert, dass ausgerechnet
 * die letzten paar Anfragen des Tages doch noch von Resend selbst abgelehnt
 * werden (dort zaehlt der Tag u.U. schon eine Sekunde frueher um).
 */
const RESEND_DAILY_LIMIT = Number(process.env.RESEND_DAILY_LIMIT) || 90;

function heutigerUtcTag(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Ob heute noch Luft im Tageskontingent ist - ohne bei Resend nachzufragen. */
async function kontingentVerfuegbar(): Promise<boolean> {
  const eintrag = await prisma.mailkontingent.findUnique({ where: { tag: heutigerUtcTag() } });
  return (eintrag?.anzahl ?? 0) < RESEND_DAILY_LIMIT;
}

/** Zaehlt einen tatsaechlich verschickten Versuch auf den heutigen Tag. */
async function kontingentVerbrauchen(): Promise<void> {
  const tag = heutigerUtcTag();
  await prisma.mailkontingent.upsert({
    where: { tag },
    create: { tag, anzahl: 1 },
    update: { anzahl: { increment: 1 } }
  });
}

export type SendeErgebnis = 'gesendet' | 'fehlgeschlagen' | 'kontingent_erschoepft';

/**
 * Verschickt eine Mail - mit Geduld gegenueber Resends Ratenlimit UND
 * Tageskontingent.
 *
 * Aufgefallen bei einem echten Versand an ueber 50 Empfaenger: Nur die ersten
 * paar kamen an, der Rest verschwand spurlos - nicht einmal als Fehlschlag im
 * Resend-Dashboard, weil eine per Ratenlimit ABGELEHNTE Anfrage dort nie zu
 * einer E-Mail wird, ueber die man etwas nachsehen koennte. Resends Standard-
 * Ratenlimit liegt bei wenigen Anfragen pro Sekunde; unser Versand feuerte
 * bisher ohne jede Pause, also sofort dagegen. Zwei Gegenmassnahmen: eine
 * Pause zwischen JEDER Mail (siehe versendeMails, WARTE_ZWISCHEN_MAILS_MS),
 * und hier zusaetzlich ein paar Versuche mit steigender Wartezeit, falls es
 * trotzdem knapp wird - Resends Fehlercode dafuer ist "rate_limit_exceeded".
 *
 * Das TAGESkontingent ist ein zweites, hartes Limit (100/Tag beim kostenlosen
 * Plan) - dagegen hilft kein Warten und kein Wiederholen. Ist es erschoepft,
 * wird gar nicht erst versucht: sonst zaehlte ein serverseitig abgelehnter
 * Versuch als "fehlgeschlagen", obwohl er morgen anstandslos ankaeme.
 * `versendeMails()` und `verarbeiteVersandauftraege()` lassen so einen
 * Empfaenger dann bewusst "offen" statt ihn als endgueltig gescheitert zu
 * markieren.
 */
export async function sendeEinzelmail(
  empfaenger: { id: number; email: string },
  mail: Mailinhalt
): Promise<SendeErgebnis> {
  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    console.warn('[mail] RESEND_API_KEY fehlt - es wird nichts versendet.');
    return 'fehlgeschlagen';
  }

  if (!(await kontingentVerfuegbar())) {
    return 'kontingent_erschoepft';
  }

  const resend = new Resend(schluessel);
  const MAX_VERSUCHE = 4;

  for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
    try {
      const antwort = await resend.emails.send({
        from: resolveEmailFrom(),
        to: empfaenger.email,
        subject: mail.betreff,
        html: mail.html,
        text: mail.text
      });
      if (antwort.error) {
        if (antwort.error.name === 'rate_limit_exceeded' && versuch < MAX_VERSUCHE) {
          await warte(versuch * 1000);
          continue;
        }
        if (antwort.error.name === 'daily_quota_exceeded' || antwort.error.name === 'monthly_quota_exceeded') {
          // Unser eigener Zaehler haette das eigentlich schon abgefangen -
          // z.B. weil ein anderer Prozess (Erinnerung, Bestaetigung)
          // zwischenzeitlich denselben Tag ausgeschoepft hat. Trotzdem als
          // Kontingent-Erschoepfung behandeln, nicht als Fehlschlag.
          return 'kontingent_erschoepft';
        }
        throw new Error(antwort.error.message);
      }
      await kontingentVerbrauchen();
      return 'gesendet';
    } catch (err) {
      if (versuch < MAX_VERSUCHE) {
        await warte(versuch * 1000);
        continue;
      }
      // Die Adresse mitloggen, nicht den Inhalt: Beim Nachsehen will man
      // wissen, WER nicht erreicht wurde.
      console.error(JSON.stringify({
        event: 'MAIL_SEND_FAILED',
        to: empfaenger.email,
        userId: empfaenger.id,
        error: (err as Error).message,
        timestamp: new Date().toISOString()
      }));
      return 'fehlgeschlagen';
    }
  }
  return 'fehlgeschlagen';
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
  /**
   * Gar nicht erst versucht, weil das Tageskontingent aufgebraucht war -
   * anders als "fehlgeschlagen" bewusst getrennt gezaehlt: Diese Empfaenger
   * sind kein Fehler, sie sind morgen dran (siehe verarbeiteVersandauftraege
   * in scheduler.ts).
   */
  kontingentErschoepft: number;
  /**
   * Ergebnis JE Empfaenger, nicht nur die Summen - fuer versandauftraege.ts:
   * ein Versandauftrag muss auf genau dieser Person weitermachen koennen,
   * nicht nur wissen, dass "irgendwer" gescheitert ist.
   */
  ergebnisse: VersandEmpfaengerErgebnis[];
}

export interface VersandEmpfaengerErgebnis {
  userId: number;
  /** "offen" heisst: nicht versucht, weil das Tageskontingent leer war. */
  status: 'gesendet' | 'fehlgeschlagen' | 'uebersprungen' | 'offen';
  grund?: string;
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
      gesendet: 0, fehlgeschlagen: empfaenger.length, ohneAdresse: 0, ohneOffeneBewertung: 0,
      kontingentErschoepft: 0,
      ergebnisse: empfaenger.map(e => ({ userId: e.id, status: 'fehlgeschlagen' as const }))
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

  /**
   * Abstand zwischen zwei Anfragen an Resend.
   *
   * Ohne diese Pause feuerte der Versand so schnell hintereinander, wie
   * Node es zulaesst - bei einem echten Versand an ueber 50 Empfaenger kamen
   * nur die ersten paar an, der Rest scheiterte an Resends Ratenlimit (siehe
   * sendeEinzelmail). 600ms sind bei Vereinsgroesse (siehe Kommentar oben)
   * kein spuerbarer Unterschied, halten den Versand aber sicher unter
   * ueblichen Ratenlimits von wenigen Anfragen pro Sekunde.
   */
  const WARTE_ZWISCHEN_MAILS_MS = 600;

  let gesendet = 0;
  let fehlgeschlagen = 0;
  let ohneOffeneBewertung = 0;
  let kontingentErschoepft = 0;
  let versandVersuche = 0;
  const ergebnisse: VersandEmpfaengerErgebnis[] = [];

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
      ergebnisse.push({ userId: e.id, status: 'uebersprungen', grund: 'ohneOffeneBewertung' });
      continue;
    }

    /**
     * Sobald ein Versuch am Tageskontingent scheitert, gilt das fuer den Rest
     * dieses Laufs genauso - ein erneuter Versuch wuerde nur dieselbe Absage
     * kassieren. Die restlichen Empfaenger bleiben deshalb unangetastet
     * ("offen"), statt sie als Fehlschlag zu verbrauchen: Sie sind morgen
     * ganz normal dran.
     */
    if (kontingentErschoepft > 0) {
      kontingentErschoepft++;
      ergebnisse.push({ userId: e.id, status: 'offen' });
      continue;
    }

    if (versandVersuche > 0) await warte(WARTE_ZWISCHEN_MAILS_MS);
    versandVersuche++;

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

      const ergebnis = await sendeEinzelmail(e, mail);
      if (ergebnis === 'gesendet') {
        gesendet++;
        ergebnisse.push({ userId: e.id, status: 'gesendet' });
      } else if (ergebnis === 'kontingent_erschoepft') {
        kontingentErschoepft++;
        ergebnisse.push({ userId: e.id, status: 'offen' });
      } else {
        fehlgeschlagen++;
        ergebnisse.push({ userId: e.id, status: 'fehlgeschlagen' });
      }
    } catch (err) {
      // Der Mailbau selbst ist gescheitert (sendeEinzelmail loggt einen
      // Sendefehlschlag bereits selbst - das hier ist der seltenere Fall
      // davor).
      fehlgeschlagen++;
      ergebnisse.push({ userId: e.id, status: 'fehlgeschlagen' });
      console.error(JSON.stringify({
        event: 'MAIL_BUILD_FAILED',
        to: e.email,
        userId: e.id,
        error: (err as Error).message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  return { gesendet, fehlgeschlagen, ohneAdresse: 0, ohneOffeneBewertung, kontingentErschoepft, ergebnisse };
}
