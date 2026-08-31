import { effektiveZeit } from './schichtzeit.js';

/**
 * Auswertung eines Turniers: Wer hat getragen, wo blieben Lücken, wie haben
 * sich die Jahrgänge beteiligt.
 *
 * Reine Rechnung ohne Datenbankzugriff - die Daten kommen fertig geladen
 * herein. So ist sie testbar, und die Regeln stehen an einer Stelle statt
 * verteilt über Controller und Anzeige.
 *
 * Zwei Dinge, die man beim Lesen der Zahlen wissen muss und die deshalb in der
 * Ausgabe stehen:
 *
 *  - Ein Helfer kann zu MEHREREN Jahrgängen zählen (zwei Kinder in
 *    verschiedenen Jahrgängen, oder Trainer mehrerer Teams). Die Summe über
 *    alle Jahrgänge ist darum groesser als die Zahl der Helfer.
 *  - Absolute Stunden je Jahrgang belohnen nur Groesse. Erst die Stunden je
 *    Kind machen Jahrgänge vergleichbar.
 */

export interface StatistikShift {
  id: number;
  startMin: number | null;
  endMin: number | null;
  maxVolunteers: number;
  daySlot?: { startMin: number; endMin: number } | null;
  day?: { id: number; date: Date | string } | null;
  workArea?: { id?: number; name?: string; icon?: string } | null;
}

export interface StatistikEinplanung {
  id: number;
  shiftId: number | null;
  userId: number | null;
  user?: {
    id: number;
    name: string;
    children?: { childYear: number }[];
    trainedYearGroups?: { id: number }[];
  } | null;
}

/**
 * Wer diesem Turnier zugeordnet ist - unabhaengig davon, ob er etwas
 * uebernommen hat. Erst dadurch laesst sich sagen, wer NICHT dabei ist;
 * aus den Einplanungen allein sind nur die Aktiven ablesbar.
 */
export interface StatistikMitglied {
  id: number;
  name: string;
  children?: { childYear: number }[];
  trainedYearGroups?: { id: number }[];
}

export interface StatistikJahrgang {
  id: number;
  name: string;
  birthYearStart: number;
  birthYearEnd: number;
}

/** Kennzahl mit Anteil - Anteil nur, wenn es etwas zu teilen gibt. */
function anteil(teil: number, ganzes: number): number | null {
  return ganzes === 0 ? null : Math.round((teil / ganzes) * 100);
}

/** Minuten als "3,5 h" - Stunden sind die Einheit, in der ein Verein denkt. */
export function stundenAus(minuten: number): number {
  return Math.round((minuten / 60) * 10) / 10;
}

/** Tageszeit, in der eine Schicht ueberwiegend liegt. */
function tagesabschnitt(startMin: number): 'morgen' | 'mittag' | 'nachmittag' | 'abend' {
  if (startMin < 720) return 'morgen';
  if (startMin < 840) return 'mittag';
  if (startMin < 1080) return 'nachmittag';
  return 'abend';
}

export const ABSCHNITT_LABEL: Record<string, string> = {
  morgen: 'Vormittag (bis 12 Uhr)',
  mittag: 'Mittag (12–14 Uhr)',
  nachmittag: 'Nachmittag (14–18 Uhr)',
  abend: 'Abend (ab 18 Uhr)'
};

