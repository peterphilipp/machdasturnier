import { Router } from 'express';
import { ermittleUmgebung } from '../utils/umgebung.js';

/**
 * Auskunft darueber, WELCHE Umgebung hier laeuft.
 *
 * Test und Produktion laufen aus demselben Image; die Oberflaeche kann die
 * Unterscheidung also nicht beim Bauen mitbekommen, sondern muss sie zur
 * Laufzeit erfragen. Anlass war ein Helfer, dem jemand den Link zur
 * Testumgebung geschickt hatte: Er sah eine Anmeldemaske, die von der echten
 * nicht zu unterscheiden war, und probierte dort vergeblich sein richtiges
 * Passwort - bis hin zur 15-Minuten-Sperre.
 *
 * Bewusst OEFFENTLICH (keine Authentifizierung): Genau die Anmeldeseite, die
 * noch niemanden angemeldet hat, muss den Hinweis anzeigen koennen.
 *
 * Die Erkennung selbst liegt in utils/umgebung.ts - der Mailversand markiert
 * damit ebenfalls seine Nachrichten, und zwei Definitionen davon waeren zwei
 * Stellen, an denen eine Umgebung sich unterschiedlich ausweisen kann.
 */
const router = Router();

router.get('/', (_req, res) => res.json(ermittleUmgebung()));

export default router;
