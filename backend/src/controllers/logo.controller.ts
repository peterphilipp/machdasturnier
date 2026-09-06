import { Request, Response } from 'express';
import prisma from '../config/prisma.js';

/**
 * Liefert Verein- und Turnierlogo als echtes Bild.
 *
 * Anlass ist der Mailversand. Die Logos liegen in der Datenbank als
 * `data:`-URL - in der App funktioniert das, in einer E-Mail nicht: Gmail
 * (und die meisten Webmailer) entfernen `data:`-Bilder. Ein Bild in einer Mail
 * braucht eine echte, oeffentlich erreichbare HTTPS-Adresse.
 *
 * Bewusst OEFFENTLICH ohne Anmeldung: Ein Mailprogramm laedt Bilder ohne
 * Sitzung und ohne Token. Preisgegeben wird dabei nichts, was nicht ohnehin
 * auf jedem Aushang steht - das Vereinslogo. Personenbezogene Daten sind hier
 * nicht erreichbar.
 */

/** Ein `data:`-URL in Rohdaten und Medientyp zerlegen. */
function zerlegeDataUrl(wert: string): { typ: string; daten: Buffer } | null {
  const treffer = /^data:([\w.+/-]+);base64,(.+)$/s.exec(wert.trim());
  if (!treffer) return null;
  try {
    return { typ: treffer[1], daten: Buffer.from(treffer[2], 'base64') };
  } catch {
    return null;
  }
}

async function sendeLogo(res: Response, wert: string | null | undefined, was: string) {
  if (!wert) return res.status(404).json({ error: `Kein ${was} hinterlegt.` });

  const bild = zerlegeDataUrl(wert);
  if (!bild) {
    // Kein data:-URL - vermutlich schon eine externe Adresse. Dann ist der
    // Umweg ueber diesen Endpunkt unnoetig, und ein Redirect ist ehrlicher
    // als ein erfundenes Bild.
    if (/^https?:\/\//i.test(wert.trim())) return res.redirect(302, wert.trim());
    return res.status(415).json({ error: `Das ${was} liegt in einem unbekannten Format vor.` });
  }

  // Ein Logo aendert sich selten, wird aber in jeder Mail an jeden Empfaenger
  // geladen. Ohne Caching haette ein Rundschreiben an achtzig Leute achtzig
  // Anfragen zur Folge, jede mit einem Datenbankzugriff.
  res.setHeader('Content-Type', bild.typ);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(bild.daten.length));
  return res.end(bild.daten);
}

export const getClubLogo = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Ungültige ID.' });

  const club = await prisma.club.findUnique({ where: { id }, select: { logo: true } });
  if (!club) return res.status(404).json({ error: 'Verein nicht gefunden.' });
  return sendeLogo(res, club.logo, 'Vereinslogo');
};

export const getTournamentLogo = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Ungültige ID.' });

  const t = await prisma.tournament.findUnique({ where: { id }, select: { logo: true } });
  if (!t) return res.status(404).json({ error: 'Turnier nicht gefunden.' });
  return sendeLogo(res, t.logo, 'Turnierlogo');
};
