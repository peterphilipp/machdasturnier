import { Router } from 'express';
import validate from '../middleware/validate.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  createShiftOffer,
  getShiftOffers,
  getMyShiftOffers,
  entscheideShiftOffer,
  deleteShiftOffer,
  shiftOfferSchema,
  entscheidungSchema
} from '../controllers/shiftOffer.controller.js';

const router = Router();

// Anbieten und zurueckziehen darf jeder angemeldete Helfer - fuer sich selbst.
router.post('/', authenticate, validate(shiftOfferSchema), createShiftOffer);
router.get('/mine', authenticate, getMyShiftOffers);
router.delete('/:id', authenticate, deleteShiftOffer);

// Sehen und entscheiden ist Sache der Organisatoren.
router.get('/', requireAdmin, getShiftOffers);
router.patch('/:id/entscheidung', requireAdmin, validate(entscheidungSchema), entscheideShiftOffer);

export default router;
