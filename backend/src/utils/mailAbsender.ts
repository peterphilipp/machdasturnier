/**
 * Der Absender fuer alle ausgehenden Mails.
 *
 * Lag bisher in password.routes.ts, weil dort die einzige Mail entstand. Mit
 * dem Nachrichten-Versand gibt es eine zweite Stelle - und zwei Kopien
 * derselben Pruefung waeren zwei Orte, an denen man eine kaputte
 * Konfiguration reparieren muss.
 */

/**
 * Von Resend geforderte Absender-Formate: `email@example.com` oder
 * `Name <email@example.com>`. EMAIL_FROM kommt aus der Server-Umgebung (z.B.
 * einer systemd/Quadlet Environment=-Zeile) - ein dort fehlerhaft gequotetes
 * oder am Leerzeichen abgeschnittenes Value wuerde sonst erst als kryptischer
 * Resend-422-Fehler beim Versand auffallen, statt klar benannt im Log.
 */
const FROM_ADDRESS_REGEX = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>)$/;
const DEFAULT_EMAIL_FROM = 'Macht das Turnier! <noreply@mygate.dedyn.io>';

export function resolveEmailFrom(): string {
  const configured = process.env.EMAIL_FROM;
  if (!configured) return DEFAULT_EMAIL_FROM;
  if (FROM_ADDRESS_REGEX.test(configured.trim())) return configured.trim();

  console.error(JSON.stringify({
    event: 'EMAIL_FROM_INVALID_FORMAT',
    configuredValue: configured,
    fallback: DEFAULT_EMAIL_FROM,
    timestamp: new Date().toISOString()
  }));
  return DEFAULT_EMAIL_FROM;
}

/**
 * Basis-URL fuers Frontend (Links und Bilder in Mails). Der Dev-Default
 * (localhost:5173) ist absichtlich NICHT produktionstauglich - fehlt
 * FRONTEND_URL in der Server-Umgebung (z.B. weil die Quadlet/systemd-Unit sie
 * nicht setzt), landet der Link sonst kommentarlos auf localhost statt auf der
 * echten Domain. Ein klar benannter Log-Eintrag macht das sofort auffindbar,
 * statt erst durch einen kaputten Link beim Nutzer entdeckt zu werden.
 *
 * Fuer Bilder in Mails ist die echte Adresse nicht Bequemlichkeit, sondern
 * Notwendigkeit: Die Logos liegen als `data:`-URL in der Datenbank, und Gmail
 * rendert `data:`-Bilder in Mails nicht.
 */
export function resolveFrontendUrl(): string {
  const configured = process.env.FRONTEND_URL;
  if (configured) return configured.replace(/\/+$/, '');

  console.error(JSON.stringify({
    event: 'FRONTEND_URL_NOT_CONFIGURED',
    fallback: 'http://localhost:5173',
    hint: 'FRONTEND_URL ist in dieser Umgebung nicht gesetzt - Links (z.B. Passwort-Reset) und Bilder in Mails zeigen auf den Dev-Fallback statt auf die echte Domain.',
    timestamp: new Date().toISOString()
  }));
  return 'http://localhost:5173';
}
