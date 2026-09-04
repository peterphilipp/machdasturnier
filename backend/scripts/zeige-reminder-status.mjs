/**
 * Read-only Diagnose: Warum kam (k)ein Schicht-Reminder?
 *
 * Der Scheduler rechnet den Schichtbeginn aus `shifts.start_min` und dem
 * Kalendertag aus. Zwei Dinge koennen dabei schiefgehen:
 *
 *  1. `shifts.start_min` ist NULL. Dann erbt die Schicht ihre Zeit vom
 *     Zeitfenster des Tages (`day_slots`) - der Scheduler kennt diesen
 *     Rueckfall aber nicht und ueberspringt die Schicht kommentarlos.
 *     Ergebnis: gar kein Reminder.
 *
 *  2. Die Uhrzeit wird als UTC gelesen, obwohl sie deutsche Ortszeit ist.
 *     Im Sommer sind das zwei Stunden Versatz - der Reminder geht dann
 *     ungefaehr zum Schichtbeginn raus statt zwei Stunden davor.
 *
 * Dieses Script AENDERT NICHTS. Es liest nur und gibt eine Liste aus.
 *
 * Bewusst reines SQL ueber $queryRawUnsafe: so haengt es nicht am generierten
 * Prisma-Client-Stand und laeuft auch in einem Container mit aelterem Code.
 */
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

const SQL = `
  SELECT
    vs.id                    AS vsId,
    u.name                   AS helfer,
    twa.name                 AS bereich,
    td.date                  AS tagRoh,
    s.start_min              AS shiftStart,
    ds.start_min             AS slotStart,
    s.end_min                AS shiftEnde,
    ds.end_min               AS slotEnde,
    vs.slot                  AS gespeichert,
    vs.reminder_sent_before  AS reminderRaus,
    vs.thanks_sent_after     AS dankeRaus,
    vs.user_id               AS userId
  FROM volunteer_shifts vs
  JOIN shifts s                       ON s.id   = vs.shift_id
  LEFT JOIN day_slots ds              ON ds.id  = s.day_slot_id
  LEFT JOIN tournament_work_areas twa ON twa.id = s.tournament_work_area_id
  LEFT JOIN tournament_days td        ON td.id  = s.tournament_day_id
  LEFT JOIN users u                   ON u.id   = vs.user_id
  ORDER BY td.date, COALESCE(s.start_min, ds.start_min), u.name
`;

/** Minuten seit Mitternacht -> "HH:MM". */
const hhmm = (m) => m == null ? '  ?  '
  : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Nur der Kalendertag, so wie der Scheduler ihn liest (UTC). */
const tagUTC = (d) => new Date(d).toISOString().slice(0, 10);

/** Der Zeitpunkt, den der Scheduler heute berechnet: Ortszeit faelschlich als UTC. */
function schedulerZeitpunkt(datum, minuten) {
  const d = new Date(datum);
  return new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Math.floor(minuten / 60), minuten % 60, 0
  ));
}

/** Der Zeitpunkt, den er berechnen muesste: HH:MM als Europe/Berlin. */
function echterZeitpunkt(datum, minuten) {
  const d = new Date(datum);
  const naiv = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Math.floor(minuten / 60), minuten % 60, 0
  );
  const offset = (zeitpunkt) => {
    const teile = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(zeitpunkt).map(p => [p.type, p.value]));
    const alsUTC = Date.UTC(+teile.year, +teile.month - 1, +teile.day,
      +teile.hour % 24, +teile.minute, +teile.second);
    return alsUTC - zeitpunkt.getTime();
  };
  // Zweistufig, weil der Versatz selbst vom Ergebnis abhaengt (Sommerzeit).
  const ersteSchaetzung = naiv - offset(new Date(naiv));
  return new Date(naiv - offset(new Date(ersteSchaetzung)));
}

const berlin = (d) => d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });

async function main() {
  const zeilen = await prisma.$queryRawUnsafe(SQL);
  const jetzt = new Date();

  console.log(`\nJetzt: ${berlin(jetzt)} (Ortszeit) / ${jetzt.toISOString()} (UTC)\n`);
  console.log(`${zeilen.length} eingeplante Helfer-Schichten.\n`);

  let ohneStartMin = 0;
  let versetzt = 0;

  for (const z of zeilen) {
    const start = z.shiftStart ?? z.slotStart;
    if (start == null) continue;

    const fehltStartMin = z.shiftStart == null;
    if (fehltStartMin) ohneStartMin++;

    const soll = echterZeitpunkt(z.tagRoh, start);
    const ist = schedulerZeitpunkt(z.tagRoh, start);
    const versatzMin = Math.round((ist.getTime() - soll.getTime()) / 60000);
    if (versatzMin !== 0) versetzt++;

    const marker = fehltStartMin ? '!! KEIN REMINDER' : versatzMin !== 0 ? `~~ ${versatzMin} Min zu spaet` : 'ok';

    console.log(
      `#${String(z.vsId).padEnd(5)} ${String(z.helfer ?? '?').padEnd(24)}`
      + ` ${String(z.bereich ?? '?').padEnd(18)}`
      + ` ${tagUTC(z.tagRoh)} ${hhmm(start)}`
      + ` | start_min=${z.shiftStart ?? 'NULL'} slot=${z.slotStart ?? 'NULL'}`
      + ` | erinnert=${z.reminderRaus ? 'ja' : 'nein'} danke=${z.dankeRaus ? 'ja' : 'nein'}`
      + ` | ${marker}`
    );
  }

  console.log(`\n--- Zusammenfassung ---`);
  console.log(`Schichten ohne eigenes start_min (Zeit kommt vom Tages-Zeitfenster): ${ohneStartMin}`);
  console.log(`  -> fuer diese sendet der Scheduler ueberhaupt keinen Reminder.`);
  console.log(`Schichten mit Zeitversatz durch die UTC-Rechnung: ${versetzt}`);
  console.log(`  -> fuer diese geht der Reminder um den Versatz zu spaet raus.`);

  // Der Rohwert des Kalendertags ist der dritte Kandidat: steht dort nicht
  // Mitternacht UTC, rechnet der Scheduler mit dem falschen Tag.
  const tage = [...new Set(zeilen.map(z => new Date(z.tagRoh).toISOString()))].sort();
  console.log(`\nKalendertage roh, so wie sie in der DB stehen:`);
  for (const t of tage) console.log(`  ${t}${t.endsWith('T00:00:00.000Z') ? '' : '   <-- nicht Mitternacht UTC!'}`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
