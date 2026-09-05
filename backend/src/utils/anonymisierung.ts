import { PrismaClient } from '@prisma/client';

/**
 * Macht aus einer exportierten Datenbank eine, die man in eine Testumgebung
 * legen kann.
 *
 * Der Anlass: Ein Export der Produktionsdatenbank enthaelt die echten Namen,
 * Mailadressen und Telefonnummern aller Vereinsmitglieder - und die Namen
 * ihrer Kinder. Wandert er unveraendert in eine Testumgebung, sind die
 * Mitglieder dort ploetzlich Testdaten, in einer Umgebung, die in der Regel
 * lockerer zugaenglich ist als die Produktion.
 *
 * Der schaerfere Teil ist aber nicht, was dort liegt, sondern was die
 * Testumgebung damit TUN kann: In `push_subscriptions` stehen die Endpunkte
 * echter Geraete. Ein Testklick auf "Aufruf senden" erreicht damit echte
 * Handys von echten Leuten. Deshalb loescht die Anonymisierung nicht nur
 * Merkmale, sondern kappt auch alle Wege nach draussen.
 *
 * Laeuft NUR auf einer Kopie (dem Schnappschuss, den `VACUUM INTO` erzeugt
 * hat), niemals auf der laufenden Datenbank - siehe die Zusicherung in
 * anonymisiereDatenbank().
 */

/**
 * Die Eingriffe, einzeln benannt.
 *
 * Bewusst eine Liste mit Zweck statt eines Blocks SQL: Wer spaeter ein Feld
 * mit personenbezogenen Daten hinzufuegt, soll hier sehen, was es schon gibt
 * und wo seines fehlt. Die Beschreibung landet ausserdem in der Antwort des
 * Exports, damit im Dialog steht, was tatsaechlich passiert ist.
 */
export interface Eingriff {
  zweck: string;
  sql: (behalteUserId: number | null) => string;
}

export const EINGRIFFE: Eingriff[] = [
  {
    zweck: 'Namen, Mailadressen und Telefonnummern der Mitglieder ersetzt',
    sql: () => `
      UPDATE users SET
        name  = 'Testperson ' || id,
        email = 'testperson' || id || '@example.invalid',
        phone = NULL
    `
  },
  {
    // .invalid ist per RFC 2606 dauerhaft nicht auflösbar - an so eine Adresse
    // kann auch bei einem Fehlgriff in der Konfiguration nichts rausgehen.
    zweck: 'Wiederherstellungs-PINs entfernt',
    sql: () => `UPDATE users SET recovery_pin = NULL`
  },
  {
    zweck: 'Passwörter entfernt (außer dem des exportierenden Kontos)',
    sql: (behalte) => behalte == null
      ? `UPDATE users SET password = NULL`
      : `UPDATE users SET password = NULL WHERE id <> ${behalte}`
  },
  {
    zweck: 'Namen der Kinder ersetzt',
    sql: () => `UPDATE volunteer_children SET child_name = 'Kind ' || id`
  },
  {
    // Der wichtigste Eingriff: ohne diese Zeilen kann die Testumgebung echte
    // Geraete erreichen.
    zweck: 'Push-Abos gelöscht – die Testumgebung kann niemanden mehr erreichen',
    sql: () => `DELETE FROM push_subscriptions`
  },
  {
    // Passkeys sind an den Hostnamen gebunden und in einer anderen Umgebung
    // ohnehin wertlos - sie stehen dort nur als Anmeldeweg, der scheitert.
    zweck: 'Passkeys gelöscht (sind an die Produktionsdomain gebunden)',
    sql: () => `DELETE FROM webauthn_credentials`
  },
  {
    zweck: 'Offene Passwort-Zurücksetzen-Token gelöscht',
    sql: () => `DELETE FROM password_reset_tokens`
  },
  {
    // Enthalten formulierte Saetze mit Namen ("Die Schicht von Anja P. ...").
    zweck: 'Gespeicherte Benachrichtigungen gelöscht (enthalten Namen im Text)',
    sql: () => `DELETE FROM user_notifications`
  },
  {
    // Ebenso: "hat Max Mustermann für Grillstand eingeplant".
    zweck: 'Änderungsverlauf gelöscht (enthält Namen im Text)',
    sql: () => `DELETE FROM aenderungen`
  },
  {
    // Nicht loeschen, sondern ersetzen: Die Bewertungsansichten brauchen
    // Inhalt, um ueberhaupt etwas zu zeigen. Die Zahlenwerte bleiben, nur der
    // Freitext geht - dort steht am ehesten etwas Persoenliches.
    zweck: 'Freitext-Kommentare aus den Bewertungen ersetzt (Zahlen bleiben)',
    sql: () => `
      UPDATE volunteer_shifts
      SET rating_comment = '(Kommentar in der Testumgebung entfernt)'
      WHERE rating_comment IS NOT NULL AND rating_comment <> ''
    `
  },
  {
    /**
     * Die Merker fuer Reminder und Danke auf "schon passiert" setzen.
     *
     * Aufgefallen beim Aufraeumen einer Testumgebung, in die vorher ein
     * vollstaendiger Export gewandert war: Der Scheduler startet mit dem
     * Server und schaut jede Minute, fuer welche Schicht noch kein Reminder
     * raus ist. Die Merker kommen aus der Produktion mit - fuer jede Schicht,
     * die dort noch nicht gefeuert hat, steht dort `false`. Die Testumgebung
     * haelt das fuer ihre Aufgabe und holt es nach.
     *
     * Ohne Push-Abos (siehe oben) geht davon nichts raus. Aber die Zeile
     * kostet nichts und macht den Schutz unabhaengig davon, ob jemand in der
     * Testumgebung spaeter neue Abos anlegt.
     */
    zweck: 'Reminder-Merker gesetzt – der Scheduler holt nichts nach',
    sql: () => `UPDATE volunteer_shifts SET reminder_sent_before = 1, thanks_sent_after = 1`
  }
];

