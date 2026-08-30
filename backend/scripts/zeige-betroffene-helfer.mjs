/**
 * Read-only Diagnose: Welche eingeplanten Helfer tragen eine andere Zeit als
 * ihre Schicht?
 *
 * Hintergrund: `volunteer_shifts.slot` ist eine Kopie der Schichtzeit zum
 * Zeitpunkt der Einplanung. Wurde die Schicht spaeter verschoben, blieb diese
 * Kopie stehen - die Jahrgangs-Uebersicht zeigt dann die alte Zeit.
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
    vs.id                                   AS vsId,
    vs.slot                                 AS gespeichert,
    vs.role                                 AS rolle,
    u.name                                  AS helfer,
    twa.name                                AS bereich,
    td.date                                 AS tag,
    s.id                                    AS shiftId,
    COALESCE(s.start_min, ds.start_min)     AS startMin,
    COALESCE(s.end_min,   ds.end_min)       AS endMin
  FROM volunteer_shifts vs
  JOIN shifts s                       ON s.id   = vs.shift_id
  LEFT JOIN day_slots ds              ON ds.id  = s.day_slot_id
  LEFT JOIN tournament_work_areas twa ON twa.id = s.tournament_work_area_id
  LEFT JOIN tournament_days td        ON td.id  = s.tournament_day_id
  LEFT JOIN users u                   ON u.id   = vs.user_id
  ORDER BY td.date, twa.name, u.name
`;

/** Minuten seit Mitternacht -> "HH:MM". */
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Zeitspanne auf reine Ziffern reduzieren, damit "07:45 - 11:00" und
 *  "07:45-11:00" nicht als Abweichung durchgehen. */
const normalisiere = (s) => String(s ?? '').replace(/[\s–—]/g, (c) => (c === ' ' ? '' : '-'));

const tagKurz = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : 'ohne Datum');

const rows = await prisma.$queryRawUnsafe(SQL);

const echteAbweichung = [];
const nurFormat = [];
let ohneZeit = 0;

for (const r of rows) {
  if (r.startMin == null || r.endMin == null) { ohneZeit++; continue; }
  const soll = `${hhmm(Number(r.startMin))}-${hhmm(Number(r.endMin))}`;
  if (r.gespeichert === soll) continue;
  (normalisiere(r.gespeichert) === normalisiere(soll) ? nurFormat : echteAbweichung)
    .push({ ...r, soll });
}

console.log(`\nGeprueft: ${rows.length} Helfer-Einplanungen mit Schichtbezug`);
if (ohneZeit) console.log(`Uebersprungen (Schicht ohne Zeit): ${ohneZeit}`);

if (echteAbweichung.length === 0) {
  console.log('\nKeine Zeitabweichungen gefunden - die angezeigten Zeiten stimmen.\n');
} else {
  // Nach Person gruppieren: der Verein schreibt Menschen an, nicht Datensaetze.
  const proPerson = new Map();
  for (const r of echteAbweichung) {
    const key = r.helfer ?? '(kein Nutzer verknuepft)';
    if (!proPerson.has(key)) proPerson.set(key, []);
    proPerson.get(key).push(r);
  }

  console.log(`\nBETROFFEN: ${proPerson.size} Personen, ${echteAbweichung.length} Einplanungen\n`);
  console.log('='.repeat(78));

  for (const [name, eintraege] of [...proPerson.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    console.log(`\n${name}`);
    for (const e of eintraege) {
      console.log(`   ${tagKurz(e.tag)}  ${e.bereich ?? e.rolle}`);
      console.log(`      angezeigt (falsch): ${e.gespeichert}`);
      console.log(`      Schicht steht auf:  ${e.soll}`);
    }
  }
  console.log('\n' + '='.repeat(78));
}

if (nurFormat.length) {
  console.log(`\nHinweis: ${nurFormat.length} Eintraege weichen nur in der Schreibweise ab `
    + `(gleiche Uhrzeit) - fuer die Helfer irrelevant.`);
}

console.log('');
await prisma.$disconnect();
