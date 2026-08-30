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

export interface WorkAreaFeedbackAggregation {
  workAreaName: string;
  workAreaIcon: string;
  totalRatings: number;
  avgWorkload: number | null;
  avgOrganization: number | null;
  avgFun: number | null;
  comments: { id: number; comment: string; workAreaName: string }[];
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
  }

  return result;
}
