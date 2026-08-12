import { Request, Response } from 'express';
import prisma from '../config/prisma.js';
import { z } from 'zod';
import { notifyUser } from '../utils/notify.js';

export const volunteerShiftSchema = z.object({
  userId: z.union([z.number(), z.string()]).transform(Number),
  tournamentId: z.union([z.number(), z.string()]).transform(Number).optional().nullable(),
  shiftId: z.union([z.number(), z.string()]).transform(Number).optional().nullable(),
  date: z.string().datetime().or(z.date()),
  slot: z.string().min(1),
  role: z.string().min(1),
  areaId: z.string().optional().nullable()
});

export const getVolunteerShifts = async (req: Request, res: Response) => {
  const { tournamentId } = req.query;
  const where = tournamentId ? { tournamentId: parseInt(tournamentId as string) } : {};
  const shifts = await prisma.volunteerShift.findMany({
    where,
    orderBy: { date: 'asc' },
    include: {
      user: {
        include: { children: true, trainedYearGroups: true }
      }
    },
  });
  return res.json(shifts || []);
};

export const createVolunteerShift = async (req: Request, res: Response) => {
  const { userId, tournamentId, shiftId, date, slot, role, areaId } = req.body;
  const s = await prisma.volunteerShift.create({
    data: {
      userId: parseInt(userId as string),
      tournamentId: tournamentId ? parseInt(tournamentId as string) : null,
      shiftId: shiftId ? parseInt(shiftId as string) : null,
      date: new Date(date).toISOString(),
      slot, role, areaId: areaId || null,
    },
    include: { user: true }
  });

  if (s.userId) {
    await notifyUser(
      s.userId,
      'Schicht zugeteilt',
      `Du wurdest als ${s.role} (${s.slot}) eingeplant.`,
      '/'
    );
  }

  return res.status(201).json(s);
};

export const updateVolunteerShift = async (req: Request, res: Response) => {
  const body = req.body;
  const { slot, role, userId, areaId, date, shiftId } = body;
  const validDate = date ? new Date(date) : undefined;
  
  const vorher = await prisma.volunteerShift.findUnique({ where: { id: parseInt(req.params.id as string) } });

  const updated = await prisma.volunteerShift.update({
    where: { id: parseInt(req.params.id as string) },
    data: {
      slot: slot || body.slot,
      role: role || body.role,
      userId: userId ? parseInt(userId as string) : body.userId,
      shiftId: shiftId !== undefined ? (shiftId ? parseInt(shiftId as string) : null) : undefined,
      areaId: areaId || body.areaId,
      date: validDate ? validDate.toISOString() : undefined,
    },
    include: { user: true }
  });

  // Umplanen war bisher voellig stumm: wer auf eine andere Zeit oder Aufgabe
  // geschoben wurde, erfuhr es nirgends.
  if (vorher) {
    const zeitOderRolleGeaendert = vorher.slot !== updated.slot || vorher.role !== updated.role
      || new Date(vorher.date).getTime() !== new Date(updated.date).getTime();
    if (zeitOderRolleGeaendert && updated.userId) {
      await notifyUser(
        updated.userId,
        'Schicht geändert',
        `Deine Schicht wurde geändert: jetzt ${updated.role} (${updated.slot}).`,
        '/'
      );
    }
    // Auf eine andere Person umgetragen: die bisherige informieren.
    if (vorher.userId && updated.userId && vorher.userId !== updated.userId) {
      await notifyUser(
        vorher.userId,
        'Schicht entfallen',
        `Du bist für ${vorher.role} (${vorher.slot}) nicht mehr eingeplant.`,
        '/'
      );
    }
  }

  return res.json(updated);
};

export const deleteVolunteerShift = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const existing = await prisma.volunteerShift.findUnique({ where: { id } });
  await prisma.volunteerShift.delete({ where: { id } });
  
  if (existing && existing.userId) {
    await notifyUser(
      existing.userId,
      'Schicht entfallen',
      `Du wurdest aus der Schicht ${existing.role} (${existing.slot}) ausgeplant.`,
      '/'
    );
  }
  
  return res.status(204).send();
};

export const getFeedback = async (req: Request, res: Response) => {
  const { tournamentId } = req.query;
  const where: Record<string, unknown> = {};
  if (tournamentId) {
    where.tournamentId = parseInt(tournamentId as string, 10);
  }
  where.OR = [
    { ratingWorkload: { not: null } },
    { ratingOrganization: { not: null } },
    { ratingFun: { not: null } },
    { ratingComment: { not: null } }
  ];

  const feedbacks = await prisma.volunteerShift.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
      shift: { include: { workArea: true, daySlot: true, day: true } }
    }
  });

  return res.json(feedbacks || []);
};

