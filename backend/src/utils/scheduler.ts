import prisma from '../config/prisma.js';
import { notifyUser } from './notify.js';
import { deleteUserAccount } from './accountDeletion.js';
import { effektiveZeit, minToTime } from './schichtzeit.js';
import { zeitpunktOrtszeit } from './zonenzeit.js';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// Läuft im 60s-Tick mit, aber die eigentliche Prüfung nur einmal pro
// Kalendertag - taeglich reicht fuer eine 1-Jahres-Grenze voellig, jede
// Minute waere reine Verschwendung.
let lastInactivityCleanupDate: string | null = null;

/**
 * Startet den Reminder-Scheduler.
 * Läuft alle 60 Sekunden und prüft:
 *  1. Termin-Reminder: 2 Stunden vor Schichtbeginn
 *  2. Dankeschön + Bewertungs-Reminder: 30 Minuten nach Schichtende
 */
export function startScheduler(): void {
  console.log('[Scheduler] Reminder-Scheduler gestartet (Intervall: 60s).');

  setInterval(async () => {
    try {
      await checkRemindersBefore();
      await checkRemindersAfter();
      await checkInactiveUserCleanup();
    } catch (err: any) {
      console.error('[Scheduler] Fehler im Scheduler-Tick:', err?.message || err);
    }
  }, 60_000);
}

/**
 * Löscht Benutzerkonten, die seit über einem Jahr inaktiv sind. Maßgeblich
 * ist lastActivityAt (jeder authentifizierte Request, Lesen wie Schreiben) -
 * nicht lastLoginAt, da ein User dank der langen Session-Laufzeit über
 * Monate aktiv sein kann, ohne sich neu anzumelden. lastLoginAt bleibt davon
 * unberührt in der DB erhalten, ist für diese Prüfung aber nicht mehr
 * maßgeblich. Falls nie eine Aktivität stattfand, zählt ersatzweise das
 * Registrierungsdatum. ADMIN-Konten sind bewusst ausgenommen: ein
 * automatisch gelöschter letzter Admin würde den Verein komplett aus der
 * eigenen Verwaltung aussperren. Löschung läuft über dieselbe
 * deleteUserAccount()-Funktion wie die Selbst-Löschung (DSGVO-konform:
 * Schicht-/Spenden-Historie wird anonymisiert statt gelöscht).
 */
async function checkInactiveUserCleanup(): Promise<void> {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (lastInactivityCleanupDate === todayKey) return;
  lastInactivityCleanupDate = todayKey;

  const cutoff = new Date(Date.now() - ONE_YEAR_MS);

  const candidates = await prisma.user.findMany({
    where: {
      // Ueber die Rollentabelle: ein Admin, der zusaetzlich Trainer ist,
      // haette mit der alten Einzelspalte nicht mehr 'ADMIN' dort stehen.
      userRoles: { none: { role: 'ADMIN' } },
      OR: [
        { lastActivityAt: { lt: cutoff } },
        { lastActivityAt: null, createdAt: { lt: cutoff } }
      ]
    },
    select: { id: true, name: true, email: true, lastActivityAt: true, createdAt: true }
  });

  for (const user of candidates) {
    console.log(JSON.stringify({
      event: 'INACTIVE_USER_AUTO_DELETED',
      userId: user.id,
      name: user.name,
      email: user.email,
      lastActivityAt: user.lastActivityAt,
      accountCreatedAt: user.createdAt,
      timestamp: new Date().toISOString()
    }));
    try {
      await deleteUserAccount(user.id);
    } catch (err: any) {
      console.error(`[Scheduler] Fehler beim automatischen Löschen von User ${user.id}:`, err?.message || err);
    }
  }

  if (candidates.length > 0) {
    console.log(`[Scheduler] ${candidates.length} inaktive(r) Nutzer (>1 Jahr ohne Aktivität) automatisch gelöscht.`);
  }
}

/**
 * Wann eine eingeplante Schicht tatsaechlich beginnt und endet.
 *
 * Zwei Dinge sind hier schon schiefgegangen und stehen deshalb an einer
 * einzigen Stelle, mit Tests:
 *
 *  - Eine Schicht muss kein eigenes startMin haben; sie kann die Zeit vom
 *    Zeitfenster des Tages erben. Wer nur shift.startMin liest, uebersieht
 *    genau diese Schichten - und zwar lautlos.
 *  - Die Uhrzeit ist Ortszeit in Holm. Als UTC gelesen liegt der Zeitpunkt im
 *    Sommer zwei Stunden daneben, ohne dass die Zahl falsch aussieht.
 */
export interface ReminderSchicht {
  date: Date | string;
  shift: {
    startMin: number | null;
    endMin: number | null;
    daySlot?: { startMin: number; endMin: number } | null;
  } | null;
}

