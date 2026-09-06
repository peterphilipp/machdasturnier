/**
 * Welche Umgebung hier laeuft.
 *
 * Lag bisher inline in environment.routes.ts, weil die Oberflaeche die
 * einzige Abnehmerin war. Mit dem Mailversand gibt es eine zweite - und eine
 * Testumgebung, die sich in der App als Test ausweist, aber Mails wie die
 * Produktion verschickt, waere schlimmer als keine Kennzeichnung: Der
 * Empfaenger sieht die Mail ohne jeden Hinweis, dass sie aus einer Spielwiese
 * kommt.
 *
 * Bewusst ohne Standardwert "test": Fehlt APP_ENV, verhaelt sich alles wie
 * bisher. Eine vergessene Variable macht die Testumgebung damit still - ein
 * faelschlich als Test markiertes Produktivsystem waere aber schlimmer, weil
 * es alle Nutzer verunsichern und zum Wegklicken erziehen wuerde.
 */
export interface Umgebung {
  istTest: boolean;
  /** "Testumgebung" oder "Staging", sonst null. */
  bezeichnung: string | null;
  /** Ziel des "Zur echten App"-Knopfes, falls konfiguriert. */
  produktivUrl: string | null;
}

export function ermittleUmgebung(): Umgebung {
  const wert = (process.env.APP_ENV || '').trim().toLowerCase();
  const istTest = wert === 'test' || wert === 'staging';

  return {
    istTest,
    bezeichnung: istTest ? (wert === 'staging' ? 'Staging' : 'Testumgebung') : null,
    produktivUrl: istTest ? (process.env.PRODUCTION_URL || '').trim() || null : null
  };
}