export function berechneTurnierStatistik(
  shifts: StatistikShift[],
  einplanungen: StatistikEinplanung[],
  jahrgaenge: StatistikJahrgang[],
  /** Alle Turnier-Teilnehmer. Ohne sie bleibt die Liste der Unbeteiligten leer. */
  mitglieder: StatistikMitglied[] = []
) {
  // --- Dauer je Schicht, einmal aufgeloest -------------------------------
  const dauerJeShift = new Map<number, number>();
  for (const s of shifts) {
    const { start, ende } = effektiveZeit(s, s.daySlot);
    dauerJeShift.set(s.id, start != null && ende != null ? Math.max(0, ende - start) : 0);
  }
  const shiftById = new Map(shifts.map(s => [s.id, s]));

  // Nur Einplanungen, die an einer echten Schicht dieses Turniers haengen.
  const gueltig = einplanungen.filter(e => e.shiftId != null && shiftById.has(e.shiftId));

  // --- Eckdaten ----------------------------------------------------------
  const helferIds = new Set(gueltig.map(e => e.userId).filter((id): id is number => id != null));
  const minutenGesamt = gueltig.reduce((s, e) => s + (dauerJeShift.get(e.shiftId!) ?? 0), 0);
  const plaetzeGesamt = shifts.reduce((s, sh) => s + sh.maxVolunteers, 0);
  const plaetzeBesetzt = gueltig.length;

  // --- Je Arbeitsbereich --------------------------------------------------
  const bereiche = new Map<string, {
    name: string; icon: string; plaetze: number; besetzt: number; minuten: number;
  }>();
  for (const s of shifts) {
    const name = s.workArea?.name || 'Ohne Bereich';
    if (!bereiche.has(name)) {
      bereiche.set(name, { name, icon: s.workArea?.icon || '📍', plaetze: 0, besetzt: 0, minuten: 0 });
    }
    bereiche.get(name)!.plaetze += s.maxVolunteers;
  }
  for (const e of gueltig) {
    const s = shiftById.get(e.shiftId!)!;
    const eintrag = bereiche.get(s.workArea?.name || 'Ohne Bereich')!;
    eintrag.besetzt += 1;
    eintrag.minuten += dauerJeShift.get(s.id) ?? 0;
  }

  // --- Je Tag -------------------------------------------------------------
  const tage = new Map<string, { datum: string; plaetze: number; besetzt: number; minuten: number }>();
  const tagKey = (s: StatistikShift) =>
    s.day?.date ? new Date(s.day.date).toISOString().slice(0, 10) : 'ohne-datum';
  for (const s of shifts) {
    const k = tagKey(s);
    if (!tage.has(k)) tage.set(k, { datum: k, plaetze: 0, besetzt: 0, minuten: 0 });
    tage.get(k)!.plaetze += s.maxVolunteers;
  }
  for (const e of gueltig) {
    const s = shiftById.get(e.shiftId!)!;
    const eintrag = tage.get(tagKey(s))!;
    eintrag.besetzt += 1;
    eintrag.minuten += dauerJeShift.get(s.id) ?? 0;
  }

  // --- Wer hat getragen ---------------------------------------------------
  const proHelfer = new Map<number, { userId: number; name: string; schichten: number; minuten: number }>();
  for (const e of gueltig) {
    if (e.userId == null) continue;
    if (!proHelfer.has(e.userId)) {
      proHelfer.set(e.userId, { userId: e.userId, name: e.user?.name || 'Unbekannt', schichten: 0, minuten: 0 });
    }
    const h = proHelfer.get(e.userId)!;
    h.schichten += 1;
    h.minuten += dauerJeShift.get(e.shiftId!) ?? 0;
  }
  const helferListe = [...proHelfer.values()];

  // Wie verteilt sich die Arbeit? Die eigentliche Vereinsfrage: Tragen wenige
  // alles, oder verteilt es sich auf viele Schultern?
  const verteilung = { eine: 0, zwei: 0, dreiOderMehr: 0 };
  for (const h of helferListe) {
    if (h.schichten === 1) verteilung.eine += 1;
    else if (h.schichten === 2) verteilung.zwei += 1;
    else verteilung.dreiOderMehr += 1;
  }

  // --- Jahrgänge ----------------------------------------------------------
  const OHNE = -1;
  const jahrgangVon = (u: StatistikEinplanung['user']): number[] => {
    const ids = new Set<number>();
    for (const kind of u?.children ?? []) {
      const treffer = jahrgaenge.find(j => kind.childYear >= j.birthYearStart && kind.childYear <= j.birthYearEnd);
      if (treffer) ids.add(treffer.id);
    }
    for (const t of u?.trainedYearGroups ?? []) ids.add(t.id);
    return ids.size ? [...ids] : [OHNE];
  };

  // Kinder je Jahrgang - Bezugsgroesse fuer den fairen Vergleich. Gezaehlt
  // werden die im System erfassten Kinder, nicht alle des Jahrgangs.
  const kinderJeJahrgang = new Map<number, Set<string>>();
  for (const e of einplanungen) {
    for (const kind of e.user?.children ?? []) {
      const treffer = jahrgaenge.find(j => kind.childYear >= j.birthYearStart && kind.childYear <= j.birthYearEnd);
      if (!treffer) continue;
      if (!kinderJeJahrgang.has(treffer.id)) kinderJeJahrgang.set(treffer.id, new Set());
      // Ein Kind kann mehrfach eingeplant sein - ueber Name+Jahr entdoppeln.
      kinderJeJahrgang.get(treffer.id)!.add(`${e.user?.id}-${kind.childYear}`);
    }
  }

  const jgStat = new Map<number, {
    id: number; name: string; helfer: Set<number>; schichten: number; minuten: number;
  }>();
  for (const e of gueltig) {
    for (const jgId of jahrgangVon(e.user)) {
      if (!jgStat.has(jgId)) {
        jgStat.set(jgId, {
          id: jgId,
          name: jgId === OHNE ? 'Ohne Zuordnung' : (jahrgaenge.find(j => j.id === jgId)?.name ?? `Jahrgang ${jgId}`),
          helfer: new Set(), schichten: 0, minuten: 0
        });
      }
      const eintrag = jgStat.get(jgId)!;
      if (e.userId != null) eintrag.helfer.add(e.userId);
      eintrag.schichten += 1;
      eintrag.minuten += dauerJeShift.get(e.shiftId!) ?? 0;
    }
  }

  // Aufwand je Person und Jahrgang - Grundlage fuer die Aufschluesselung.
  const proPersonJeJg = new Map<number, Map<number, { userId: number; name: string; schichten: number; minuten: number }>>();
  for (const e of gueltig) {
    if (e.userId == null) continue;
    for (const jgId of jahrgangVon(e.user)) {
      if (!proPersonJeJg.has(jgId)) proPersonJeJg.set(jgId, new Map());
      const proJg = proPersonJeJg.get(jgId)!;
      if (!proJg.has(e.userId)) {
        proJg.set(e.userId, { userId: e.userId, name: e.user?.name || 'Unbekannt', schichten: 0, minuten: 0 });
      }
      const person = proJg.get(e.userId)!;
      person.schichten += 1;
      person.minuten += dauerJeShift.get(e.shiftId!) ?? 0;
    }
  }

  /**
   * Wer gehoert zum Jahrgang, hat aber nichts uebernommen?
   *
   * Gedacht als Arbeitsliste fuer den Jahrgangsvertreter: Man kann nur
   * ansprechen, wen man kennt. Deshalb Klarnamen - aber nur hier, in einer
   * Ansicht, die ohnehin nur Organisatoren sehen.
   *
   * Die Liste ist so vollstaendig wie die Mitgliederdaten. Wer kein Konto hat
   * oder kein Kind hinterlegt hat, fehlt. Die Anzeige sagt das dazu, sonst
   * wirkt sie verbindlicher als sie ist.
   */
  const ohneBeteiligungJeJg = new Map<number, { userId: number; name: string }[]>();
  for (const m of mitglieder) {
    const hatGeholfen = helferIds.has(m.id);
    if (hatGeholfen) continue;
    for (const jgId of jahrgangVon(m)) {
      if (jgId === OHNE) continue;   // Ohne Zuordnung ist kein Jahrgang, den man ansprechen kann
      if (!ohneBeteiligungJeJg.has(jgId)) ohneBeteiligungJeJg.set(jgId, []);
      ohneBeteiligungJeJg.get(jgId)!.push({ userId: m.id, name: m.name });
    }
  }

  const jahrgangsBeteiligung = [...jgStat.values()].map(j => {
    const kinder = kinderJeJahrgang.get(j.id)?.size ?? 0;
    const personen = [...(proPersonJeJg.get(j.id)?.values() ?? [])]
      .map(pp => ({ userId: pp.userId, name: pp.name, schichten: pp.schichten, stunden: stundenAus(pp.minuten) }))
      .sort((a, b) => b.stunden - a.stunden || b.schichten - a.schichten || a.name.localeCompare(b.name, 'de'));

    const ohneBeteiligung = (ohneBeteiligungJeJg.get(j.id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    // Wie stark haengt der Jahrgang an wenigen Schultern? Der Anteil der
    // Stunden, den die aktivste Haelfte traegt - 100 % hiesse: einer macht
    // alles. Erst ab drei Aktiven aussagekraeftig.
    const gesamtMinuten = j.minuten;
    const haelfte = Math.ceil(personen.length / 2);
    const obereHaelfteMinuten = personen.slice(0, haelfte)
      .reduce((sum, pp) => sum + (proPersonJeJg.get(j.id)?.get(pp.userId)?.minuten ?? 0), 0);
    const lastAnteilObereHaelfte = personen.length >= 3 && gesamtMinuten > 0
      ? Math.round((obereHaelfteMinuten / gesamtMinuten) * 100)
      : null;

    return {
      id: j.id,
      name: j.name,
      helfer: j.helfer.size,
      schichten: j.schichten,
      stunden: stundenAus(j.minuten),
      kinder,
      // Die faire Zahl: ohne sie steht ein grosser Jahrgang immer besser da.
      stundenProKind: kinder > 0 ? Math.round((j.minuten / 60 / kinder) * 10) / 10 : null,
      personen,
      ohneBeteiligung,
      lastAnteilObereHaelfte
    };
  }).sort((a, b) => {
    if (a.name === 'Ohne Zuordnung') return 1;
    if (b.name === 'Ohne Zuordnung') return -1;
    return b.stunden - a.stunden;
  });

  // Doppelzaehlung sichtbar machen, statt sie zu verschweigen.
  const jahrgangSummeHelfer = jahrgangsBeteiligung.reduce((s, j) => s + j.helfer, 0);

  // --- Wo blieben Lücken --------------------------------------------------
  const abschnitte = new Map<string, { abschnitt: string; label: string; plaetze: number; besetzt: number }>();
  for (const s of shifts) {
    const { start } = effektiveZeit(s, s.daySlot);
    if (start == null) continue;
    const a = tagesabschnitt(start);
    if (!abschnitte.has(a)) abschnitte.set(a, { abschnitt: a, label: ABSCHNITT_LABEL[a], plaetze: 0, besetzt: 0 });
    abschnitte.get(a)!.plaetze += s.maxVolunteers;
  }
  const besetztJeShift = new Map<number, number>();
  for (const e of gueltig) besetztJeShift.set(e.shiftId!, (besetztJeShift.get(e.shiftId!) ?? 0) + 1);
  for (const s of shifts) {
    const { start } = effektiveZeit(s, s.daySlot);
    if (start == null) continue;
    abschnitte.get(tagesabschnitt(start))!.besetzt += besetztJeShift.get(s.id) ?? 0;
  }

  // Die einzelnen Schichten mit den groessten Luecken - konkret genug, um beim
  // naechsten Mal gezielt frueher zu fragen.
  const groessteLuecken = shifts
    .map(s => {
      const { start, ende } = effektiveZeit(s, s.daySlot);
      return {
        shiftId: s.id,
        bereich: s.workArea?.name || 'Ohne Bereich',
        icon: s.workArea?.icon || '📍',
        datum: s.day?.date ? new Date(s.day.date).toISOString().slice(0, 10) : null,
        startMin: start,
        endMin: ende,
        plaetze: s.maxVolunteers,
        besetzt: besetztJeShift.get(s.id) ?? 0,
        offen: Math.max(0, s.maxVolunteers - (besetztJeShift.get(s.id) ?? 0))
      };
    })
    .filter(l => l.offen > 0)
    .sort((a, b) => b.offen - a.offen || (a.startMin ?? 0) - (b.startMin ?? 0))
    .slice(0, 10);

  return {
    eckdaten: {
      helfer: helferIds.size,
      schichten: gueltig.length,
      stunden: stundenAus(minutenGesamt),
      plaetze: plaetzeGesamt,
      besetzt: plaetzeBesetzt,
      offen: Math.max(0, plaetzeGesamt - plaetzeBesetzt),
      besetzungsgrad: anteil(plaetzeBesetzt, plaetzeGesamt)
    },
    jeBereich: [...bereiche.values()]
      .map(b => ({
        name: b.name, icon: b.icon, plaetze: b.plaetze, besetzt: b.besetzt,
        offen: Math.max(0, b.plaetze - b.besetzt),
        stunden: stundenAus(b.minuten),
        besetzungsgrad: anteil(b.besetzt, b.plaetze)
      }))
      .sort((a, b) => b.offen - a.offen || b.plaetze - a.plaetze),
    jeTag: [...tage.values()]
      .map(t => ({
        datum: t.datum, plaetze: t.plaetze, besetzt: t.besetzt,
        offen: Math.max(0, t.plaetze - t.besetzt),
        stunden: stundenAus(t.minuten),
        besetzungsgrad: anteil(t.besetzt, t.plaetze)
      }))
      .sort((a, b) => a.datum.localeCompare(b.datum)),
    werHatGetragen: {
      nachStunden: [...helferListe]
        .sort((a, b) => b.minuten - a.minuten || b.schichten - a.schichten)
        .slice(0, 10)
        .map(h => ({ userId: h.userId, name: h.name, schichten: h.schichten, stunden: stundenAus(h.minuten) })),
      nachSchichten: [...helferListe]
        .sort((a, b) => b.schichten - a.schichten || b.minuten - a.minuten)
        .slice(0, 10)
        .map(h => ({ userId: h.userId, name: h.name, schichten: h.schichten, stunden: stundenAus(h.minuten) })),
      verteilung,
      schnittStundenProHelfer: helferListe.length
        ? Math.round((minutenGesamt / 60 / helferListe.length) * 10) / 10
        : 0
    },
    jahrgaenge: {
      liste: jahrgangsBeteiligung,
      /** true, wenn Helfer mehrfach gezaehlt wurden - die Anzeige sagt es dann. */
      mehrfachzaehlung: jahrgangSummeHelfer > helferIds.size
    },
    luecken: {
      jeAbschnitt: [...abschnitte.values()]
        .map(a => ({
          ...a,
          offen: Math.max(0, a.plaetze - a.besetzt),
          besetzungsgrad: anteil(a.besetzt, a.plaetze)
        }))
        .sort((a, b) => b.offen - a.offen),
      groessteLuecken
    }
  };
}

export type TurnierStatistik = ReturnType<typeof berechneTurnierStatistik>;
