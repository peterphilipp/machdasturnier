import prisma from '../config/prisma.js';
import { sendPushToUser } from './push.js';

/**
 * Benachrichtigt einen Nutzer ueber ZWEI Kanaele gleichzeitig.
 *
 * Push allein reicht nicht: die App wird selten installiert und
 * Benachrichtigungen noch seltener erlaubt, eine Aenderung am Dienstplan
 * wuerde damit an den meisten Helfern vorbeigehen. Deshalb wird jede Meldung
 * zusaetzlich dauerhaft abgelegt und beim naechsten Oeffnen der App oben
 * angezeigt, bis sie bestaetigt wird.
 *
 * Bewusst fehlertolerant: schlaegt der Push fehl (abgelaufenes Abo, kein
 * Geraet), bleibt die gespeicherte Nachricht trotzdem bestehen. Und ein
 * Fehler beim Benachrichtigen darf nie die eigentliche Aenderung am
 * Dienstplan scheitern lassen.
 */
export async function notifyUser(
  userId: number,
  title: string,
  body: string,
  url: string = '/'
): Promise<void> {
  // Helfer ohne App-Zugang koennen die Nachricht nicht empfangen: kein Konto
  // zum Anmelden, keine E-Mail, kein Push. Sie an ihr eigenes Konto zu
  // schicken hiesse, sie ins Leere zu schicken - eine verschobene Schicht
  // erreichte niemanden. Deshalb geht sie an die hinterlegte Kontaktperson,
  // in der Regel ein Elternteil, mit dem Namen im Text.
  const empfaenger = await ermittleEmpfaenger(userId);
  if (empfaenger === null) return;
  if (empfaenger.userId !== userId) {
    userId = empfaenger.userId;
    body = `${empfaenger.fuerName}: ${body}`;
  }

  try {
    await prisma.userNotification.create({ data: { userId, title, body, url } });
  } catch (err) {
    console.error('[Notify] In-App-Nachricht konnte nicht gespeichert werden:', (err as Error).message);
  }
  try {
    await sendPushToUser(userId, title, body, url);
  } catch {
    // Push ist nur der Zusatzkanal - die gespeicherte Nachricht traegt.
  }
}

/** Mehrere Nutzer auf einmal, ohne dass ein Fehler die anderen verhindert. */
export async function notifyUsers(
  userIds: number[],
  title: string,
  body: string,
  url: string = '/'
): Promise<void> {
  const eindeutig = Array.from(new Set(userIds.filter((id): id is number => id != null)));
  await Promise.all(eindeutig.map(id => notifyUser(id, title, body, url)));
}

/**
 * Wer bekommt die Nachricht tatsaechlich?
 *
 * Normalfall: der Helfer selbst. Bei einem Helfer ohne App-Zugang die
 * hinterlegte Kontaktperson - und wenn es keine gibt, niemand. Dann still zu
 * scheitern ist besser, als eine Nachricht in ein Konto zu legen, das nie
 * jemand oeffnet: So bleibt der Verlauf ehrlich, und im Log steht eine Zeile.
 */
async function ermittleEmpfaenger(userId: number): Promise<{ userId: number; fuerName: string } | null> {
  const nutzer = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, ohneZugang: true, kontaktpersonId: true }
  });
  if (!nutzer) return null;
  if (!nutzer.ohneZugang) return { userId, fuerName: nutzer.name };

  if (!nutzer.kontaktpersonId) {
    console.warn(`[Notify] ${nutzer.name} hat keinen App-Zugang und keine Kontaktperson - Nachricht entfaellt.`);
    return null;
  }
  return { userId: nutzer.kontaktpersonId, fuerName: nutzer.name };
}
