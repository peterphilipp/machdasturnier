import prisma from '../config/prisma.js';
import { tagOrtszeit } from './zonenzeit.js';

/**
 * Haelt fest, an welchen Tagen die App benutzt wurde.
 *
 * `users.lastActivityAt` wird bei jedem Mal ueberschrieben und beantwortet
 * damit nur "wann zuletzt". Die Frage, wie eine App in den Wochen vor einem
 * Turnier angenommen wird, braucht dagegen eine Reihe ueber die Zeit - und die
 * laesst sich nicht nachtraeglich herstellen. Deshalb wird sie ab jetzt
 * mitgeschrieben.
 *
 * Sparsam: eine Zeile je Nutzer und Tag, nicht je Klick. Und wie bei der
 * bestehenden Drosselung in der Auth-Middleware wird die Datenbank gar nicht
 * erst gefragt, wenn dieser Prozess denselben Nutzer heute schon vermerkt hat.
 * Nach einem Neustart passiert es einmal erneut - das faengt der Upsert ab.
 */

/** `${userId}:${tag}`, was dieser Prozess heute schon geschrieben hat. */
const heuteVermerkt = new Set<string>();

/** Beim Tageswechsel aufraeumen, damit die Menge nicht ewig waechst. */
let mengeVomTag = tagOrtszeit();

function schluessel(userId: number, tag: string): string {
  if (tag !== mengeVomTag) {
    heuteVermerkt.clear();
    mengeVomTag = tag;
  }
  return `${userId}:${tag}`;
}

/**
 * Vermerkt: Dieser Nutzer hat die App heute benutzt.
 *
 * Bewusst "fire and forget" wie die Aktivitaetsspalte daneben - eine Statistik
 * darf niemals einen Request scheitern lassen.
 */
export function merkeNutzung(userId: number): void {
  const tag = tagOrtszeit();
  const k = schluessel(userId, tag);
  if (heuteVermerkt.has(k)) return;
  heuteVermerkt.add(k);
  schreibe(userId, tag, false).catch(() => { heuteVermerkt.delete(k); });
}

/**
 * Vermerkt eine echte Anmeldung.
 *
 * Getrennt von der blossen Nutzung, weil beides verschiedene Fragen
 * beantwortet: Anmeldungen zeigen, wer neu oder wieder hereinkommt, Nutzung
 * zeigt, wer ueberhaupt da ist. Bei 90 Tage langen Sitzungen sind das sehr
 * unterschiedliche Zahlen - die meisten Nutzungstage haben keine Anmeldung.
 */
export function merkeAnmeldung(userId: number): void {
  const tag = tagOrtszeit();
  // Eine Anmeldung zaehlt immer, auch die zweite am selben Tag - deshalb hier
  // keine Abkuerzung ueber die Merkliste.
  heuteVermerkt.add(schluessel(userId, tag));
  schreibe(userId, tag, true).catch(() => {});
}

async function schreibe(userId: number, tag: string, anmeldung: boolean): Promise<void> {
  const jetzt = new Date();
  await prisma.nutzungTag.upsert({
    where: { userId_tag: { userId, tag } },
    create: {
      userId, tag,
      ersteAktion: jetzt,
      letzteAktion: jetzt,
      anmeldungen: anmeldung ? 1 : 0
    },
    update: {
      letzteAktion: jetzt,
      ...(anmeldung ? { anmeldungen: { increment: 1 } } : {})
    }
  });
}
