import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { Resend } from 'resend';
import { logLoginSuccess, logLoginFailed, logPasswordResetRequested, logPasswordResetCompleted, logRegistrationCreated } from '../utils/logger.js';
import JWT_SECRET, { TOKEN_LIFETIME } from '../config/jwt.js';
import { authLimiter, pinResetLimiter } from '../middleware/security.js';
import { sendPushToUser } from '../utils/push.js';
import { formatPhoneNumber } from '../utils/phone.js';
import validate from '../middleware/validate.js';
import { ensureTournamentMembership } from '../utils/tournamentMembership.js';
import { merkeAnmeldung } from '../utils/nutzung.js';
import { resolveRolesAndForceAdmin, signSessionToken } from '../utils/authSession.js';
import { ROLES, highestRole, normalizeRoles } from '../utils/roles.js';
import { setUserRoles } from '../utils/userRoles.js';
import { findUserIdByIdentifier, findUserIdByName } from '../utils/findUserByIdentifier.js';
import { deleteUserAccount } from '../utils/accountDeletion.js';
import { sanitizeChildrenInput } from '../utils/sanitizeChildren.js';

function getClientIp(req: express.Request): string | undefined {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress;
}

const router = express.Router();

/**
 * Entfernt Geheimnisse aus einem User-Objekt, bevor es ausgeliefert wird.
 *
 * WICHTIG: `recoveryPin` ist ein vollwertiger Zweit-Credential (erlaubt via
 * POST /reset-by-pin das Setzen eines neuen Passworts) und darf NIE in
 * Standard-Antworten erscheinen. Einzige Ausnahme: die Registrierungs-Antwort,
 * die den PIN dem Nutzer genau einmal anzeigt (siehe unten, explizit ergänzt).
 */
function sanitizeUser<T extends { password?: string | null; recoveryPin?: string | null }>(
  user: T
): Omit<T, 'password' | 'recoveryPin'> {
  const { password, recoveryPin, ...safe } = user;
  return safe;
}

/**
 * Erzeugt einen Helfer-PIN mit crypto.randomBytes (NICHT Math.random(), das
 * kein CSPRNG ist und aus wenigen bekannten Ausgaben vorhersagbar wäre).
 * Alphabet ohne verwechselbare Zeichen (kein I/O/0/1). Rejection-Sampling,
 * damit alle Zeichen gleich wahrscheinlich sind (kein Modulo-Bias).
 */
const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 Zeichen
const PIN_LENGTH = 8; // 32^8 = 2^40 statt 2^30 bei 6 Zeichen

export function generateRecoveryPin(): string {
  let pin = '';
  while (pin.length < PIN_LENGTH) {
    for (const byte of crypto.randomBytes(PIN_LENGTH)) {
      if (pin.length >= PIN_LENGTH) break;
      // 256 ist durch 32 teilbar -> kein Bias, aber defensiv formuliert
      if (byte < 256 - (256 % PIN_ALPHABET.length)) {
        pin += PIN_ALPHABET[byte % PIN_ALPHABET.length];
      }
    }
  }
  return pin;
}

/** Erzeugt einen neuen PIN und gibt Klartext + bcrypt-Hash zurück. */
async function createPinPair(): Promise<{ plain: string; hash: string }> {
  const plain = generateRecoveryPin();
  return { plain, hash: await bcrypt.hash(plain, 10) };
}

/**
 * Dummy-Hash für konstantere Antwortzeiten: Wird verglichen, wenn kein Nutzer
 * gefunden wurde, damit "Name existiert nicht" und "PIN falsch" nicht über die
 * Laufzeit unterscheidbar sind.
 */
const DUMMY_BCRYPT_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

/**
 * Von Resend geforderte Absender-Formate: `email@example.com` oder
 * `Name <email@example.com>`. EMAIL_FROM kommt aus der Server-Umgebung (z.B.
 * einer systemd/Quadlet Environment=-Zeile) - ein dort fehlerhaft gequotetes
 * oder am Leerzeichen abgeschnittenes Value würde sonst erst als kryptischer
 * Resend-422-Fehler beim Versand auffallen, statt klar benannt im Log.
 */
