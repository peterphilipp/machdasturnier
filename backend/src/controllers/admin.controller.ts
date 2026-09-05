import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import prisma from '../config/prisma.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { anonymisiereDatenbank } from '../utils/anonymisierung.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Wo die SQLite-Datei liegt, die gerade wirklich benutzt wird.
 *
 * Gefragt wird SQLite selbst. Vorher stand hier ein Regex auf die
 * schema.prisma, der nach `url = "file:..."` suchte - dort steht aber
 * `url = env("DATABASE_URL")`, also fand er nichts und Export UND Import
 * antworteten mit 500.
 *
 * Auch der naheliegende Ersatz - DATABASE_URL selbst auseinandernehmen - ist
 * heikler, als er aussieht: In der Produktion steht dort ein absoluter Pfad
 * (`file:/app/data/dev.db`), lokal ein relativer (`file:./prisma/data/dev.db`),
 * und relative Pfade loest Prisma gegen das Verzeichnis der schema.prisma auf,
 * nicht gegen das Arbeitsverzeichnis. Lokal liegt die offene Datei deshalb
 * tatsaechlich unter prisma/prisma/data/ - ein Pfad, den man sich nicht
 * ausdenkt. `PRAGMA database_list` liefert stattdessen den Pfad der Datei, die
 * die Verbindung offen hat: eine Quelle, die per Definition stimmt.
 *
 * Die Umgebungsvariable bleibt als Rueckfall, falls das PRAGMA einmal nicht
 * durchkommt - dann wenigstens mit derselben Auflösung wie bei Prisma.
 */
async function ermittleDbPfad(): Promise<string | null> {
  try {
    const zeilen = await prisma.$queryRawUnsafe<{ name: string; file: string | null }[]>(
      'PRAGMA database_list'
    );
    const haupt = zeilen.find(z => z.name === 'main');
    if (haupt?.file) return haupt.file;
  } catch (err) {
    console.warn('[DB PFAD] PRAGMA database_list nicht verfuegbar:', (err as Error).message);
  }

  const url = process.env.DATABASE_URL;
  if (!url?.startsWith('file:')) return null;
  const roh = url.slice('file:'.length);
  return path.isAbsolute(roh) ? roh : path.resolve(__dirname, '../../prisma', roh);
}

/**
 * Exportiert die SQLite-Datenbank als Base64-encoded string.
 * Der Client kann dies herunterladen oder in eine neue DB importieren.
 */
export const dumpDatabase = async (req: AuthRequest, res: Response) => {
  try {
    const dbPath = await ermittleDbPfad();

    if (!dbPath) {
      return res.status(500).json({
        error: 'Der Pfad zur Datenbank liess sich nicht ermitteln (weder über SQLite noch über DATABASE_URL).'
      });
    }

    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: `Datenbank-Datei nicht gefunden: ${dbPath}` });
    }

    /**
     * Nicht die laufende Datei kopieren, sondern SQLite einen Schnappschuss
     * schreiben lassen.
     *
     * Ein `readFileSync` auf die offene Datenbank liefert im WAL-Modus nur den
     * Stand des letzten Checkpoints - alles danach steht in der Datei
     * `...db-wal` daneben. Das Backup-Skript im Repo sichert die deshalb
     * ausdruecklich mit. Ein Export, der genau EINE Datei zum Herunterladen
     * erzeugt, kann das nicht: Er saehe vollstaendig aus und haette die
     * neuesten Aenderungen stillschweigend nicht dabei - beim Fuellen einer
     * Testumgebung der unangenehmste aller Fehler, weil er nicht auffaellt.
     *
     * `VACUUM INTO` schreibt eine in sich geschlossene, eingecheckpointete
     * Kopie, waehrend die Datenbank in Benutzung ist, und komprimiert sie
     * dabei noch.
     */
    const tempZiel = path.join(os.tmpdir(), `dbexport-${Date.now()}-${process.pid}.db`);
    try {
      await prisma.$executeRawUnsafe(`VACUUM INTO '${tempZiel.replace(/'/g, "''")}'`);

      /**
       * Anonymisieren, wenn gewuenscht - und zwar HIER, nicht beim Import.
       *
       * Beim Import waere es zu spaet: Die Datei mit den echten Namen,
       * Mailadressen und Telefonnummern laege dann schon im Download-Ordner
       * von irgendjemandem. Was die Produktion verlaesst, soll bereits sauber
       * sein.
       */
      const anonym = req.query.anonymisieren === '1';
      const ergebnis = anonym
        ? await anonymisiereDatenbank(tempZiel, req.userId ?? null, dbPath)
        : null;

      const dbBuffer = fs.readFileSync(tempZiel);
      res.json({
        success: true,
        databaseSize: dbBuffer.length,
        timestamp: new Date().toISOString(),
        anonymisiert: anonym,
        eingriffe: ergebnis?.eingriffe ?? [],
        anmeldung: ergebnis?.anmeldung ?? null,
        // Base64-encoded SQLite DB - kann vom Client gespeichert werden
        database: dbBuffer.toString('base64')
      });
    } finally {
      // Der Schnappschuss ist eine vollstaendige Kopie aller Vereinsdaten -
      // er darf nicht im temporaeren Verzeichnis liegenbleiben.
      fs.rmSync(tempZiel, { force: true });
    }
  } catch (error) {
    console.error('[DB DUMP ERROR]', error);
    res.status(500).json({ error: `Fehler beim Exportieren der Datenbank: ${(error as Error).message}` });
  }
};

