import { Router } from 'express';

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
 * Bewusst ohne Standardwert "test": Fehlt APP_ENV, verhaelt sich alles wie
 * bisher. Eine vergessene Variable macht die Testumgebung damit still - ein
 * faelschlich als Test markiertes Produktivsystem waere aber schlimmer, weil
 * es alle Nutzer verunsichern und zum Wegklicken erziehen wuerde.
 */
const router = Router();

router.get('/', (_req, res) => {
  const umgebung = (process.env.APP_ENV || '').trim().toLowerCase();
  const istTest = umgebung === 'test' || umgebung === 'staging';

  return res.json({
    istTest,
    bezeichnung: istTest ? (umgebung === 'staging' ? 'Staging' : 'Testumgebung') : null,
    // Ziel des "Zur echten App"-Knopfes. Ohne die Variable entfaellt der Knopf,
    // der Hinweis bleibt aber bestehen.
    produktivUrl: istTest ? (process.env.PRODUCTION_URL || '').trim() || null : null
  });
});

export default router;