const FROM_ADDRESS_REGEX = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>)$/;
const DEFAULT_EMAIL_FROM = 'Macht das Turnier! <noreply@mygate.dedyn.io>';

function resolveEmailFrom(): string {
  const configured = process.env.EMAIL_FROM;
  if (!configured) return DEFAULT_EMAIL_FROM;
  if (FROM_ADDRESS_REGEX.test(configured.trim())) return configured.trim();

  console.error(JSON.stringify({
    event: 'EMAIL_FROM_INVALID_FORMAT',
    configuredValue: configured,
    fallback: DEFAULT_EMAIL_FROM,
    timestamp: new Date().toISOString()
  }));
  return DEFAULT_EMAIL_FROM;
}

/**
 * Basis-URL fürs Frontend (Passwort-Reset-Links). Der Dev-Default
 * (localhost:5173) ist absichtlich NICHT produktionstauglich - fehlt
 * FRONTEND_URL in der Server-Umgebung (z.B. weil die Quadlet/systemd-Unit sie
 * nicht setzt), landet der Link sonst kommentarlos auf localhost statt auf der
 * echten Domain. Ein klar benannter Log-Eintrag macht das sofort auffindbar,
 * statt erst durch einen kaputten Link beim Nutzer entdeckt zu werden.
 */
function resolveFrontendUrl(): string {
  const configured = process.env.FRONTEND_URL;
  if (configured) return configured;

  console.error(JSON.stringify({
    event: 'FRONTEND_URL_NOT_CONFIGURED',
    fallback: 'http://localhost:5173',
    hint: 'FRONTEND_URL ist in dieser Umgebung nicht gesetzt - Links (z.B. Passwort-Reset) zeigen auf den Dev-Fallback statt auf die echte Domain.',
    timestamp: new Date().toISOString()
  }));
  return 'http://localhost:5173';
}

/**
 * Einheitliche Login-Fehlermeldung (verhindert User-Enumeration). Die genaue
 * Ursache landet nur im Server-Log, nicht in der HTTP-Antwort.
 */
const LOGIN_FAILED_MESSAGE = 'Anmeldung fehlgeschlagen. Bitte prüfe Name/E-Mail und Passwort.';

/**
 * Zod-Schemas: ergänzen nur Form-/Typ-/Format-Prüfungen (Längen-Caps gegen
 * Abuse, E-Mail-Format) VOR den Handlern. Die bestehende Auth-Logik, die
 * generischen/nicht-enumerierbaren Fehlermeldungen (LOGIN_FAILED_MESSAGE etc.),
 * Rate-Limiter und konstant-zeitigen bcrypt-Vergleiche bleiben unverändert -
 * die Handler behalten ihre eigenen (dadurch teils redundanten) Checks als
 * zweite Verteidigungslinie.
 *
 * Wichtig für /login: Das Passwort-Feld bleibt in der Zod-Prüfung absichtlich
 * optional/ohne Mindestlänge. Ein fehlendes Passwort muss weiterhin die
 * einheitliche 401-Antwort (LOGIN_FAILED_MESSAGE) durchlaufen und darf nicht
 * vorher als unterscheidbares 400 abgefangen werden - sonst würde die
 * User-Enumeration-Verschleierung durchbrochen.
 */
const childInputSchema = z.object({
  childName: z.string().trim().max(100).nullable().optional(),
  childYear: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return null;
      if (typeof val === 'number' && isNaN(val)) return null;
      const parsed = parseInt(String(val), 10);
      return isNaN(parsed) ? null : parsed;
    },
    z.number().int().min(1900).max(2100).nullable().optional()
  )
});

const emailInput = z.union([
  z.string().trim().max(255).email('Ungültige E-Mail'),
  z.literal('')
]).nullable();

const phoneInput = z.string().trim().max(50).nullable();

const loginSchema = z.object({
  name: z.string().trim().max(255).optional(),
  email: z.string().trim().max(255).optional(),
  password: z.string().max(200).optional()
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Email required').max(255).email('Ungültige E-Mail')
});

const forgotPasswordPushSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(255)
});

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben').max(200)
});

const resetByPinSchema = z.object({
  name: z.string().trim().min(1).max(255),
  recoveryPin: z.string().min(1).max(64),
  newPassword: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben').max(200)
});

const patchPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben').max(200)
});

const profileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: emailInput,
  phone: phoneInput,
  children: z.array(childInputSchema).max(20),
  consentGiven: z.boolean()
}).partial();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: emailInput.optional(),
  phone: phoneInput.optional(),
  password: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben').max(200),
  children: z.array(childInputSchema).max(20).optional(),
  consentGiven: z.boolean().optional()
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const ip = getClientIp(req);
    logPasswordResetRequested(email, ip);

    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) return res.json({ message: 'Wenn das Konto existiert, wurde ein Reset-Link gesendet.' });

    // Alte Tokens löschen
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    // Neuen Token generieren
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 Stunde

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt
      }
    });

    // E-Mail über Resend senden
    const resetUrl = `${resolveFrontendUrl()}/reset-password?token=${token}`;
    
    if (process.env.RESEND_API_KEY) {
      try {
        // Fester Absender aus der Umgebung: die eigentliche Domain (turnier-
        // planer.mygate.dedyn.io) ist bei Resend nicht verifiziert, Versand
        // funktioniert nur über die verifizierte Absenderadresse. Kein
        // Nutzer-Lookup mehr (ehem. Primary-Admin) - der Absender ist reine
        // Infrastruktur-Konfiguration, keine Personen-Eigenschaft.
        const emailFrom = resolveEmailFrom();

        const resend = new Resend(process.env.RESEND_API_KEY);
        const result = await resend.emails.send({
          from: emailFrom,
          to: user.email as string,
          subject: 'Passwort zurücksetzen',
          html: `
            <h2>Passwort zurücksetzen</h2>
            <p>Hallo ${user.name},</p>
            <p>Klicke auf den folgenden Link, um dein Passwort zurücksetzen:</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:8px;">Passwort zurücksetzen</a></p>
            <p>Der Link ist 1 Stunde gültig.</p>
            <p style="color:#999;font-size:12px;">Wenn du keine Passwortänderung angefordert hast, ignoriere diese E-Mail.</p>
          `
        });
        console.log(JSON.stringify({ 
          event: 'EMAIL_SENT', 
          to: user.email, 
          subject: 'Passwort zurücksetzen', 
          messageId: result.data?.id,
          timestamp: new Date().toISOString()
        }));
      } catch (emailErr) {
        console.error(JSON.stringify({ 
          event: 'EMAIL_FAILED', 
          to: user.email, 
          error: emailErr instanceof Error ? emailErr.message : String(emailErr),
          timestamp: new Date().toISOString()
        }));
      }
    } else {
      const masked = resetUrl.replace(/token=[^&]+/g, 'token=****');
      console.log(JSON.stringify({ 
        event: 'EMAIL_SKIPPED_NO_API_KEY', 
        to: user.email,
        masked_url: masked,
        timestamp: new Date().toISOString()
      }));
    }
    
    // Token im Log ausgeben (maskiert)
    const maskedToken = token.substring(0, 8) + '...';
    console.log(JSON.stringify({ 
      event: 'PASSWORD_RESET_TOKEN_GENERATED', 
      userId: user.id,
      email: user.email,
      masked_token: maskedToken,
      expires_at: expiresAt.toISOString(),
      timestamp: new Date().toISOString()
    }));

    res.json({ message: 'Wenn das Konto existiert, wurde ein Reset-Link gesendet.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        token,
        used: false,
        expiresAt: { gt: new Date() }
      },
      include: { user: true }
    });

    if (!resetToken || !resetToken.user) return res.status(400).json({ error: 'Ungültiger oder abgelaufener Token' });

    // Passwort hashen
    const hashed = await bcrypt.hash(newPassword, 10);

    // Passwort aktualisieren
    await prisma.user.update({
      where: { id: resetToken.userId as number },
      data: { password: hashed }
    });

    // Token als verwendet markieren
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true }
    });

    logPasswordResetCompleted(resetToken.userId as number, resetToken.user.name, getClientIp(req));
    res.json({ message: 'Passwort erfolgreich zurückgesetzt' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const identifier = email || name;

    if (!identifier) {
      return res.status(400).json({ error: 'Name oder E-Mail erforderlich' });
    }
    // Fehlendes Passwort früh abfangen: sonst würde bcrypt.compare(undefined, …)
    // werfen und der Error-Handler mit 500 antworten – das wäre selbst schon
    // ein Unterscheidungsmerkmal gegenüber einem korrekten 401.
    if (!password) {
      return res.status(401).json({ error: LOGIN_FAILED_MESSAGE });
    }

    const ip = getClientIp(req);
    // Name UND E-Mail ohne Ruecksicht auf Gross-/Kleinschreibung suchen.
    // Mobile Tastaturen schreiben den ersten Buchstaben automatisch gross;
    // vorher wurde der Name zeichengenau verglichen und die Anmeldung schlug
    // mit "Benutzer nicht gefunden" fehl.
    const gefundeneId = await findUserIdByIdentifier(identifier);
    const user = gefundeneId
      ? await prisma.user.findUnique({ where: { id: gefundeneId }, include: { children: true } })
      : null;

    // Einheitliche Antwort für "Konto existiert nicht" und "Passwort falsch".
    // Vorher verrieten die Meldungen ("Benutzer nicht gefunden" vs. "Falsches
    // Passwort"), ob ein Konto existiert – damit liess sich die komplette
    // Nutzerliste des Vereins abfragen und als Zielliste für Brute-Force gegen
    // /reset-by-pin nutzen. Zusätzlich wird immer ein bcrypt-Vergleich
    // ausgeführt (bei unbekanntem Konto gegen einen Dummy-Hash), damit auch die
    // Antwortzeit keinen Rückschluss erlaubt.
    const match = await bcrypt.compare(password, user?.password || DUMMY_BCRYPT_HASH);
    if (!user || !match) {
      logLoginFailed(identifier, user ? 'Falsches Passwort' : 'Benutzer nicht gefunden', getClientIp(req) || '');
      return res.status(401).json({ error: LOGIN_FAILED_MESSAGE });
    }

      logLoginSuccess(user.email || identifier, getClientIp(req));
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastActivityAt: new Date() } });
      merkeAnmeldung(user.id);

      const userRoles = await resolveRolesAndForceAdmin(user);
      const token = signSessionToken(user.id, userRoles);
      // Korrigierte Rollen ans Frontend geben (ADMIN_EMAILS kann ADMIN ergänzen)
      res.json({ token, user: sanitizeUser({ ...user, role: highestRole(userRoles), roles: userRoles }) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }
    res.json(sanitizeUser(user));
  } catch (err) {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
});