export interface Anonymisierungsergebnis {
  /** Was getan wurde, in Klartext - wandert in die Antwort des Exports. */
  eingriffe: string[];
  /** Womit sich der Exportierende in der Testumgebung anmelden kann. */
  anmeldung: { email: string; hinweis: string } | null;
}

/**
 * Fuehrt die Eingriffe auf der Datei unter `dateiPfad` aus.
 *
 * `behalteUserId` behaelt genau ein Passwort: das des Kontos, das den Export
 * ausloest. Ohne das waere die Testumgebung nach dem Import verschlossen -
 * niemand koennte sich anmelden. Mit allen Passwoertern dagegen wanderten die
 * Zugangsdaten aller Mitglieder mit; ein bcrypt-Hash ist nicht umkehrbar,
 * aber er ist trotzdem das Geheimnis einer anderen Person. Genau eines zu
 * behalten - das eigene, dessen Passwort der Exportierende kennt - ist der
 * einzige Weg, der beides vermeidet.
 */
export async function anonymisiereDatenbank(
  dateiPfad: string,
  behalteUserId: number | null,
  livePfad: string
): Promise<Anonymisierungsergebnis> {
  // Zusicherung, nicht Vertrauen: Ein Fehlgriff hier wuerde die echten Daten
  // des Vereins ueberschreiben. Das darf nicht von der Aufrufstelle abhaengen.
  if (dateiPfad === livePfad) {
    throw new Error('Anonymisierung wurde auf die laufende Datenbank angesetzt - abgebrochen.');
  }

  const kopie = new PrismaClient({ datasources: { db: { url: `file:${dateiPfad}` } } });
  try {
    const eingriffe: string[] = [];
    for (const e of EINGRIFFE) {
      await kopie.$executeRawUnsafe(e.sql(behalteUserId));
      eingriffe.push(e.zweck);
    }

    return {
      eingriffe,
      anmeldung: behalteUserId == null ? null : {
        email: `testperson${behalteUserId}@example.invalid`,
        hinweis: 'Dein bisheriges Passwort gilt weiter – Name und Mailadresse sind ersetzt.'
      }
    };
  } finally {
    await kopie.$disconnect();
  }
}
