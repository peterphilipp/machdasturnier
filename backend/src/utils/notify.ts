import prisma from '../config/prisma.js';
import { sendPushToUser } from './push.js';
import { ermittleMarke, sendeEinzelmail } from './mailVersand.js';
import { baueBenachrichtigungsMail } from './transaktionsMail.js';

/**
 * Benachrichtigt einen Nutzer ueber DREI Kanaele gleichzeitig.
 *
 * Push allein reicht nicht: die App wird selten installiert und
 * Benachrichtigungen noch seltener erlaubt, eine Aenderung am Dienstplan
 * wuerde damit an den meisten Helfern vorbeigehen. Deshalb wird jede Meldung
 * zusaetzlich dauerhaft abgelegt und beim naechsten Oeffnen der App oben
 * angezeigt, bis sie bestaetigt wird - und zusaetzlich per Mail verschickt,
 * wenn der Nutzer das erlaubt hat (mailBenachrichtigungen, Default an) und
 * eine Adresse hinterlegt ist. Mail ist der Kanal mit der weitaus groessten
 * Reichweite - Push erreicht nur, wer die App installiert und
 * Benachrichtigungen erlaubt hat.
 *
 * Bewusst fehlertolerant: schlaegt ein Kanal fehl (abgelaufenes Push-Abo,
 * Mailversand nicht erreichbar), bleiben die anderen und die gespeicherte
 * Nachricht trotzdem bestehen. Und ein Fehler beim Benachrichtigen darf nie
 * die eigentliche Aenderung am Dienstplan scheitern lassen.
 */
/** Wer die Nachricht liest und wie sie ihn betrifft - direkt oder stellvertretend. */
export interface Empfaengerkontext {
  /** true, wenn die Nachricht nicht dem Betroffenen selbst zugestellt wird,
   *  sondern dessen Kontaktperson (Helfer ohne App-Zugang). */
  vertretend: boolean;
  /** Name des tatsaechlich betroffenen Helfers - bei vertretend=false identisch
   *  mit dem Empfaenger, bei vertretend=true die Person ohne App-Zugang. */
  name: string;
}

export async function notifyUser(
  userId: number,
  title: string,
  // Funktion statt fertigem Text: "Du wurdest eingeplant" ist falsch, wenn die
  // Nachricht tatsaechlich bei der Kontaktperson landet - der Aufrufer muss
  // beide Faelle sprachlich auseinanderhalten, nicht nur einen Namen davorsetzen.
  formuliere: (kontext: Empfaengerkontext) => string,
  url: string = '/',
  /**
   * Fuer die Mail-Gestaltung (Vereinslogo, -farbe) - sonst nichts. Ohne
   * Turnierbezug faellt ermittleMarke() auf eine allgemeine Gestaltung
   * zurueck; das ist kein Fehler, nur weniger persoenlich.
   */
  tournamentId: number | null = null
): Promise<void> {
  // Helfer ohne App-Zugang koennen die Nachricht nicht empfangen: kein Konto
  // zum Anmelden, keine E-Mail, kein Push. Sie an ihr eigenes Konto zu
  // schicken hiesse, sie ins Leere zu schicken - eine verschobene Schicht
  // erreichte niemanden. Deshalb geht sie an die hinterlegte Kontaktperson,
  // in der Regel ein Elternteil.
  const empfaenger = await ermittleEmpfaenger(userId);
  if (empfaenger === null) return;
  const vertretend = empfaenger.userId !== userId;
  const zielUserId = empfaenger.userId;
  const body = formuliere({ vertretend, name: empfaenger.fuerName });
  const stellvertretendFuer = vertretend ? empfaenger.fuerName : null;

  try {
    await prisma.userNotification.create({ data: { userId: zielUserId, title, body, url, stellvertretendFuer } });
  } catch (err) {
    console.error('[Notify] In-App-Nachricht konnte nicht gespeichert werden:', (err as Error).message);
  }
  // Eine Betriebssystem-Benachrichtigung kann kein Badge einblenden, nur
  // Text - deshalb bekommt hier der Titel den Namen vorangestellt. Der
  // gespeicherte Titel (oben) bleibt sauber, weil die App das "fuer wen"
  // separat und deutlicher als Badge zeigt. Die Mail hat dasselbe Problem wie
  // Push: Der Betreff ist, was man in der Inbox-Liste sieht, BEVOR man
  // oeffnet - er bekommt deshalb dieselbe Behandlung.
  const titelMitVertretung = stellvertretendFuer ? `Für ${stellvertretendFuer}: ${title}` : title;

  try {
    await sendPushToUser(zielUserId, titelMitVertretung, body, url);
  } catch {
    // Push ist nur der Zusatzkanal - die gespeicherte Nachricht traegt.
  }
  await benachrichtigePerMail(zielUserId, titelMitVertretung, body, url, tournamentId);
}

/**
 * Der Mailkanal derselben Benachrichtigung - eigene Funktion, damit ein
 * Fehler hier (fehlende Adresse, RESEND_API_KEY nicht gesetzt, Resend nicht
 * erreichbar) niemals durch bis zu notifyUser() durchschlaegt.
 */
async function benachrichtigePerMail(
  userId: number,
  title: string,
  body: string,
  url: string,
  tournamentId: number | null
): Promise<void> {
  try {
    const nutzer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, mailBenachrichtigungen: true }
    });
    if (!nutzer?.mailBenachrichtigungen || !nutzer.email?.trim()) return;

    const marke = await ermittleMarke(tournamentId);
    const mail = baueBenachrichtigungsMail(title, body, url, marke);
    await sendeEinzelmail({ id: userId, email: nutzer.email }, mail);
  } catch (err) {
    console.error('[Notify] Mail konnte nicht verschickt werden:', (err as Error).message);
  }
}

/** Mehrere Nutzer auf einmal, ohne dass ein Fehler die anderen verhindert. */
export async function notifyUsers(
  userIds: number[],
  title: string,
  formuliere: (kontext: Empfaengerkontext) => string,
  url: string = '/',
  tournamentId: number | null = null
): Promise<void> {
  const eindeutig = Array.from(new Set(userIds.filter((id): id is number => id != null)));
  await Promise.all(eindeutig.map(id => notifyUser(id, title, formuliere, url, tournamentId)));
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
