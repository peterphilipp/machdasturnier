import crypto from 'crypto';

/**
 * Signierte Links zum Bewerten aus der Mail heraus - ohne Anmeldung.
 *
 * Der Kompromiss ist bewusst so gewaehlt worden: Wer den Link hat, kann fuer
 * diese eine Schicht bewerten. Das ist eine schwaechere Zusicherung als eine
 * Anmeldung, und es ist die Entscheidung des Vereins - es geht um drei
 * Sternebewertungen zu einer Schicht, nicht um Bankgeschaefte. Ein
 * unbeantwortetes Bewertungsformular ist teurer als das Risiko, dass jemand
 * mit fremdem Link eine 4 statt einer 5 abgibt.
 *
 * Was der Link trotzdem leistet, weil es nichts kostet:
 *
 *  - **Signatur (HMAC).** Ohne sie liesse sich durch Hochzaehlen einer ID fuer
 *    beliebige Schichten bewerten. Mit ihr braucht man einen echten Link.
 *  - **Eigener Zweck im Signaturtext.** Ein Token von hier laesst sich
 *    nirgends sonst einsetzen, auch wenn dasselbe Geheimnis dahintersteht.
 *  - **Verfallsdatum.** Ein Link aus einer Mail von vor zwei Jahren soll
 *    nichts mehr schreiben koennen.
 *  - **Genau eine Schicht.** Das Token traegt die Schicht, nicht den Nutzer
 *    als Vollmacht - es oeffnet keine Sitzung und erlaubt nichts anderes.
 */

/** 60 Tage: lang genug fuer eine Mail, die liegen bleibt, kurz genug zum Ablaufen. */
const GUELTIG_TAGE = 60;

/** Trennt diese Signaturen von allen anderen Verwendungen desselben Geheimnisses. */
const ZWECK = 'bewertung.v1';

export interface BewertungsAnspruch {
  volunteerShiftId: number;
  userId: number;
}

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Das Geheimnis wird erst beim Aufruf gelesen, nicht beim Import.
 *
 * `config/jwt.ts` beendet den Prozess, wenn JWT_SECRET fehlt - richtig fuer
 * den Serverstart, aber ein Import davon macht diese Datei untestbar: Schon
 * das Laden der Testdatei wuerde den Testlauf abbrechen. Im laufenden Server
 * ist die Variable ohnehin garantiert, weil der Start sonst scheitert.
 */
function geheimnis(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET fehlt oder ist zu kurz - Bewertungslinks können nicht signiert werden.');
  }
  return s;
}

function signiere(nutzlast: string): string {
  return b64url(crypto.createHmac('sha256', `${ZWECK}:${geheimnis()}`).update(nutzlast).digest());
}

export function baueBewertungsToken(anspruch: BewertungsAnspruch, jetzt = new Date()): string {
  const gueltigBis = Math.floor(jetzt.getTime() / 1000) + GUELTIG_TAGE * 86400;
  const nutzlast = b64url(Buffer.from(JSON.stringify({
    v: anspruch.volunteerShiftId,
    u: anspruch.userId,
    e: gueltigBis
  })));
  return `${nutzlast}.${signiere(nutzlast)}`;
}

/**
 * Prueft ein Token und gibt zurueck, worauf es berechtigt.
 *
 * Null bei allem, was nicht stimmt - der Aufrufer soll nicht zwischen
 * "gefaelscht", "abgelaufen" und "Unsinn" unterscheiden muessen, und der
 * Nutzer bekommt in allen Faellen dieselbe Auskunft: Link nicht mehr gueltig.
 */
export function pruefeBewertungsToken(token: string, jetzt = new Date()): BewertungsAnspruch | null {
  if (typeof token !== 'string') return null;
  const teile = token.split('.');
  if (teile.length !== 2) return null;
  const [nutzlast, signatur] = teile;

  // Zeitkonstanter Vergleich: Ein zeichenweiser Abbruch verraet ueber die
  // Laufzeit, wie viele Zeichen schon stimmten.
  const erwartet = signiere(nutzlast);
  const a = Buffer.from(signatur);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const daten = JSON.parse(Buffer.from(nutzlast, 'base64url').toString('utf-8'));
    if (typeof daten?.v !== 'number' || typeof daten?.u !== 'number' || typeof daten?.e !== 'number') return null;
    if (daten.e * 1000 < jetzt.getTime()) return null;
    return { volunteerShiftId: daten.v, userId: daten.u };
  } catch {
    return null;
  }
}
