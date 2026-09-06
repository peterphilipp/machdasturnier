import { Router } from 'express';
import { requireAdmin, authenticate } from '../middleware/auth.js';
import { getVersandauftraege, abbrechenVersandauftrag } from '../controllers/versandauftrag.controller.js';

const router = Router();

router.get('/', authenticate, requireAdmin, getVersandauftraege);
router.post('/:id/abbrechen', authenticate, requireAdmin, abbrechenVersandauftrag);

export default router;