export function schichtZeitpunkte(vs: ReminderSchicht): { beginn: Date | null; ende: Date | null } {
  if (!vs.shift) return { beginn: null, ende: null };
  const { start, ende } = effektiveZeit(vs.shift, vs.shift.daySlot);
  return {
    beginn: start == null ? null : zeitpunktOrtszeit(vs.date, start),
    ende: ende == null ? null : zeitpunktOrtszeit(vs.date, ende)
  };
}

/**
 * Termin-Reminder an Helfer, deren Schicht in 90–130 Minuten beginnt
 * (Fenster von 40 Min, damit kein Reminder durch den 60s-Jitter
 * übersprungen wird).
 *
 * Geht über notifyUser und damit über beide Kanaele - Push UND dauerhaft
 * gespeichert. Push allein erreichte kaum jemanden: die App ist selten
 * installiert und Benachrichtigungen noch seltener erlaubt.
 *
 * Die Zeit kommt ueber effektiveZeit(): eine Schicht muss kein eigenes
 * startMin haben, sie kann es vom Zeitfenster des Tages erben. Frueher wurde
 * ein fehlendes startMin als "nicht erinnerbar" gelesen und die Schicht
 * kommentarlos uebersprungen - fuer die betroffenen Helfer kam nie ein
 * Reminder, ohne dass irgendwo etwas davon stand.
 */
async function checkRemindersBefore(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 90 * 60 * 1000);  // jetzt + 90min
  const windowEnd   = new Date(now.getTime() + 130 * 60 * 1000); // jetzt + 130min

  // Alle VolunteerShifts laden, wo Reminder noch nicht gesendet wurde
  const candidates = await prisma.volunteerShift.findMany({
    where: { reminderSentBefore: false, userId: { not: null } },
    include: { shift: { include: { workArea: true, daySlot: true } } }
  });

  for (const vs of candidates) {
    if (!vs.userId || !vs.shift) continue;

    const { beginn: shiftStart } = schichtZeitpunkte(vs);
    if (shiftStart == null) continue;

    if (shiftStart >= windowStart && shiftStart <= windowEnd) {
      const areaName = vs.shift.workArea?.name || vs.role || 'deiner Schicht';
      const startStr = minToTime(effektiveZeit(vs.shift, vs.shift.daySlot).start!);

      console.log(`[Scheduler] Sende Termin-Reminder an User ${vs.userId} für Schicht ${vs.id} um ${startStr}.`);
      await notifyUser(
        vs.userId,
        '⏰ Gleich geht’s los!',
        ({ vertretend, name }) => vertretend
          ? `Die Schicht von ${name} als ${areaName} beginnt in ca. 2 Stunden (${startStr}).`
          : `Deine Schicht als ${areaName} beginnt in ca. 2 Stunden (${startStr}). Wir freuen uns auf dich! 💪`,
        '/'
      );

      await prisma.volunteerShift.update({
        where: { id: vs.id },
        data: { reminderSentBefore: true }
      });
    }
  }
}

/**
 * Dankeschön + Bitte um Bewertung an Helfer, deren Schicht vor 30–90
 * Minuten geendet hat.
 *
 * Ueber notifyUser, damit das Danke auch in der App steht und nicht nur als
 * Push-Meldung vorbeizieht - sonst sieht es fast niemand, und die
 * Bewertungen bleiben aus.
 */
async function checkRemindersAfter(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 90 * 60 * 1000); // jetzt - 90min
  const windowEnd   = new Date(now.getTime() - 30 * 60 * 1000); // jetzt - 30min

  const candidates = await prisma.volunteerShift.findMany({
    where: { thanksSentAfter: false, userId: { not: null } },
    include: { shift: { include: { workArea: true, daySlot: true } } }
  });

  for (const vs of candidates) {
    if (!vs.userId || !vs.shift) continue;

    const { ende: shiftEnd } = schichtZeitpunkte(vs);
    if (shiftEnd == null) continue;

    if (shiftEnd >= windowStart && shiftEnd <= windowEnd) {
      const areaName = vs.shift.workArea?.name || vs.role || 'deiner Schicht';

      console.log(`[Scheduler] Sende Danke+Bewertungs-Reminder an User ${vs.userId} für Schicht ${vs.id}.`);
      await notifyUser(
        vs.userId,
        '🙏 Danke für deinen Einsatz!',
        ({ vertretend, name }) => vertretend
          ? `${name} war als ${areaName} im Einsatz – vielen Dank! Hast du eine Minute? `
            + 'Über „Deine Jobs" lässt sich die Schicht bewerten. ⭐'
          : `Du warst als ${areaName} im Einsatz – vielen Dank! Hast du eine Minute? `
            + 'Über „Deine Jobs" kannst du die Schicht bewerten. ⭐',
        '/'
      );

      await prisma.volunteerShift.update({
        where: { id: vs.id },
        data: { thanksSentAfter: true }
      });
    }
  }
}
