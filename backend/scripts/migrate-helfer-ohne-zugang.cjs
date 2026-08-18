/**
 * Kennzeichnet die bisherigen Platzhalter-Konten als "Helfer ohne App-Zugang".
 *
 * Bis jetzt gab es fuer Jugendliche, die mithelfen aber kein eigenes Konto
 * haben, nur einen Behelf: ein normaler Helfer-Datensatz, angelegt vom
 * Organisator. Von aussen war der von einem echten Konto nicht zu
 * unterscheiden - er tauchte in Passwort- und Push-Listen auf, und
 * Benachrichtigungen zu seinen Schichten verpufften.
 *
 * Erkannt werden sie zuverlaessig daran, dass sie WEDER Passwort NOCH E-Mail
 * haben und sich nie angemeldet haben. Ein echtes Konto erfuellt das nicht:
 * ohne eines von beiden koennte es sich gar nicht erst anmelden.
 *
 * Das Praefix "Dummy " aus der Behelfszeit wird dabei entfernt.
 *
 * Idempotent: bereits gekennzeichnete Datensaetze werden nicht erneut
 * angefasst.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const kandidaten = await prisma.user.findMany({
      where: {
        ohneZugang: false,
        lastLoginAt: null,
        OR: [{ password: null }, { password: '' }],
        AND: [{ OR: [{ email: null }, { email: '' }] }]
      },
      select: { id: true, name: true }
    });

    if (kandidaten.length === 0) {
      console.log('[helfer-ohne-zugang] Keine Platzhalter-Konten gefunden - nichts zu tun.');
      return;
    }

    for (const k of kandidaten) {
      const name = k.name.replace(/^Dummy\s+/i, '').trim() || k.name;
      await prisma.user.update({ where: { id: k.id }, data: { ohneZugang: true, name } });
    }

    console.log(
      `[helfer-ohne-zugang] ${kandidaten.length} Konto/Konten als "ohne App-Zugang" gekennzeichnet: `
      + kandidaten.map(k => k.name.replace(/^Dummy\s+/i, '').trim()).join(', ')
    );
    console.log('[helfer-ohne-zugang] Hinweis: Kontaktperson bitte in der Helferverwaltung nachtragen,');
    console.log('[helfer-ohne-zugang] sonst erreichen Schicht-Aenderungen weiterhin niemanden.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
