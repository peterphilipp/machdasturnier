import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import { logRateLimited } from '../utils/logger.js';

/** Client-IP hinter dem Reverse-Proxy. Gleiche Logik wie in password.routes.ts. */
function clientIp(req: Request): string | undefined {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress;
}

/**
 * HTTP-Header-Härtung.
 *
 * contentSecurityPolicy ist bewusst DEAKTIVIERT: Das Frontend nutzt durchgängig
 * Inline-Styles (style={{...}} in jeder Komponente). Eine Standard-CSP ohne
 * 'unsafe-inline' würde die App komplett unbenutzbar machen. Alle übrigen
 * Schutz-Header (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
 * Cross-Origin-*) bleiben aktiv.
 *
 * TODO: CSP aktivieren, sobald die Inline-Styles in eine CSS-Datei ausgelagert sind.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  // Verhindert nicht, dass die eigene PWA Assets lädt, blockt aber Fremd-Embedding
  crossOriginEmbedderPolicy: false
});

/**
 * Intelligente CORS-Prüfung:
 * Erlaubt Same-Origin (wenn Origin-Header dem Host entspricht, wie von Browsern bei POST/PATCH
 * auch bei Same-Origin gesendet), Localhost/Intranet-Hostnamen sowie via FRONTEND_URL
 * konfigurierte Domains. Blockiert lediglich fremde externe Domains (gegen Brute-Force über fremde Websites).
 */
export const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  
  // Kein Origin-Header = same-origin (z.B. einfache GET im Browser), curl, Health-Checks
  if (!origin) {
    return cors({ origin: false, credentials: true })(req, res, next);
  }

  // Same-Origin Erkennung: Wenn Origin mit dem Host-Header übereinstimmt (z.B. http://fcos1:5000 oder http://localhost:5000)
  const host = req.headers.host;
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) {
    return cors({ origin: true, credentials: true })(req, res, next);
  }

  // Erlaubte feste Origins (aus .env, unterstützte Kommaliste)
  const envOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const isAllowed = envOrigins.includes(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('http://192.168.') ||
    origin.startsWith('http://10.') ||
    origin.startsWith('http://172.');

  if (isAllowed) {
    return cors({ origin: true, credentials: true })(req, res, next);
  }

  // Erlaube lokale Hostnamen im Netzwerk (z.B. http://fcos1:5000 oder http://turnier-server.local)
  try {
    const parsed = new URL(origin);
    if (!parsed.hostname.includes('.') || parsed.hostname.endsWith('.local') || parsed.hostname.endsWith('.lan') || parsed.hostname.endsWith('.fritz.box')) {
      return cors({ origin: true, credentials: true })(req, res, next);
    }
  } catch (e) {
    // Ungültige URL
  }

  return next(new Error('Origin nicht erlaubt (CORS)'));
};

/**
 * Globales Limit: absichtlich großzügig, damit normale Nutzung (Admin klickt
 * sich durch die Turnierplanung, viele parallele Queries) nie anschlägt.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' }
});

/**
 * Strenges Limit für unauthentifizierte Auth-Endpunkte.
 *
 * Diese Routen sind die eigentlichen Angriffsziele:
 *  - /login              -> Credential Stuffing
 *  - /reset-by-pin       -> PIN-Brute-Force (setzt direkt ein neues Passwort!)
 *  - /forgot-password    -> Mail-Bombing + Kosten/Reputation im Resend-Account
 *  - /forgot-password-push -> Push-Bombing + Entwerten offener Reset-Tokens
 *  - /register           -> Massen-Accounts
 *
 * `skipSuccessfulRequests` sorgt dafür, dass legitime Nutzer, die sich korrekt
 * anmelden, das Budget nicht verbrauchen – nur Fehlversuche zählen.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Zu viele Fehlversuche. Bitte warte 15 Minuten und versuche es dann erneut.' },
  /**
   * Die Sperre greift VOR dem Handler, es entstand also kein LOGIN_FAILED im
   * Log. Wer ein Anmeldeproblem untersuchte, sah schlicht nichts - und der
   * Nutzer bekam dieselbe Fehlermeldung wie bei falschem Passwort. Deshalb
   * hier eine eigene Zeile, damit der Fall im Log erkennbar ist.
   */
  handler: (req, res, _next, options) => {
    logRateLimited(req.path, clientIp(req) || '');
    res.status(options.statusCode).json(options.message);
  }
});

/**
 * Sehr strenges Limit für den PIN-Reset. Der PIN hat ~2^40 Entropie und ist
 * bcrypt-gehasht, aber dieser Endpunkt setzt ohne zweiten Faktor ein neues
 * Passwort – hier zählt jeder einzelne Versuch.
 */
/**
 * Limit für den Push-Broadcast-Endpunkt. Obwohl der Endpoint Admin-Auth
 * erfordert, begrenzt dieser Limiter den Schaden bei kompromittiertem
 * Admin-Token: maximal 10 Broadcasts pro Stunde pro IP.
 */
export const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Zu viele Push-Broadcasts. Bitte warte eine Stunde.' }
});

export const pinResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Zu viele Fehlversuche mit der Helfer-PIN. Bitte warte eine Stunde oder nutze den E-Mail-Reset.' }
});
