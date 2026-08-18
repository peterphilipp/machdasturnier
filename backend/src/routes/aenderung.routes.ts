import { Router } from 'express';
import prisma from '../config/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

/**
 * Der sichtbare Verlauf ("wer hat wann was geaendert").
 *
 * Nur fuer Admins und Organisatoren: Die Eintraege nennen Namen, das geht
 * Helfer nichts an.
 *
 * Blaetternd ueber `vor` (Id des letzten gezeigten Eintrags) statt ueber einen
 * Offset. Waehrend man blaettert, kommen laufend neue Eintraege oben dazu - mit
 * Offset wuerde man dadurch Eintraege doppelt sehen oder ueberspringen.
 */
const router = Router();

router.get('/', authenticate, requireAdmin, async (req, res) => {
  const tournamentId = req.query.tournamentId ? Number(req.query.tournamentId) : null;
  if (!tournamentId) return res.status(400).json({ error: 'tournamentId erforderlich' });

  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const vor = req.query.vor ? Number(req.query.vor) : null;
  const art = typeof req.query.art === 'string' && req.query.art ? req.query.art : null;
  const userId = req.query.userId ? Number(req.query.userId) : null;

  const eintraege = await prisma.aenderung.findMany({
    where: {
      tournamentId,
      ...(art ? { art } : {}),
      ...(userId ? { userId } : {}),
      ...(vor ? { id: { lt: vor } } : {})
    },
    orderBy: { id: 'desc' },
    take: limit + 1
  });

  const gibtMehr = eintraege.length > limit;
  return res.json({
    eintraege: eintraege.slice(0, limit),
    gibtMehr,
    // Wer war ueberhaupt beteiligt? Fuer die Filterleiste, damit dort nur
    // Personen stehen, die in diesem Turnier tatsaechlich etwas geaendert haben.
    beteiligte: await prisma.aenderung.groupBy({
      by: ['userId', 'userName'],
      where: { tournamentId },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } }
    }).then(rows => rows.map(r => ({ userId: r.userId, name: r.userName, anzahl: r._count._all })))
  });
});

export default router;
