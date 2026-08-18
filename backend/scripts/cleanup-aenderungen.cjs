/**
 * Haelt den Aenderungsverlauf klein.
 *
 * Bei jeder Planungsaenderung entsteht ein Eintrag. Ueber mehrere Turniere und
 * Jahre summiert sich das in einer SQLite-Datei, die ohnehin bei jedem Start
 * komplett gesichert wird - unbegrenztes Wachstum wuerde also auch jedes
 * Backup aufblaehen.
 *
 * 90 Tage sind reichlich bemessen: Der Verlauf soll waehrend der Planung und
 * kurz nach dem Turnier Fragen beantworten ("wer hat die Schicht verschoben?"),
 * nicht als Archiv dienen.
 *
 * Idempotent - laeuft bei jedem Containerstart und loescht nur, was faellig ist.
 */
const { PrismaClient } = require('@prisma/client');

const TAGE = 90;

async function main() {
  const prisma = new PrismaClient();
  try {
    const grenze = new Date(Date.now() - TAGE * 24 * 60 * 60 * 1000);
    const weg = await prisma.aenderung.deleteMany({ where: { createdAt: { lt: grenze } } });
    const rest = await prisma.aenderung.count();
    console.log(`[cleanup-aenderungen] ${weg.count} Eintraege aelter als ${TAGE} Tage entfernt, ${rest} verbleiben.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
