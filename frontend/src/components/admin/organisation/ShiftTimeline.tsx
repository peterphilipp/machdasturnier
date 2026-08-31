import { ReactNode } from 'react';
import { minToTime, BESETZUNG_FARBEN } from '../shared';
import type { VolunteerShift } from '../shared';
import { GanttTimeline, GanttRow, getSoftTint, getSoftBorder } from '../ganttTimeline';

export interface TimelineShift {
  id: number;
  tournamentWorkAreaId?: number | null;
  arbeitsbereichId?: number | null;
  startMin?: number | null;
  endMin?: number | null;
  minVolunteers?: number;
  maxVolunteers?: number;
  daySlot?: { startMin: number; endMin: number } | null;
  workArea?: { name: string; icon: string; color: string; order?: number } | null;
  arbeitsbereich?: { name: string; icon: string; color: string; order?: number } | null;
}

export default function ShiftTimeline({
  title,
  subtitle,
  headerRight,
  shifts,
  globalStartMin,
  globalEndMin,
  volunteerShifts,
  editable = false,
  timeEditMode = false,
  overrides,
  gruppierung = 'bereich',
  onShiftClick,
  onStageShiftTime
}: {
  title: string;
  subtitle?: ReactNode;
  headerRight?: ReactNode;
  shifts: TimelineShift[];
  globalStartMin: number;
  globalEndMin: number;
  volunteerShifts?: VolunteerShift[];
  editable?: boolean;
  timeEditMode?: boolean;
  overrides?: Record<number, { startMin: number; endMin: number }>;
  /** 'bereich' = eine Zeile je Arbeitsbereich, 'person' = eine Zeile je Helfer. */
  gruppierung?: 'bereich' | 'person';
  onShiftClick?: (s: TimelineShift) => void;
  onStageShiftTime?: (shiftId: number, startMin: number, endMin: number) => void;
}) {
  const shiftStart = (s: TimelineShift) => s.startMin ?? s.daySlot?.startMin ?? globalStartMin;
  const shiftEnd = (s: TimelineShift) => s.endMin ?? s.daySlot?.endMin ?? globalEndMin;

  // Nach Arbeitsbereich gruppieren (eine Zeile je Bereich)
  const byArea = new Map<number, { name: string; icon: string; color: string; items: TimelineShift[] }>();
  for (const s of shifts) {
    const key = (s.tournamentWorkAreaId ?? s.arbeitsbereichId ?? 0) as number;
    if (!byArea.has(key)) {
      byArea.set(key, {
        name: s.workArea?.name || s.arbeitsbereich?.name || '?',
        icon: s.workArea?.icon || s.arbeitsbereich?.icon || '📍',
        color: s.workArea?.color || s.arbeitsbereich?.color || '#3b98f8',
        items: []
      });
    }
    byArea.get(key)!.items.push(s);
  }

  if (shifts.length === 0) return null;

  const bereichsRows: GanttRow[] = [...byArea.entries()].map(([areaId, area]) => ({
    id: areaId,
    label: area.name,
    icon: area.icon,
    color: area.color,
    items: area.items.map(s => {
      const override = overrides?.[s.id];
      const isPending = !!override;
      const st = override ? override.startMin : shiftStart(s);
      const en = override ? override.endMin : shiftEnd(s);

      const slotStart = s.daySlot?.startMin;
      const slotEnd = s.daySlot?.endMin;
      const hasCustomTime = (s.startMin != null || s.endMin != null)
        && (slotStart != null || slotEnd != null)
        && (s.startMin !== slotStart || s.endMin !== slotEnd);

      const eingeplant = volunteerShifts
        ? volunteerShifts.filter(vs => vs.shiftId === s.id)
        : null;
      const assigned = eingeplant ? eingeplant.length : null;
      const max = s.maxVolunteers ?? 1;
      const showTime = (en - st) > 20;
      const timeStr = `${minToTime(st)}–${minToTime(en)}`;
      const occStr = assigned != null ? `${assigned}/${max}` : `${s.minVolunteers ?? 1}-${max}`;

      // Wer ist eingeplant? Auf dem Balken nur, wenn er breit genug ist - eine
      // halbstuendige Schicht mit vier Helfern hat dafuer keinen Platz. Im
      // Tooltip stehen die vollen Namen deshalb immer.
      //
      // Abgekuerzt auf "Anja P.": halbiert die Laenge und bleibt eindeutig
      // genug, um jemanden wiederzuerkennen - hier geht es ums Ueberfliegen,
      // die genaue Zuordnung liefert der Klick.
      const kurz = (name: string) => {
        const teile = name.trim().split(/\s+/);
        return teile.length > 1 ? `${teile[0]} ${teile[teile.length - 1][0]}.` : teile[0];
      };
      const namen = eingeplant?.map(vs => vs.user?.name).filter(Boolean) as string[] | undefined;
      const namenStr = namen && namen.length > 0 ? namen.join(', ') : null;
      const namenKurz = namen && namen.length > 0 ? namen.map(kurz).join(', ') : null;
      // Ueberschlag: ein Zeichen braucht rund fuenf Minuten Balkenbreite, dazu
      // Platz fuer die Belegungszahl. Laeuft es doch zu eng, schneidet das
      // Gantt sauber mit "…" ab.
      const platzFuerNamen = namenKurz != null && (en - st) > namenKurz.length * 5 + 25;

      const label = (isPending ? '✎ ' : '') + (showTime ? `${occStr} (${timeStr})` : occStr);

      const tooltip = (assigned != null
        ? `${minToTime(st)}–${minToTime(en)} · Belegung: ${assigned}/${max} Helfer`
          + (namenStr ? `: ${namenStr}` : '')
          + (editable && timeEditMode ? ' · klicken für Details, Ränder ziehen für Zeiten' : '')
        : `${minToTime(st)}–${minToTime(en)} · ${s.minVolunteers}–${max} Helfer${hasCustomTime ? ' (angepasste Zeit)' : ''}`)
        + (isPending ? ' · Änderung noch nicht gespeichert' : '');

      return {
        id: s.id,
        startMin: st,
        endMin: en,
        label,
        tooltip,
        isPending,
        assignedCount: assigned,
        maxVolunteers: max,
        // Statt der Uhrzeit die Namen - sie sind die Information, die sonst
        // erst nach einem Klick sichtbar wird.
        detail: platzFuerNamen ? (namenKurz as string) : undefined,
        border: hasCustomTime ? '2px dashed #0d6efd' : undefined
      };
    })
  }));

  /**
   * Alternative Sicht: eine Zeile je Helfer statt je Arbeitsbereich.
   *
   * Beantwortet eine andere Frage als der Bereichs-Blick. Dort geht es um "wo
   * fehlen Leute", hier um "wie sieht der Tag einer Person aus" - und damit um
   * Doppelbelegungen und um Wechsel, zwischen denen keine Minute liegt. Die
   * Flaeche traegt deshalb die Bereichsfarbe und nicht die Besetzung: dass eine
   * Schicht halb besetzt ist, sagt ueber den Tag dieser Person nichts.
   */
  const personenRows: GanttRow[] = (() => {
    if (!volunteerShifts) return [];
    const proPerson = new Map<number, { name: string; items: GanttRow['items'] }>();

    for (const vs of volunteerShifts) {
      const s = shifts.find(x => x.id === vs.shiftId);
      if (!s || vs.userId == null) continue;

      const override = overrides?.[s.id];
      const st = override ? override.startMin : shiftStart(s);
      const en = override ? override.endMin : shiftEnd(s);
      const bereich = s.workArea || s.arbeitsbereich;
      const farbe = bereich?.color || '#3b98f8';

      if (!proPerson.has(vs.userId)) {
        proPerson.set(vs.userId, { name: vs.user?.name || 'Unbekannt', items: [] });
      }
      proPerson.get(vs.userId)!.items.push({
        id: s.id,
        startMin: st,
        endMin: en,
        // Leeres Label faellt im Gantt auf die Uhrzeit zurueck, und die wird
        // auf schmalen Balken zu "14:00-14:3" angeschnitten. Deshalb bei wenig
        // Platz nur das Symbol des Bereichs - das bleibt lesbar.
        label: (en - st) > 45
          ? `${bereich?.icon ?? ''} ${bereich?.name ?? ''}`.trim()
          : (bereich?.icon ?? '·'),
        tooltip: `${vs.user?.name} · ${bereich?.name ?? 'Schicht'} · ${minToTime(st)}–${minToTime(en)}`,
        background: getSoftTint(farbe, 22),
        border: `1px solid ${getSoftBorder(farbe, 50)}`,
        isPending: !!override
      });
    }

    return [...proPerson.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'))
      .map(([userId, person]) => ({
        id: userId,
        label: person.name,
        icon: '👤',
        color: '#94a3b8',
        items: person.items
      }));
  })();

  const personenSicht = gruppierung === 'person';
  const rows = personenSicht ? personenRows : bereichsRows;

  const handleItemClick = (itemId: number) => {
    const s = shifts.find(x => x.id === itemId);
    if (s) onShiftClick?.(s);
  };

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 15, color: '#212557' }}>{title}</span>
        {subtitle}
        <span style={{ flex: 1 }} />
        {headerRight}
      </div>

      {personenSicht && rows.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          An diesem Tag ist noch niemand eingeplant – in der Bereichs-Ansicht siehst du, wo Plätze offen sind.
        </div>
      ) : (
        <GanttTimeline
          globalStartMin={globalStartMin}
          globalEndMin={globalEndMin}
          rows={rows}
          /* Im Personen-Modus erscheint dieselbe Schicht in mehreren Zeilen -
             ein Zug am Rand waere nicht mehr eindeutig einer Schicht zuzuordnen
             und wuerde sie fuer alle anderen mitverschieben. */
          editable={editable && !personenSicht}
          timeEditMode={timeEditMode && !personenSicht}
          onTimeChange={onStageShiftTime}
          onItemClick={handleItemClick}
        />
      )}

      {/* Legende: erst die Besetzung (das ist die Farbe der Flaeche), dann die Zeit-Zustaende (das ist der Rahmen).
          In der Personen-Sicht traegt die Flaeche den Arbeitsbereich - die
          Besetzungs-Legende waere dort schlicht falsch. */}
      <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: '#64748b', alignItems: 'center' }}>
        {personenSicht && (
          <span>Eine Zeile je Helfer · Farbe des Balkens = Arbeitsbereich · Balken antippen = Schicht öffnen</span>
        )}
        {!personenSicht && ([['voll', 'voll besetzt'], ['teilweise', 'teilweise besetzt'], ['leer', 'niemand eingeplant']] as const).map(([stufe, text]) => (
          <span key={stufe} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-block', width: 20, height: 12, borderRadius: 3,
              background: BESETZUNG_FARBEN[stufe].flaeche,
              border: `1px solid ${BESETZUNG_FARBEN[stufe].rand}`,
              borderLeft: '4px solid #94a3b8'
            }} />
            = {text}
          </span>
        ))}
        {!personenSicht && <span style={{ width: 1, height: 14, background: '#e2e8f0' }} />}
        {!personenSicht && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 20, height: 12, border: '2px dashed #0d6efd', borderRadius: 3, background: '#f8fafc' }} />
          = Angepasste Zeiten
        </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 20, height: 12, border: '2px dashed #fd7e14', borderRadius: 3, background: '#f8fafc' }} />
          = Nicht gespeicherte Änderung
        </span>
        {!personenSicht && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 4, height: 12, borderRadius: 2, background: '#94a3b8' }} />
          = Farbe des Arbeitsbereichs
        </span>
        )}
      </div>
    </div>
  );
}
