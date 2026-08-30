export interface FeedbackItem {
  id: number;
  ratingWorkload?: number | null;
  ratingOrganization?: number | null;
  ratingFun?: number | null;
  ratingComment?: string | null;
  shift?: {
    workArea?: {
      id?: number;
      name?: string;
      icon?: string;
    } | null;
  } | null;
}

/**
 * Ein Ton, kein Schweregrad: Nicht jede Erkenntnis ist ein Problem.
 * `warnung` - hier lief etwas schief.
 * `chance`  - hier ist Luft, die woanders fehlt.
 * `lob`     - das hat funktioniert und soll so bleiben.
 */
export type EmpfehlungsTon = 'warnung' | 'chance' | 'lob';

export interface Empfehlung {
  ton: EmpfehlungsTon;
  text: string;
}

export interface WorkAreaFeedbackAggregation {
  workAreaName: string;
  workAreaIcon: string;
  totalRatings: number;
  avgWorkload: number | null;
  avgOrganization: number | null;
  avgFun: number | null;
  /** Was aus den Werten fuer die naechste Planung folgt. */
  empfehlungen: Empfehlung[];
  comments: { id: number; comment: string; workAreaName: string }[];
}

/**
 * Ab wann ein Wert eine Empfehlung ausloest.
 *
 * Die Stress-Schwellen sind dieselben, nach denen die Anzeige "Hoch" bzw.
 * "Ruhig" ausweist - sonst widerspraeche der Hinweis der Zeile darueber.
 * Bei Organisation und Spass ist 3 die neutrale Mitte der Skala von 1 bis 5;
 * 2,5 liegt klar darunter und heisst "mehrheitlich unzufrieden", nicht
 * "durchwachsen".
 */
export const SCHWELLEN = {
  stressHoch: 4.0,
  stressNiedrig: 1.8,
  deutlichSchwach: 2.5,
  richtigGut: 4.5
} as const;

/**
 * Was ein Arbeitsbereich fuer die naechste Planung bedeutet.
 *
 * Bewusst Handlungsempfehlung statt Bewertung - die Zahlen stehen schon
 * daneben, hier geht es um das, was man daraus macht. Mehrere Hinweise
 * gleichzeitig sind moeglich: Ein Bereich kann zugleich ueberlastet und
 * schlecht eingewiesen sein, und daraus folgen zwei verschiedene Dinge.
 */
export function empfehlungenFuer(agg: {
  avgWorkload: number | null;
  avgOrganization: number | null;
  avgFun: number | null;
}): Empfehlung[] {
  const liste: Empfehlung[] = [];
  const { avgWorkload: stress, avgOrganization: orga, avgFun: spass } = agg;

  if (stress !== null && stress >= SCHWELLEN.stressHoch) {
    liste.push({
      ton: 'warnung',
      text: 'Hohe Arbeitsbelastung. Für künftige Turniere +1 Helfer oder kürzere Schichten prüfen.'
    });
  }
  if (stress !== null && stress <= SCHWELLEN.stressNiedrig) {
    liste.push({
      ton: 'chance',
      text: 'Hier war wenig zu tun. Ein Helfer weniger reicht vermutlich – und wird anderswo gebraucht.'
    });
  }
  if (orga !== null && orga <= SCHWELLEN.deutlichSchwach) {
    liste.push({
      ton: 'warnung',
      text: 'Die Einweisung kam nicht an. Eine feste Ansprechperson und eine kurze Übergabe zu '
        + 'Schichtbeginn helfen hier mehr als ein zusätzlicher Helfer.'
    });
  }
  if (spass !== null && spass <= SCHWELLEN.deutlichSchwach) {
    liste.push({
      ton: 'warnung',
      // Schlechte Stimmung ist selten die Ursache, meist die Folge. Der Hinweis
      // schickt deshalb zu den beiden anderen Werten desselben Bereichs.
      text: 'Gedrückte Stimmung. Das ist meist eine Folge – schau auf Stress und Organisation '
        + 'in diesem Bereich, dort liegt in der Regel der Grund.'
    });
  }
  // Was gut lief, zaehlt fuer die Planung genauso wie das, was nicht lief -
  // sonst wird beim naechsten Mal ausgerechnet daran geschraubt.
  if (
    liste.length === 0
    && spass !== null && spass >= SCHWELLEN.richtigGut
    && (orga === null || orga >= SCHWELLEN.richtigGut)
  ) {
    liste.push({
      ton: 'lob',
      text: 'Lief rund. Besetzung und Zuschnitt dieses Bereichs beim nächsten Turnier so lassen.'
    });
  }

  return liste;
}

