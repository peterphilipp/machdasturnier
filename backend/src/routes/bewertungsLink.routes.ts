import { Router } from 'express';
import validate from '../middleware/validate.js';
import { bewertungsLinkLimiter } from '../middleware/security.js';
import {
  getBewertungsKontext,
  bewerteMitLink,
  bewertungsLinkSchema
} from '../controllers/bewertungsLink.controller.js';

/**
 * Bewerten ueber den Link aus der Mail.
 *
 * Bewusst OHNE authenticate: Der Empfaenger einer Mail ist nicht angemeldet -
 * das ist der ganze Zweck. Die Berechtigung traegt das signierte Token, siehe
 * utils/bewertungsLink.ts. Ein Ratenlimit steht davor, weil der Endpunkt
 * offen im Netz haengt.
 */
const router = Router();

router.get('/kontext', bewertungsLinkLimiter, getBewertungsKontext);
router.post('/', bewertungsLinkLimiter, validate(bewertungsLinkSchema), bewerteMitLink);

export default router;