/**
 * Importiert eine Base64-encoded SQLite-Datenbank.
 * Überschreibt die aktuelle DB nach Backup.
 */
export const importDatabase = async (req: Request, res: Response) => {
  try {
    const { database } = req.body;
    
    if (!database || typeof database !== 'string') {
      return res.status(400).json({ error: 'Base64-encoded Datenbank erforderlich' });
    }

    const dbPath = await ermittleDbPfad();

    if (!dbPath) {
      return res.status(500).json({
        error: 'Der Pfad zur Datenbank liess sich nicht ermitteln (weder über SQLite noch über DATABASE_URL).'
      });
    }

    // Was hochgeladen wurde, muss auch eine SQLite-Datenbank sein. Ohne diese
    // Pruefung schreibt ein versehentlich gewaehltes PDF die laufende
    // Datenbank kaputt, und der Fehler zeigt sich erst beim naechsten Zugriff.
    const dbBuffer = Buffer.from(database, 'base64');
    if (dbBuffer.subarray(0, 15).toString('latin1') !== 'SQLite format 3') {
      return res.status(400).json({
        error: 'Die Datei ist keine SQLite-Datenbank. Bitte die exportierte .db-Datei auswählen.'
      });
    }

    const dbDir = path.dirname(dbPath);

    // Backup der aktuellen DB erstellen
    const backupPath = path.join(dbDir, `backup-${Date.now()}.db`);

    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
    }

    // Erst die Verbindung schliessen, dann schreiben - nicht umgekehrt. Eine
    // offene Verbindung haelt im WAL-Modus eigene Dateien, die nach dem
    // Ueberschreiben nicht mehr zur neuen Datenbank passen.
    await prisma.$disconnect();

    fs.writeFileSync(dbPath, dbBuffer);

    // Die Begleitdateien der ALTEN Datenbank beschreiben Seiten, die es in der
    // neuen nicht mehr gibt. Bleiben sie liegen, liest SQLite sie beim
    // naechsten Oeffnen mit und die importierte Datenbank ist beschaedigt.
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true });
    }

    res.json({
      success: true,
      message: 'Datenbank erfolgreich importiert',
      databaseSize: dbBuffer.length,
      backupPath: backupPath.replace(process.cwd(), '') // Relativer Pfad für Logs
    });
  } catch (error) {
    console.error('[DB IMPORT ERROR]', error);
    res.status(500).json({ error: `Fehler beim Importieren der Datenbank: ${(error as Error).message}` });
  }
};
