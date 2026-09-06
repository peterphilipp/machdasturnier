import { Request, Response } from 'express';
import prisma from '../config/prisma.js';

/**
 * Versandauftraege eines Turniers - fuer den Fortschrittsbalken im
 * Broadcast-Dialog (siehe PushBroadcast.tsx, pollt diese Route periodisch,
 * solange ein Auftrag laeuft).
 *
 * Zaehlt je Status ueber VersandauftragEmpfaenger, statt die Zeilen selbst
 * auszuliefern - bei ueber hundert Empfaengern waere das unnoetig viel fuer
 * eine reine Fortschrittsanzeige.
 */
export const getVersandauftraege = async (req: Request, res: Response) => {
  const tournamentId = parseInt(req.query.tournamentId as string, 10);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return res.status(400).json({ error: 'tournamentId ist erforderlich.' });
  }

  const auftraege = await prisma.versandauftrag.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, vorlage: true, betreff: true, status: true,
      createdAt: true, completedAt: true,
      empfaenger: { select: { status: true } }
    }
  });

  return res.json(auftraege.map(a => {
    const zaehler = { offen: 0, gesendet: 0, fehlgeschlagen: 0, uebersprungen: 0, abgebrochen: 0 };
    for (const e of a.empfaenger) {
      zaehler[e.status as keyof typeof zaehler] = (zaehler[e.status as keyof typeof zaehler] ?? 0) + 1;
    }
    return {
      id: a.id,
      vorlage: a.vorlage,
      betreff: a.betreff,
      status: a.status,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      gesamt: a.empfaenger.length,
      ...zaehler
    };
  }));
};

/**
 * Bricht einen laufenden Versandauftrag ab.
 *
 * Nur die noch OFFENEN Empfaenger werden umgeschaltet - was schon verschickt
 * oder uebersprungen wurde, bleibt als Protokoll stehen. Ein bereits
 * abgeschlossener oder schon abgebrochener Auftrag laesst sich nicht ein
 * zweites Mal abbrechen (idempotent, kein Fehler dabei).
 */
export const abbrechenVersandauftrag = async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Ungueltige Auftrags-ID.' });
  }

  const auftrag = await prisma.versandauftrag.findUnique({ where: { id }, select: { status: true } });
  if (!auftrag) return res.status(404).json({ error: 'Versandauftrag nicht gefunden.' });

  if (auftrag.status === 'laufend') {
    await prisma.$transaction([
      prisma.versandauftrag.update({ where: { id }, data: { status: 'abgebrochen', completedAt: new Date() } }),
      prisma.versandauftragEmpfaenger.updateMany({
        where: { auftragId: id, status: 'offen' },
        data: { status: 'abgebrochen' }
      })
    ]);
  }

  return res.json({ success: true });
};
