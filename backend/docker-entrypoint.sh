#!/bin/sh
set -e

echo "  Alte Shift-Daten pruefen (Tag-/Slot-System Migration)..."
node scripts/migrate-day-slot-system.cjs

# MUSS vor "db push" laufen: das Schema legt jetzt einen Unique-Index ueber
# (Tag, Start, Ende) auf day_slots an, der an bestehenden Duplikaten scheitern
# wuerde.
echo "  Doppelte Zeitfenster je Turniertag zusammenfuehren..."
node scripts/migrate-dedupe-day-slots.cjs

# Sicherung VOR jedem Schema-Push: "db push --accept-data-loss" kann bei
# SQLite fuer manche Aenderungen (z.B. Foreign-Key-onDelete-Verhalten) die
# betroffene Tabelle intern neu anlegen. Das ist im Normalfall verlustfrei,
# aber ein Fehlschlag oder ein unerwarteter Prisma-Bug waere sonst nicht mehr
# rueckgaengig zu machen. Best-effort: ein fehlschlagendes Backup (z.B. weil
# es die allererste Inbetriebnahme ohne bestehende DB-Datei ist) darf den
# Start nicht blockieren.
echo "  Sichere DB vor Schema-Push..."
node scripts/backup-db.cjs || echo "  (kein Backup erstellt - vermutlich Erststart ohne bestehende DB)"

echo "  Schema synchronisieren (prisma db push)..."
npx prisma db push --accept-data-loss

echo "  Rollen in die Mehrfachrollen-Tabelle uebertragen..."
node scripts/backfill-user-roles.cjs

echo "  Turnier-Mitgliedschaften aus bestehenden Schichten/Spenden ableiten..."
node scripts/backfill-tournament-membership.cjs

echo "  Recovery-PINs hashen (falls noch im Klartext gespeichert)..."
node scripts/migrate-hash-recovery-pins.cjs

echo "  Platzhalter-Konten als Helfer ohne App-Zugang kennzeichnen..."
node scripts/migrate-helfer-ohne-zugang.cjs

echo "  Wunsch-Arbeitsbereiche der Zeitangebote in die Mehrfachauswahl uebertragen..."
node scripts/migrate-shift-offer-work-areas.cjs

echo "  Alten Aenderungsverlauf aufraeumen (aelter als 90 Tage)..."
node scripts/cleanup-aenderungen.cjs

echo "  Lebensmittel-Einheit 'L' auf 'Liter' umstellen..."
node scripts/migrate-food-unit-liter.cjs

echo "  Standarddaten importieren (Ignition Phase)..."
npx prisma db seed

echo "  Backend startet..."
# Direkt das lokale Binary starten statt "npx tsx": npx spawnt tsx als
# Kindprozess und beendet ihn bei SIGTERM (Container-Stop/Neustart) mit einem
# irrefuehrenden "npm error signal SIGTERM" im Log, obwohl es sich um ein
# normales Herunterfahren handelt. Per exec direkt wird der Node-Prozess
# selbst zu PID 1 und erhaelt/behandelt das Signal sauber.
exec node_modules/.bin/tsx src/server.ts
