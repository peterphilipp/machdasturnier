/**
 * Uhrzeiten im Dienstplan sind deutsche Ortszeit - Zeitpunkte im Server sind UTC.
 *
 * Eine Schicht "16:00" heisst 16:00 in Holm. Im Sommer sind das 14:00 UTC, im
 * Winter 15:00 UTC. Wer `Date.UTC(..., 16, 0)` rechnet, bekommt einen
 * Zeitpunkt, der um genau diesen Versatz danebenliegt - und ein Reminder, der
 * zwei Stunden vorher rausgehen soll, geht dann ungefaehr zum Schichtbeginn
 * raus. Auf dem Server faellt das nicht auf, weil dort UTC laeuft und die Zahl
 * fuer sich genommen plausibel aussieht.
 *
 * Die Zone steht fest verdrahtet und wird nicht aus der Server-Umgebung
 * gelesen: Das Turnier findet in Holm statt, egal wo der Container laeuft.
 * Ein `TZ`-Environment im Deployment zu vergessen wuerde die Reminder sonst
 * still um Stunden verschieben.
 */

const ZONE = 'Europe/Berlin';

const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

/** Versatz der Zone zu UTC in Millisekunden, zum gegebenen Zeitpunkt. */
function versatzMs(zeitpunkt: Date): number {
  const teile = Object.fromEntries(
    FORMAT.formatToParts(zeitpunkt).map(p => [p.type, p.value])
  ) as Record<string, string>;

  const alsWaereEsUTC = Date.UTC(
    Number(teile.year),
    Number(teile.month) - 1,
    Number(teile.day),
    // Manche Umgebungen liefern bei Mitternacht "24" statt "00".
    Number(teile.hour) % 24,
    Number(teile.minute),
    Number(teile.second)
  );
  return alsWaereEsUTC - zeitpunkt.getTime();
}

/**
 * Der echte Zeitpunkt zu "an diesem Kalendertag um HH:MM Ortszeit".
 *
 * `datum` liefert nur den Kalendertag (gelesen in UTC, so wie die Tage
 * gespeichert sind); `minuten` sind Minuten seit Mitternacht Ortszeit.
 */
export function zeitpunktOrtszeit(datum: Date | string, minuten: number): Date {
  const d = new Date(datum);
  const naiv = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Math.floor(minuten / 60), minuten % 60, 0
  );

  // Zwei Durchgaenge, weil der Versatz selbst vom Ergebnis abhaengt: an den
  // Umstellungstagen liefert der erste Schaetzwert sonst die falsche Seite
  // der Zeitumstellung.
  const ersteSchaetzung = naiv - versatzMs(new Date(naiv));
  return new Date(naiv - versatzMs(new Date(ersteSchaetzung)));
}
