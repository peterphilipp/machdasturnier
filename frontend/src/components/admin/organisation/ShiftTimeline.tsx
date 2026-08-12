import { ReactNode } from 'react';
import { minToTime } from '../shared';
import type { VolunteerShift } from '../shared';
import { GanttTimeline, GanttRow } from '../ganttTimeline';

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

  const rows: GanttRow[] = [...byArea.entries()].map(([areaId, area]) => ({
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

      const assigned = volunteerShifts
        ? volunteerShifts.filter(vs => vs.shiftId === s.id).length
        : null;
      const max = s.maxVolunteers ?? 1;
      const isFull = assigned != null && assigned >= max;
      const staffingBorder = assigned == null
        ? undefined
        : isFull ? '#16a34a' : assigned > 0 ? '#d97706' : '#dc2626';

      const showTime = (en - st) > 20;
      const timeStr = `${minToTime(st)}–${minToTime(en)}`;
      const occStr = assigned != null ? `${assigned}/${max}` : `${s.minVolunteers ?? 1}-${max}`;
      const label = (isPending ? '✎ ' : '') + (showTime ? `${occStr} (${timeStr})` : occStr);

      const tooltip = (assigned != null
        ? `${minToTime(st)}–${minToTime(en)} · Belegung: ${assigned}/${max} Helfer${editable && timeEditMode ? ' · klicken für Details, Ränder ziehen für Zeiten' : ''}`
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
        border: hasCustomTime ? '2px dashed #0d6efd' : undefined,
        boxShadow: staffingBorder ? `0 0 0 2px ${staffingBorder}` : undefined
      };
    })
  }));

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

      <GanttTimeline
        globalStartMin={globalStartMin}
        globalEndMin={globalEndMin}
        rows={rows}
        editable={editable}
        timeEditMode={timeEditMode}
        onTimeChange={onStageShiftTime}
        onItemClick={handleItemClick}
      />

      {/* Legende */}
      <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: '#6c757d' }}>
        <span>🟦 = Standard-Zeiten (aus Vorlage)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 20, height: 12, border: '2px dashed rgba(255,255,255,0.9)', borderRadius: 3, background: '#3b98f8' }} />
          = Angepasste Zeiten
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 20, height: 12, border: '3px dashed #fd7e14', borderRadius: 3, background: '#3b98f8' }} />
          = Nicht gespeicherte Änderung
        </span>
      </div>
    </div>
  );
}