// GET /api/auth/export – Auskunft nach Art. 15 DSGVO
router.get('/export', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    } catch {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        children: true,
        shifts: {
          include: { shift: { include: { workArea: true, daySlot: true, tournament: true } } }
        },
        foodDonations: {
          include: { foodItem: true }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'Nicht gefunden' });

    // Keine sensiblen Daten exportieren (kein Passwort)
    const exportData = {
      exportedAt: new Date().toISOString(),
      appName: 'Macht das Turnier!',
      personalData: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        children: user.children.map(c => ({ childName: c.childName, childYear: c.childYear })),
      },
      shifts: ((user as unknown as Record<string, unknown>).shifts as Array<Record<string, any>>)?.map(s => ({
        date: s.date,
        slot: s.slot,
        role: s.role,
        arbeitsbereich: s.shift?.workArea?.name ?? null,
        zeitslot: s.shift?.daySlot ? `${s.shift.daySlot.name} (${s.shift.daySlot.startTime}-${s.shift.daySlot.endTime})` : null
      })) || [],
      donations: ((user as unknown as Record<string, unknown>).foodDonations as Array<Record<string, any>>)?.map(d => ({
        foodItem: d.foodItem?.name,
        quantity: d.quantity,
        note: d.note,
        createdAt: d.createdAt
      }))
    };

    res.json(exportData);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/password