/** Gueltig ist 1 bis 5 - alles andere zaehlt nicht mit. */
function istStufe(wert: number | null | undefined): wert is number {
  return wert != null && wert >= 1 && wert <= 5;
}

/**
 * Fasst das Helfer-Feedback je Arbeitsbereich zusammen.
 *
 * Jede Dimension zaehlt ihre Werte getrennt: Wer nur "Stress" bewertet und die
 * anderen beiden Fragen ueberspringt, darf den Schnitt von "Spass" nicht
 * verschieben. Deshalb wird erst summiert und am Ende geteilt - eine laufende
 * Mittelung mit einem gemeinsamen Zaehler ueber alle drei Dimensionen ergibt
 * bei unvollstaendig ausgefuellten Boegen falsche Werte.
 *
 * `totalRatings` bleibt die Anzahl der Bewertungen mit mindestens einer Angabe:
 * das ist die Zahl, die die Auswertung als "N Bewertungen" ausweist.
 */
export function aggregateFeedbackByWorkArea(feedbacks: FeedbackItem[]): Record<string, WorkAreaFeedbackAggregation> {
  const result: Record<string, WorkAreaFeedbackAggregation> = {};
  /** Summe und Anzahl je Bereich und Dimension - getrennt gefuehrt. */
  const summen: Record<string, {
    workload: { summe: number; anzahl: number };
    organization: { summe: number; anzahl: number };
    fun: { summe: number; anzahl: number };
  }> = {};

  for (const item of feedbacks) {
    const areaName = item.shift?.workArea?.name || 'Allgemein';
    const areaIcon = item.shift?.workArea?.icon || '📍';

    if (!result[areaName]) {
      result[areaName] = {
        workAreaName: areaName,
        workAreaIcon: areaIcon,
        totalRatings: 0,
        avgWorkload: null,
        avgOrganization: null,
        avgFun: null,
        empfehlungen: [],
        comments: []
      };
      summen[areaName] = {
        workload: { summe: 0, anzahl: 0 },
        organization: { summe: 0, anzahl: 0 },
        fun: { summe: 0, anzahl: 0 }
      };
    }

    const agg = result[areaName];
    const summe = summen[areaName];

    if (istStufe(item.ratingWorkload)) {
      summe.workload.summe += item.ratingWorkload;
      summe.workload.anzahl += 1;
    }
    if (istStufe(item.ratingOrganization)) {
      summe.organization.summe += item.ratingOrganization;
      summe.organization.anzahl += 1;
    }
    if (istStufe(item.ratingFun)) {
      summe.fun.summe += item.ratingFun;
      summe.fun.anzahl += 1;
    }

    if (item.ratingWorkload != null || item.ratingOrganization != null || item.ratingFun != null) {
      agg.totalRatings += 1;
    }

    if (item.ratingComment && item.ratingComment.trim().length > 0) {
      agg.comments.push({
        id: item.id,
        comment: item.ratingComment.trim(),
        workAreaName: areaName
      });
    }
  }

  /** Schnitt auf eine Nachkommastelle - ohne Werte bleibt es null. */
  const schnitt = ({ summe, anzahl }: { summe: number; anzahl: number }) =>
    anzahl === 0 ? null : Math.round((summe / anzahl) * 10) / 10;

  for (const key in result) {
    result[key].avgWorkload = schnitt(summen[key].workload);
    result[key].avgOrganization = schnitt(summen[key].organization);
    result[key].avgFun = schnitt(summen[key].fun);
    // Erst jetzt, wo die Schnitte feststehen - vorher waeren sie sinnlos.
    result[key].empfehlungen = empfehlungenFuer(result[key]);
  }

  return result;
}
