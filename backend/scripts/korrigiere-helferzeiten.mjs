/**
 * Zieht die gespeicherten Helfer-Zeiten wieder auf die Zeiten ihrer Schicht nach.
 *
 * Hintergrund: `volunteer_shifts.slot` ist eine Kopie der Schichtzeit zum
 * Zeitpunkt der Einplanung. Wurde die Schicht spaeter verschoben, blieb diese
 * Kopie stehen - die Jahrgangs-Uebersicht zeigt dann die alte Zeit an, obwohl
 * die Schicht laengst woanders liegt.
 *
 * Aufruf (im Container, Arbeitsverzeichnis /app):
 *   node scripts/korrigiere-helferzeiten.mjs               Trockenlauf (Standard)
 *   node scripts/korrigiere-helferzeiten.mjs --apply       Zeiten korrigieren
 *   node scripts/korrigiere-helferzeiten.mjs --apply --auch-datum
 *
 * Das Script verschickt KEINE Benachrichtigungen - wer informiert wird, bleibt
 * eine bewusste Entscheidung und keine Nebenwirkung einer Datenreparatur.
 *
 * Gelesen wird per Raw-SQL (haengt damit nicht am generierten Client-Stand und
 * laeuft auch in einem Container mit aelterem Code), geschrieben ueber den
 * Prisma-Client (der kennt das korrekte Speicherformat fuer DateTime).
 */
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

const ANWENDEN = process.argv.includes('--apply');
const AUCH_DATUM = process.argv.includes('--auch-datum');

/** Minuten seit Mitternacht -> "HH:MM". */
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Zeitspanne auf Ziffern reduzieren, damit "07:45 - 11:00" und "07:45-11:00"
 *  nicht als inhaltliche Abweichung durchgehen. */
const norm = (s) => String(s ?? '').replace(/\s/g, '').replace(/[–—]/g, '-');

const tagKurz = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : 'ohne Datum');

/** Kalendertag in UTC - genau die Sicht, die auch der Reminder im Scheduler hat. */
const utcTag = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const SQL = `
  SELECT
    vs.id                               AS vsId,
    vs.slot                             AS ist,
    vs.role                             AS rolle,
    vs.date                             AS vsDatum,
    u.name                              AS helfer,
    twa.name                            AS bereich,
    td.date                             AS schichtDatum,
    COALESCE(s.start_min, ds.start_min) AS startMin,
    COALESCE(s.end_min,   ds.end_min)   AS endMin
  FROM volunteer_shifts vs
  JOIN shifts s                       ON s.id   = vs.shift_id
  LEFT JOIN day_slots ds              ON ds.id  = s.day_slot_id
  LEFT JOIN tournament_work_areas twa ON twa.id = s.tournament_work_area_id
  LEFT JOIN tournament_days td        ON td.id  = s.tournament_day_id
  LEFT JOIN users u                   ON u.id   = vs.user_id
  ORDER BY td.date, twa.name, u.name
`;

const zeilen = await prisma.$queryRawUnsafe(SQL);

const zeitAbweichung = [];   // andere Uhrzeit - das eigentliche Problem
const formatAbweichung = []; // gleiche Uhrzeit, andere Schreibweise
const datumAbweichung = [];  // Eintrag haengt an einem anderen Kalendertag
let ohneZeit = 0;

for (const z of zeilen) {
  if (z.startMin == null || z.endMin == null) { ohneZeit++; continue; }

  const soll = `${hhmm(Number(z.startMin))}-${hhmm(Number(z.endMin))}`;
  if (z.ist !== soll) {
    (norm(z.ist) === norm(soll) ? formatAbweichung : zeitAbweichung).push({ ...z, soll });
  }

  const tagVs = utcTag(z.vsDatum);
  const tagSchicht = utcTag(z.schichtDatum);
  if (tagVs && tagSchicht && tagVs !== tagSchicht) {
    datumAbweichung.push({ ...z, tagVs, tagSchicht });
  }
}

