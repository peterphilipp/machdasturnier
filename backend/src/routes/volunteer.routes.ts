import { Router } from 'express';
import validate from '../middleware/validate.js';
import { requireAdmin, requireAdminOnly, authenticate } from '../middleware/auth.js';
import { broadcastLimiter } from '../middleware/security.js';
import {
  getVolunteers,
  createVolunteer,
  deleteVolunteer,
  updateVolunteer,
  updateVolunteerPassword,
  broadcastPush,
  getMailVorlagen,
  volunteerSchema,
  updateVolunteerPasswordSchema,
  broadcastPushSchema
} from '../controllers/volunteer.controller.js';

const router = Router();

// Admin/Organizer: Helfer-Liste. Organisatoren dürfen sie nur turniergebunden
// abfragen (?tournamentId=..., z.B. für Push-Targeting im eigenen Turnier) -
// die vollständige, turnierübergreifende Liste (kein tournamentId) prüft der
// Controller selbst zusätzlich auf ADMIN, siehe getVolunteers().
router.get('/', authenticate, requireAdmin, getVolunteers);

// Nur Admin/Organizer: Push Broadcast (bewusst turniergebunden, siehe oben)
router.post('/push-broadcast', authenticate, requireAdmin, broadcastLimiter, validate(broadcastPushSchema), broadcastPush);

// Die Mail-Vorlagen fuer den Nachrichten-Dialog. Nur lesend, aber hinter
// requireAdmin: Es sind die Formulierungen, mit denen der Verein angeschrieben
// wird - kein Geheimnis, aber auch nichts, was nach draussen gehoert.
router.get('/mail-vorlagen', authenticate, requireAdmin, getMailVorlagen);

// Benutzerverwaltung (anlegen/bearbeiten/löschen/Passwort setzen): nur Admin -
// betrifft immer den ganzen Account, nicht nur den Kontext eines Turniers.
router.post('/', authenticate, requireAdminOnly, validate(volunteerSchema), createVolunteer);
router.patch('/:id', authenticate, requireAdminOnly, validate(volunteerSchema.partial()), updateVolunteer);
router.patch('/:id/password', authenticate, requireAdminOnly, validate(updateVolunteerPasswordSchema), updateVolunteerPassword);
router.delete('/:id', authenticate, requireAdminOnly, deleteVolunteer);

export default router;
