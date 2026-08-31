/**
 * Übertraegt den einzelnen Wunsch-Arbeitsbereich eines Zeitangebots in die
 * neue Mehrfachauswahl.
 *
 * Vorher trug ShiftOffer genau ein `work_area_id`, jetzt haengen mehrere
 * Bereiche ueber eine Zuordnungstabelle daran. Das alte Feld bleibt vorerst
 * im Schema, damit "prisma db push" es nicht mitsamt Inhalt entfernt, bevor
 * dieses Skript die Werte gerettet hat.
 *
 * Laeuft bei jedem Start und ist wiederholbar: Angebote, die bereits eine
 * Zuordnung haben, werden uebersprungen.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Tabelle existiert erst nach dem Schema-Push; bei einem alten Stand
  // einfach nichts tun statt den Start zu blockieren.
  let angebote;
  try {
    angebote = await prisma.shiftOffer.findMany({
      where: { workAreaId: { not: null } },
      include: { workAreas: { select: { id: true } } }
    });
  } catch {
    console.log('  [shift-offer-areas] Tabelle noch nicht vorhanden - übersprungen.');
    return;
  }

  let uebertragen = 0;
  for (const angebot of angebote) {
    // Schon zugeordnet? Dann war das Skript hier bereits - nicht doppelt.
    if (angebot.workAreas.length > 0) continue;

    await prisma.shiftOffer.update({
      where: { id: angebot.id },
      data: { workAreas: { connect: { id: angebot.workAreaId } } }
    });
    uebertragen++;
  }

  if (uebertragen > 0) {
    console.log(`  [shift-offer-areas] ${uebertragen} Wunsch-Bereiche in die Mehrfachauswahl übertragen.`);
  }
}

main()
  .catch(err => {
    // Ein Fehler hier darf den Start nicht verhindern: die Angebote sind
    // Beiwerk, der Dienstplan ist es nicht.
    console.error('  [shift-offer-areas] übersprungen:', err.message);
  })
  .finally(() => prisma.$disconnect());
