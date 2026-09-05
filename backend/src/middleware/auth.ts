import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import JWT_SECRET from '../config/jwt.js';
import { Role, hasAdminAccess, isAdmin, highestRole } from '../utils/roles.js';
import { getUserRoles } from '../utils/userRoles.js';
import { merkeNutzung } from '../utils/nutzung.js';

export interface AuthRequest extends Request {
  userId?: number;
  /** Alle Rollen des Nutzers - maßgeblich für Berechtigungsprüfungen. */
  roles?: Role[];
  /** Höchste Stufe als Einzelwert, nur noch für Altcode. */
  role?: string;
}

/**
 * Aktualisiert lastActivityAt bei jedem authentifizierten Request (Lesen wie
 * Schreiben) - im Unterschied zu lastLoginAt, das nur beim eigentlichen
 * Login/Registrierung gesetzt wird. Ein Write pro Request wäre unnötige DB-
 * Last, daher pro User auf einen Tick pro ACTIVITY_THROTTLE_MS begrenzt;
 * bewusst "fire-and-forget", damit ein DB-Fehler hier nie den eigentlichen
 * Request blockiert oder scheitern lässt.
 */
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;
const lastActivityWrite = new Map<number, number>();

function touchActivity(userId: number): void {
  // Der Tagesvermerk hat seine eigene, taegliche Sparsamkeit und darf deshalb
  // nicht hinter dieser 5-Minuten-Drosselung stehen: Wer genau einmal am Tag
  // kurz hereinschaut, wuerde sonst je nach Zufall gezaehlt oder nicht.
  merkeNutzung(userId);

  const now = Date.now();
  const last = lastActivityWrite.get(userId);
  if (last && now - last < ACTIVITY_THROTTLE_MS) return;
  lastActivityWrite.set(userId, now);
  prisma.user.update({ where: { id: userId }, data: { lastActivityAt: new Date() } }).catch(() => {});
}

/**
 * Rollen immer aus der Datenbank laden, nie aus dem Token.
 *
 * Die Tokens laufen 90 Tage; eine Rechteänderung würde sonst erst nach der
 * nächsten Anmeldung greifen - beim Entzug von Rechten wäre das ein
 * Sicherheitsproblem.
 */
async function loadRoles(userId: number): Promise<Role[]> {
  return getUserRoles(userId);
}

/** Middleware: Prüft gültiges Token und hängt User-Daten an req */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht authentifiziert' });
    return;
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    
    req.userId = decoded.userId;
    touchActivity(decoded.userId);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

/** Middleware: Prüft gültiges Token + Rolle */
export function requireRole(requiredRoles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Nicht authentifiziert' });
      return;
    }

    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
      
      req.userId = decoded.userId;
      touchActivity(decoded.userId);

      const roles = await loadRoles(decoded.userId);
      req.roles = roles;
      req.role = highestRole(roles);

      // Admin/Organizer haben immer Zugriff auf alles
      if (hasAdminAccess(roles)) {
        next();
        return;
      }

      // Sonst muss mindestens eine der geforderten Rollen vorhanden sein
      if (!requiredRoles.some(r => roles.includes(r as Role))) {
        res.status(403).json({ error: 'Unzureichende Berechtigungen' });
        return;
      }

      next();
    } catch {
      res.status(401).json({ error: 'Ungültiger Token' });
    }
  };
}

/**
 * Prüft Token, hängt userId/roles an req an. Gibt die Rollen zurück, oder null
 * wenn bereits eine 401-Antwort gesendet wurde (Aufrufer muss dann sofort
 * zurückkehren, ohne weiter zu antworten).
 */
async function authenticateAndGetRoles(req: AuthRequest, res: Response): Promise<Role[] | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht authentifiziert' });
    return null;
  }

  let decoded: { userId: number };
  try {
    const token = authHeader.split(' ')[1];
    decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
    return null;
  }

  req.userId = decoded.userId;
  touchActivity(decoded.userId);
  const roles = await loadRoles(decoded.userId);
  req.roles = roles;
  req.role = highestRole(roles);
  return roles;
}

/** Middleware: Admin/Organizer Only */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const roles = await authenticateAndGetRoles(req, res);
    if (roles === null) return;
    if (hasAdminAccess(roles)) {
      next();
    } else {
      res.status(403).json({ error: 'Unzureichende Berechtigungen – Admin oder Organisator erforderlich' });
    }
  } catch (err) {
    // DB-Fehler nicht verschlucken → an zentralen Error-Handler weiterreichen
    next(err);
  }
}

/**
 * Middleware: NUR Admin (kein Organizer). Für turnierübergreifende Verwaltung,
 * die Organisatoren nichts angeht (z.B. die vollständige, nicht turnier-
 * gebundene Benutzerverwaltung) - im Unterschied zu requireAdmin, das
 * Organisatoren bewusst für ihre eigenen, turniergebundenen Aufgaben
 * (z.B. Push an Helfer ihres Turniers) weiterhin durchlässt.
 */
export async function requireAdminOnly(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const roles = await authenticateAndGetRoles(req, res);
    if (roles === null) return;
    if (isAdmin(roles)) {
      next();
    } else {
      res.status(403).json({ error: 'Unzureichende Berechtigungen – nur Administratoren' });
    }
  } catch (err) {
    next(err);
  }
}
