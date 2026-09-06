import { Router } from 'express';
import { getClubLogo, getTournamentLogo } from '../controllers/logo.controller.js';

/**
 * Verein- und Turnierlogo als echtes Bild.
 *
 * Bewusst OHNE Authentifizierung: Der Abnehmer ist das Mailprogramm des
 * Empfaengers, und das laedt Bilder ohne Sitzung und ohne Token. Preisgegeben
 * wird nur das Vereinslogo - dasselbe, das auf jedem Aushang steht.
 * Siehe logo.controller.ts fuer den Grund, warum es diesen Umweg braucht
 * (Gmail rendert `data:`-Bilder in Mails nicht).
 */
const router = Router();

router.get('/club/:id', getClubLogo);
router.get('/tournament/:id', getTournamentLogo);

export default router;
