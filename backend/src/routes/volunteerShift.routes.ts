import { Router } from 'express';
import validate from '../middleware/validate.js';
import {
  getVolunteerShifts,
  createVolunteerShift,
  updateVolunteerShift,
  deleteVolunteerShift,
  getFeedback,
  getStatistik,
  volunteerShiftSchema
} from '../controllers/volunteerShift.controller.js';
import { requireAdmin, authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/feedback', authenticate, requireAdmin, getFeedback);
router.get('/statistik', authenticate, requireAdmin, getStatistik);
router.get('/', getVolunteerShifts);
router.post('/', authenticate, requireAdmin, validate(volunteerShiftSchema), createVolunteerShift);
router.patch('/:id', authenticate, requireAdmin, validate(volunteerShiftSchema.partial()), updateVolunteerShift);
router.delete('/:id', authenticate, requireAdmin, deleteVolunteerShift);

export default router;