console.log(`\n${ANWENDEN ? 'KORREKTURLAUF' : 'TROCKENLAUF - es wird nichts geaendert'}`);
console.log('='.repeat(72));
console.log(`Geprueft: ${zeilen.length} Einplanungen mit Schichtbezug`
  + (ohneZeit ? ` (${ohneZeit} ohne Zeitangabe uebersprungen)` : ''));

// --- Zeiten -------------------------------------------------------------
if (zeitAbweichung.length === 0) {
  console.log('\nZeiten: keine Abweichung.');
} else {
  const personen = new Set(zeitAbweichung.map((z) => z.helfer ?? '(kein Nutzer)'));
  console.log(`\nZeiten: ${zeitAbweichung.length} Eintraege bei ${personen.size} Personen\n`);
  for (const z of zeitAbweichung) {
    const wer = (z.helfer ?? '(kein Nutzer)').padEnd(26);
    console.log(`  ${wer} ${tagKurz(z.schichtDatum)} ${(z.bereich ?? z.rolle ?? '').padEnd(15)} ${z.ist}  ->  ${z.soll}`);
  }
}

if (formatAbweichung.length) {
  console.log(`\nSchreibweise: ${formatAbweichung.length} Eintraege mit gleicher Uhrzeit, `
    + `aber abweichender Notation (werden mit vereinheitlicht).`);
}

// --- Datum --------------------------------------------------------------
// Der Reminder im Scheduler baut den Schichtbeginn aus vs.date + shift.startMin
// zusammen. Ein abweichender Tag laesst ihn am falschen Tag feuern - deshalb
// wird das hier gemeldet, aber nur auf ausdrueckliche Anforderung geaendert.
if (datumAbweichung.length) {
  console.log(`\nACHTUNG - ${datumAbweichung.length} Eintraege haengen an einem anderen Kalendertag `
    + `als ihre Schicht:\n`);
  for (const z of datumAbweichung) {
    console.log(`  ${(z.helfer ?? '(kein Nutzer)').padEnd(26)} Eintrag ${z.tagVs}  <->  Schicht ${z.tagSchicht}`);
  }
  if (!AUCH_DATUM) {
    console.log('\n  Wird NICHT angefasst. Mit --auch-datum zusaetzlich mitkorrigieren.');
  }
} else {
  console.log('\nDatum: alle Eintraege liegen am Tag ihrer Schicht.');
}

// --- Schreiben ----------------------------------------------------------
const zuKorrigieren = [...zeitAbweichung, ...formatAbweichung];
const datumZuKorrigieren = AUCH_DATUM ? datumAbweichung : [];

if (zuKorrigieren.length === 0 && datumZuKorrigieren.length === 0) {
  console.log('\nNichts zu tun.\n');
  await prisma.$disconnect();
  process.exit(0);
}

if (!ANWENDEN) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`Wuerde ${zuKorrigieren.length} Zeit-Eintraege`
    + (datumZuKorrigieren.length ? ` und ${datumZuKorrigieren.length} Datumsangaben` : '')
    + ' korrigieren.');
  console.log('Es wurde nichts geschrieben. Zum Ausfuehren: --apply\n');
  await prisma.$disconnect();
  process.exit(0);
}

// Alles oder nichts: ein Teilzustand waere schlimmer als der jetzige, weil
// dann niemand mehr weiss, welche Zeiten stimmen.
const ergebnis = await prisma.$transaction(async (tx) => {
  let zeiten = 0;
  let daten = 0;

  for (const z of zuKorrigieren) {
    await tx.volunteerShift.update({ where: { id: Number(z.vsId) }, data: { slot: z.soll } });
    zeiten++;
  }

  for (const z of datumZuKorrigieren) {
    await tx.volunteerShift.update({
      where: { id: Number(z.vsId) },
      data: { date: new Date(z.schichtDatum) }
    });
    daten++;
  }

  return { zeiten, daten };
});

console.log(`\n${'='.repeat(72)}`);
console.log(`Korrigiert: ${ergebnis.zeiten} Zeit-Eintraege`
  + (ergebnis.daten ? `, ${ergebnis.daten} Datumsangaben` : '') + '.');
console.log('Es wurden keine Benachrichtigungen verschickt.\n');

await prisma.$disconnect();
