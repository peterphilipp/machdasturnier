/**
 * Wann kam die Hilfe zusammen - und wonach.
 *
 * Beantwortet die Frage, die eine Momentaufnahme nicht beantworten kann:
 * Hat der Aufruf am Dienstag etwas bewirkt, oder waeren die Zusagen ohnehin
 * gekommen? Dafuer werden Zusagen und Spenden je Tag gezaehlt und die
 * versendeten Aufrufe als Bezugspunkte danebengestellt.
 *
 * Reine Rechnung ohne Datenbankzugriff, damit sie testbar bleibt.
 */

export interface VerlaufEreignis {
  /** Zeitpunkt der Eintragung. Null bei Altbestand ohne Zeitstempel. */
  createdAt: Date | string | null;
}

export interface VerlaufAufruf {
  id: number;
  titel: string;
  empfaenger: string;
  erreicht: number;
  createdAt: Date | string;
}

export interface VerlaufTag {
  datum: string;
  zusagen: number;
  spenden: number;
  /** Aufrufe, die an diesem Tag rausgingen. */
  aufrufe: { id: number; titel: string; erreicht: number }[];
  /** Laufende Summe - zeigt, wie sich der Plan gefuellt hat. */
  zusagenKumuliert: number;
  spendenKumuliert: number;
}

const tagVon = (d: Date | string): string => new Date(d).toISOString().slice(0, 10);

/** Alle Tage zwischen zwei Daten, damit die Kurve keine Luecken springt. */
function tageZwischen(vonISO: string, bisISO: string): string[] {
  const tage: string[] = [];
  const von = new Date(vonISO + 'T00:00:00.000Z');
  const bis = new Date(bisISO + 'T00:00:00.000Z');
  for (let d = von; d <= bis; d = new Date(d.getTime() + 86400000)) {
    tage.push(d.toISOString().slice(0, 10));
  }
  return tage;
}

export function berechneZeitverlauf(
  zusagen: VerlaufEreignis[],
  spenden: VerlaufEreignis[],
  aufrufe: VerlaufAufruf[]
): {
  tage: VerlaufTag[];
  /** Zusagen aus der Zeit vor der Zeiterfassung - ehrlich getrennt ausgewiesen. */
  ohneZeitstempel: number;
} {
  const mitZeit = zusagen.filter(z => z.createdAt != null);
  const ohneZeitstempel = zusagen.length - mitZeit.length;

  const zaehlen = (liste: { createdAt: Date | string | null }[]) => {
    const proTag = new Map<string, number>();
    for (const e of liste) {
      if (e.createdAt == null) continue;
      const t = tagVon(e.createdAt);
      proTag.set(t, (proTag.get(t) ?? 0) + 1);
    }
    return proTag;
  };

  const zusagenProTag = zaehlen(mitZeit);
  const spendenProTag = zaehlen(spenden);

  const aufrufeProTag = new Map<string, VerlaufAufruf[]>();
  for (const a of aufrufe) {
    const t = tagVon(a.createdAt);
    if (!aufrufeProTag.has(t)) aufrufeProTag.set(t, []);
    aufrufeProTag.get(t)!.push(a);
  }

  const alleTage = [
    ...zusagenProTag.keys(),
    ...spendenProTag.keys(),
    ...aufrufeProTag.keys()
  ].sort();

  if (alleTage.length === 0) return { tage: [], ohneZeitstempel };

  // Luecken auffuellen: Ein Tag ohne Zusagen ist eine Aussage ("da kam
  // nichts") und darf nicht einfach uebersprungen werden - sonst sieht eine
  // Woche Stillstand aus wie ein stetiger Anstieg.
  let zusagenSumme = 0;
  let spendenSumme = 0;

  const tage = tageZwischen(alleTage[0], alleTage[alleTage.length - 1]).map(datum => {
    const z = zusagenProTag.get(datum) ?? 0;
    const s = spendenProTag.get(datum) ?? 0;
    zusagenSumme += z;
    spendenSumme += s;
    return {
      datum,
      zusagen: z,
      spenden: s,
      aufrufe: (aufrufeProTag.get(datum) ?? []).map(a => ({
        id: a.id, titel: a.titel, erreicht: a.erreicht
      })),
      zusagenKumuliert: zusagenSumme,
      spendenKumuliert: spendenSumme
    };
  });

  return { tage, ohneZeitstempel };
}

/** Ein einzelner Eintrag in der Chronik: wer, wann, was. */
export interface ChronikEintrag {
  zeitpunkt: string;
  art: 'schicht' | 'spende';
  name: string;
  was: string;
}

/**
 * Wer wann was zugesagt hat - die Einzeleintraege hinter der Tageskurve.
 *
 * Die Kurve beantwortet "wann kam etwas zusammen", nicht "wer war frueh dran
 * und wer spaet". Fuer das Gespraech im Orgateam ist die zweite Frage oft die
 * eigentliche: Wer traegt sich sofort ein, wen muss man erinnern.
 *
 * Bewusst chronologisch und nicht als Rangliste. Eine Sortierung nach "wer war
 * am spaetesten" waere eine Liste der Saeumigen, und die entsteht hier nicht -
 * spaet eingetragen heisst oft nur, spaet gefragt worden zu sein.
 *
 * Eintraege ohne Zeitstempel fehlen; sie stammen aus der Zeit vor der
 * Erfassung und liessen sich nur raten.
 */
export function chronik(
  zusagen: (VerlaufEreignis & { name?: string | null; was?: string | null })[],
  spenden: (VerlaufEreignis & { name?: string | null; was?: string | null })[]
): ChronikEintrag[] {
  const bauen = (
    liste: (VerlaufEreignis & { name?: string | null; was?: string | null })[],
    art: ChronikEintrag['art']
  ): ChronikEintrag[] =>
    liste
      .filter(e => e.createdAt != null)
      .map(e => ({
        zeitpunkt: new Date(e.createdAt as Date | string).toISOString(),
        art,
        name: e.name || 'Unbekannt',
        was: e.was || (art === 'schicht' ? 'Schicht' : 'Spende')
      }));

  return [...bauen(zusagen, 'schicht'), ...bauen(spenden, 'spende')]
    .sort((a, b) => a.zeitpunkt.localeCompare(b.zeitpunkt));
}

/**
 * Was ein Aufruf bewirkt hat: die Reaktionen im Zeitfenster danach.
 *
 * Bewusst als schlichte Zaehlung im Fenster und nicht als "Wirkung": Dass
 * jemand am Tag nach dem Aufruf zusagt, kann daran liegen - muss aber nicht.
 * Die Zahl ist ein Anhaltspunkt fuer die Diskussion, kein Beweis.
 */
export function reaktionAufAufruf(
  aufruf: VerlaufAufruf,
  zusagen: VerlaufEreignis[],
  spenden: VerlaufEreignis[],
  fensterStunden = 48
): { zusagen: number; spenden: number } {
  const start = new Date(aufruf.createdAt).getTime();
  const ende = start + fensterStunden * 3600 * 1000;

  const imFenster = (liste: VerlaufEreignis[]) => liste.filter(e => {
    if (e.createdAt == null) return false;
    const t = new Date(e.createdAt).getTime();
    return t >= start && t <= ende;
  }).length;

  return { zusagen: imFenster(zusagen), spenden: imFenster(spenden) };
}