router.patch('/password', validate(patchPasswordSchema), async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    } catch {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }
    
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Bitte alle Felder ausfuellen' });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.password) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { password: hashed }
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/account – Löschung nach Art. 17 DSGVO
router.delete('/account', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    } catch {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(404).json({ error: 'Nicht gefunden' });

    await deleteUserAccount(decoded.userId);

    res.json({ message: 'Dein Konto wurde erfolgreich gelöscht. Alle personenbezogenen Daten wurden entfernt.' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/profile
router.patch('/profile', validate(profileSchema), async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    } catch {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }

    const { name, email, phone, children, consentGiven } = req.body;

    const current = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!current) return res.status(404).json({ error: 'Nicht gefunden' });

    const updateData: Record<string, unknown> = {};
    if (phone !== undefined) updateData.phone = phone;

    // --- Name: normalisieren + Eindeutigkeit erzwingen ---
    // Ohne diese Prüfung könnte sich ein Nutzer auf den Namen eines Admins
    // umbenennen. Da der Login per OR über name/email sucht und findFirst nur
    // eine Zeile liefert, würde das den Admin aussperren und dessen
    // E-Mail-Reset kapern (Account-Confusion).
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) return res.status(400).json({ error: 'Name darf nicht leer sein' });
      if (cleanName !== current.name) {
        const taken = await prisma.user.findFirst({
          where: { name: cleanName, id: { not: decoded.userId } }
        });
        if (taken) return res.status(409).json({ error: 'Dieser Name ist bereits vergeben' });
      }
      updateData.name = cleanName;
    }

    // --- E-Mail: normalisieren, Eindeutigkeit, KEINE Admin-Adressen ---
    if (email !== undefined) {
      const cleanEmail = email ? String(email).trim().toLowerCase() : null;
      if (cleanEmail && cleanEmail !== (current.email || '').toLowerCase()) {
        const taken = await prisma.user.findFirst({
          where: { email: cleanEmail, id: { not: decoded.userId } }
        });
        if (taken) return res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' });

        // Rechteausweitung verhindern: Der Login promoviert Konten, deren E-Mail
        // in ADMIN_EMAILS steht, persistent zu ADMIN. Da die E-Mail hier NICHT
        // verifiziert wird, könnte sich sonst jeder Helfer selbst zum Admin
        // machen, indem er die Admin-Adresse einträgt und sich neu anmeldet.
        const adminEmails = process.env.ADMIN_EMAILS
          ? process.env.ADMIN_EMAILS.toLowerCase().split(',').map(e => e.trim()).filter(Boolean)
          : [];
        if (adminEmails.includes(cleanEmail)) {
          logLoginFailed(cleanEmail, 'Profil-Update auf Admin-Adresse abgelehnt', getClientIp(req) || '');
          return res.status(403).json({
            error: 'Diese E-Mail-Adresse kann nicht selbst gesetzt werden. Bitte wende dich an einen Administrator.'
          });
        }
      }
      updateData.email = cleanEmail;
    }

    if (consentGiven !== undefined) {
      updateData.consentGiven = consentGiven;
      updateData.consentDate = consentGiven ? new Date() : null;
    }

    // Kinder aktualisieren
    if (children && Array.isArray(children)) {
      // Alte Kinder löschen
      await prisma.userChild.deleteMany({ where: { userId: decoded.userId } });
      // Neue Kinder erstellen (nur valide, vollständige Einträge)
      const validChildren = sanitizeChildrenInput(children);
      if (validChildren.length > 0) {
        updateData.children = {
          create: validChildren
        };
      }
    }

    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: updateData,
      include: { children: true, userRoles: { select: { role: true } } }
    });

    // Rollen mitgeben: jede Antwort, aus der das Frontend seinen
    // zwischengespeicherten Nutzer neu aufbaut, muss sie enthalten - sonst
    // faellt der Client auf die alte Einzelspalte zurueck und verliert
    // Zusatzrollen wie TRAINER.
    const { userRoles, ...profil } = user;
    res.json({
      ...sanitizeUser(profil),
      roles: userRoles.length > 0 ? userRoles.map(r => r.role) : [user.role]
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register
router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { name: rawName, email: rawEmail, phone, password, children, consentGiven } = req.body;
    if (!rawName || !password) return res.status(400).json({ error: 'Fehlende Pflichtfelder (Name & Passwort)' });
    if (consentGiven !== true) return res.status(400).json({ error: 'Datenschutzerklrung muss akzeptiert werden' });
    // Serverseitige Passwort-Policy (das Frontend prüfte bisher als Einziges)
    if (String(password).length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });

    // Normalisieren: ohne trim/lowercase liessen sich die Eindeutigkeitsprüfungen
    // unten mit "Peter " oder "Peter@X.de" vs "peter@x.de" trivial umgehen.
    const name = String(rawName).trim();
    const email = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
    if (!name) return res.status(400).json({ error: 'Name darf nicht leer sein' });

    const users = await prisma.user.findMany({
      select: { name: true, email: true }
    });

    if (email) {
      const existingEmail = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
      if (existingEmail) return res.status(409).json({ error: 'Email wird bereits verwendet' });
    }

    const existingName = users.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (existingName) return res.status(409).json({ error: 'Dieser Name ist bereits vergeben. Bitte verwende einen Zusatz (z.B. "Peter M." oder "Peter (Trainer)").' });

    // Admin-Berechtigungen robuster machen
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.toLowerCase().split(',').map(e => e.trim()) : [];
    const isForcedAdmin = email ? adminEmails.includes(email.toLowerCase()) : false;

    // Aktives Turnier automatisch zuweisen
    const activeTournament = await prisma.tournament.findFirst({
      where: { status: 'aktiv' },
      orderBy: { startDate: 'desc' }
    });

    // Erster User bekommt automatisch ADMIN-Rechte. Zaehlung ueber die
    // Rollentabelle, nicht mehr ueber die alte Einzelspalte - sonst wuerde ein
    // Admin, der zusaetzlich Trainer ist, hier nicht mitgezaehlt.
    const adminCount = await prisma.userRole.count({ where: { role: ROLES.ADMIN } });
    const isFirstAdmin = adminCount === 0;

    // Recovery-PIN: nur nötig, wenn keine E-Mail hinterlegt ist - mit E-Mail
    // läuft die Passwort-Wiederherstellung über /forgot-password. Ein PIN, den
    // der Nutzer nie braucht, ist nur eine verwirrende Extra-Anzeige bei der
    // Registrierung und ein unnötiger zweiter Zugangsweg zum Account.
    const pin = email ? null : await createPinPair();

    const hashed = await bcrypt.hash(password, 10);
    let createData: import('@prisma/client').Prisma.UserUncheckedCreateInput = {
      name,
      email: email || null,
      phone: phone || null,
      password: hashed,
      recoveryPin: pin?.hash ?? null,
      role: (isFirstAdmin || isForcedAdmin) ? 'ADMIN' : 'HELPER',
      tournamentId: activeTournament?.id || null,
      consentGiven: true,
      consentDate: new Date(),
      // Registrierung zählt als erster Login - sonst sähe ein frisch
      // registrierter, noch nie "erneut" eingeloggter User in der
      // Benutzerliste sofort wie "noch nie angemeldet" aus.
      lastLoginAt: new Date(),
      lastActivityAt: new Date()
    };

    // Kinder erstellen (nur valide, vollständige Einträge)
    if (children && Array.isArray(children) && children.length > 0) {
      const validChildren = sanitizeChildrenInput(children);
      if (validChildren.length > 0) {
        createData.children = {
          create: validChildren
        };
      }
    }

    const ip = getClientIp(req);
    const user = await prisma.user.create({
      data: createData as import('@prisma/client').Prisma.UserCreateInput,
      include: { children: true }
    });
    await ensureTournamentMembership(user.id, activeTournament?.id);
    // Die Registrierung zaehlt als erste Anmeldung - wie bei lastLoginAt oben.
    merkeAnmeldung(user.id);

    // Rollen in die Zuordnungstabelle schreiben; setUserRoles spiegelt die
    // hoechste Stufe zurueck in users.role.
    const newRoles = await setUserRoles(user.id, normalizeRoles(user.role));

    logRegistrationCreated(user.name, user.email || '', ip);
    const token = signSessionToken(user.id, newRoles);
    // Einmalige Ausnahme: der PIN im KLARTEXT (nicht der DB-Hash!), damit das
    // Frontend ihn dem Nutzer direkt nach der Registrierung anzeigen kann.
    // Danach ist er nirgends mehr abrufbar – in der DB liegt nur der Hash.
    // Ohne PIN (E-Mail-Fall) taucht das Feld im Response gar nicht erst auf,
    // statt mit `undefined`/`null` befüllt zu sein - das Frontend prüft nur
    // `data.user?.recoveryPin` und würde sonst ohnehin korrekt keinen PIN-
    // Screen zeigen, aber so bleibt die Absicht im Objekt selbst sichtbar.
    const responseUser = pin ? { ...sanitizeUser(user), recoveryPin: pin.plain } : sanitizeUser(user);
    res.status(201).json({ token, user: responseUser });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-by-pin
router.post('/reset-by-pin', pinResetLimiter, validate(resetByPinSchema), async (req, res, next) => {
  try {
    const { name, recoveryPin, newPassword } = req.body;
    if (!name || !recoveryPin || !newPassword) return res.status(400).json({ error: 'Name, PIN und neues Passwort erforderlich' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });

    // Der PIN liegt nur als bcrypt-Hash vor -> Nutzer über den Namen suchen und
    // den PIN vergleichen. `recoveryPin: { not: null }` schließt Konten ohne PIN
    // (z.B. vom Admin angelegte) explizit aus.
    // Namenssuche ebenfalls unabhaengig von der Schreibweise - sonst waere
    // fuer Nutzer ohne E-Mail auch dieser Rettungsweg verschlossen.
    const pinUserId = await findUserIdByName(name);
    const user = pinUserId
      ? await prisma.user.findFirst({ where: { id: pinUserId, recoveryPin: { not: null } } })
      : null;

    // Immer einen bcrypt-Vergleich durchführen (bei unbekanntem Namen gegen einen
    // Dummy-Hash), damit "Name existiert nicht" und "PIN falsch" nicht über die
    // Antwortzeit unterscheidbar sind.
    const pinOk = await bcrypt.compare(String(recoveryPin), user?.recoveryPin || DUMMY_BCRYPT_HASH);
    if (!user || !pinOk) {
      logLoginFailed(String(name), 'Ungültiger Recovery-PIN', getClientIp(req) || '');
      return res.status(401).json({ error: 'Ungültiger Name oder PIN' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    // PIN nach Verwendung rotieren: ein einmal (etwa aus einem alten Backup oder
    // einer früheren API-Antwort) bekannter PIN darf nicht dauerhaft als
    // Nachschlüssel funktionieren. Der neue PIN wird einmalig zurückgegeben.
    const nextPin = await createPinPair();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashed, recoveryPin: nextPin.hash }
      });
      // Offene E-Mail-Reset-Tokens entwerten (analog zu POST /reset-password)
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    });

    logPasswordResetCompleted(user.id, user.name, getClientIp(req));
    res.json({
      message: 'Passwort erfolgreich zurückgesetzt',
      recoveryPin: nextPin.plain,
      pinRotated: true
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password-push
router.post('/forgot-password-push', authLimiter, validate(forgotPasswordPushSchema), async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    // Einheitliche Antwort für alle drei Fälle (Konto unbekannt / kein Gerät /
    // Push gesendet). Vorher liessen sich daran existierende Konten UND deren
    // Push-Status ablesen – eine Wörterbuchsuche über Namen hätte die komplette
    // Nutzerliste des Vereins geliefert (DSGVO-relevant) und direkt die für
    // /reset-by-pin interessanten Ziele markiert.
    const PUSH_SENT_MESSAGE = 'Wenn ein Konto mit registriertem Gerät existiert, wurde eine Benachrichtigung gesendet.';

    const pushUserId = await findUserIdByName(name);
    const user = pushUserId
      ? await prisma.user.findUnique({ where: { id: pushUserId }, include: { pushSubscriptions: true } })
      : null;
    if (!user || user.pushSubscriptions.length === 0) {
      return res.json({ message: PUSH_SENT_MESSAGE });
    }

    // Alten Tokens lschen & Neuen Token generieren
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 3600000) }
    });

    const resetUrl = `${resolveFrontendUrl()}/reset-password?token=${token}`;

    // sendPushToUser laedt die Subscriptions selbst neu und raeumt tote Abos
    // (abgelaufen ODER durch VAPID-Key-Wechsel ungueltig geworden) zentral auf.
    await sendPushToUser(user.id, 'Passwort zurücksetzen', 'Tippe hier, um dein Passwort neu zu vergeben.', resetUrl);

    res.json({ message: PUSH_SENT_MESSAGE });
  } catch (err) {
    next(err);
  }
});

export default router;
