import { useState, useRef, useEffect } from 'react';

// ============================================================
// GanttTimeline – Gemeinsame Zeitleiste für ziehbare Balken
// Verwendet von: GlobalDayTemplates, ShiftTimeline (später)
// ============================================================

export interface GanttItem {
  id: number;
  startMin: number;
  endMin: number;
  label?: string; // Optionaler Label-Text auf dem Balken
  tooltip?: string;
  border?: string;
  boxShadow?: string;
  isPending?: boolean;
  assignedCount?: number | null;
  maxVolunteers?: number;
}

export interface GanttRow {
  id: number;
  label: string;
  icon?: string;
  color: string;
  items: GanttItem[];
}

const GRID_MINUTES = 15;

interface DragState {
  pointerId: number;
  itemId: number;
  type: 'start' | 'end' | 'move';
  origStart: number;
  origEnd: number;
  curStart: number;
  curEnd: number;
  startX: number;
  containerWidth: number;
}

export function GanttTimeline({
  globalStartMin,
  globalEndMin,
  rows,
  editable = false,
  timeEditMode = false,
  onTimeChange,
  onDelete,
  onAddSlot,
  onItemClick,
}: {
  globalStartMin: number;
  globalEndMin: number;
  rows: GanttRow[];
  editable?: boolean;
  timeEditMode?: boolean;
  onTimeChange?: (itemId: number, startMin: number, endMin: number) => void;
  onDelete?: (itemId: number) => void;
  onAddSlot?: (rowId: number) => void;
  onItemClick?: (itemId: number) => void;
}) {
  // Globale Zeitachse verwenden (nicht lokal berechnen!)
  const dayStart = globalStartMin;
  const dayEnd = globalEndMin;
  const span = Math.max(1, dayEnd - dayStart);

  // Sicherstellen dass hours-Array nicht explodiert (max 48 Stunden)
  const hours: number[] = [];
  const startHour = Math.floor(dayStart / 60);
  const endHour = Math.ceil(dayEnd / 60);
  if (endHour >= startHour && endHour - startHour <= 48) {
    for (let h = startHour; h <= endHour; h++) {
      hours.push(h);
    }
  }

  const [drag, setDrag] = useState<DragState | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: dayStart, end: dayEnd });
  const visibleRangeRef = useRef(visibleRange);
  useEffect(() => {
    visibleRangeRef.current = visibleRange;
  }, [visibleRange]);

  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Display range IMMER auf globale Zeitachse setzen (bei Props-Änderung)
  useEffect(() => {
    setVisibleRange({ start: dayStart, end: dayEnd });
  }, [globalStartMin, globalEndMin]);

  const handlePointerDown = (e: React.PointerEvent, item: GanttItem, type: 'start' | 'end' | 'move') => {
    if (!editable || !timeEditMode) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({
      pointerId: e.pointerId,
      itemId: item.id,
      type,
      origStart: item.startMin,
      origEnd: item.endMin,
      curStart: item.startMin,
      curEnd: item.endMin,
      startX: e.clientX,
      containerWidth: containerRef.current?.getBoundingClientRect().width || 600,
    });
  };

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      // Delta = Bewegung seit Drag-Start in Minuten.
      // Die Bar bewegt sich exakt so weit wie der Cursor – kein Offset nötig.
      const deltaMin = Math.round(((e.clientX - drag.startX) / drag.containerWidth) * span / GRID_MINUTES) * GRID_MINUTES;
      const gridDelta = deltaMin;

      let nextStart = drag.origStart + gridDelta;
      let nextEnd = drag.origEnd + gridDelta;

      if (drag.type === 'start') {
        nextEnd = drag.origEnd; // End bleibt fix
      } else if (drag.type === 'end') {
        nextStart = drag.origStart; // Start bleibt fix
      } else {
        const duration = drag.origEnd - drag.origStart;
        nextEnd = nextStart + duration;
      }

      // Kollisionsprüfung: Balken dürfen sich nicht überlappen
      if (drag.type === 'move') {
        let maxLeftShift = -1440;  // Maximale Verschiebung nach links (default: ganzer Tag)
        let maxRightShift = 1440;  // Maximale Verschiebung nach rechts (default: ganzer Tag)
        
        for (const row of rowsRef.current) {
          for (const other of row.items) {
            if (other.id === drag.itemId) continue;
            const otherStart = other.startMin;
            const otherEnd = other.endMin;
            
            // Wie weit darf ich nach links gehen? Begrenzt durch andere Balken die VOR meinem aktuellen Start liegen
            if (otherEnd <= drag.origStart) {
              maxLeftShift = Math.min(maxLeftShift, otherEnd - drag.origStart);
            }
            
            // Wie weit darf ich nach rechts gehen? Begrenzt durch andere Balken die NACH meinem aktuellen End liegen
            if (otherStart >= drag.origEnd) {
              maxRightShift = Math.max(maxRightShift, otherStart - drag.origEnd);
            }
          }
        }
        
        // Clamp: shift darf nicht links von maxLeftShift und nicht rechts von maxRightShift gehen
        const clampedDelta = Math.min(Math.max(gridDelta, maxLeftShift), maxRightShift);
        nextStart = drag.origStart + clampedDelta;
        nextEnd = drag.origEnd + clampedDelta;
      }

      // Begrenzen auf sinnvolle Werte + sicherstellen start < end
      nextStart = Math.max(0, Math.min(nextStart, 1439 - GRID_MINUTES));
      nextEnd = Math.max(nextStart + GRID_MINUTES, Math.min(nextEnd, 1440));

      // Grenzen während des Ziehens erweitern
      const ref = visibleRangeRef.current;
      let nextStartRange = ref.start;
      let nextEndRange = ref.end;
      let changed = false;
      if (nextStart < ref.start - 30) {
        nextStartRange = Math.max(0, Math.floor((ref.start - 120) / 60) * 60);
        changed = true;
      }
      if (nextEnd > ref.end + 30) {
        nextEndRange = Math.min(1440, Math.ceil((ref.end + 120) / 60) * 60);
        changed = true;
      }

      setDrag(prev => prev ? { ...prev, curStart: nextStart, curEnd: nextEnd } : null);
      if (changed) {
        setVisibleRange({ start: nextStartRange, end: nextEndRange });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const { itemId, origStart, origEnd, curStart, curEnd } = drag;
      
      // Zeitachse NICHT neu berechnen – globale Achse (globalStartMin/globalEndMin) hat Vorrang!
      setDrag(null);
      if (curStart !== origStart || curEnd !== origEnd) {
        onTimeChange?.(itemId, curStart, curEnd);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, dayStart, dayEnd, span, onTimeChange]);

  if (rows.length === 0) return null;

  const isDragging = (itemId: number) => drag?.itemId === itemId;

  // Zeit-Helfer: Minuten seit Mitternacht <-> "HH:MM"
  const minToTime = (min: number) => `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;

  // Dynamische Stunden berechnen
  const { start: dStart, end: dEnd } = visibleRange;
  const displayHours: number[] = [];
  const dispStartHour = Math.floor(dStart / 60);
  const dispEndHour = Math.ceil(dEnd / 60);
  if (dispEndHour >= dispStartHour && dispEndHour - dispStartHour <= 48) {
    for (let h = dispStartHour; h <= dispEndHour; h++) {
      displayHours.push(h);
    }
  }

  return (
    <div style={{ marginBottom: 32 }}>
      {/* Stunden-Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginLeft: 140, height: 24, borderBottom: '1px solid #ccc', position: 'relative' }}>
        {displayHours.map(h => (
          <div key={h} style={{ position: 'absolute', left: `${((h * 60 - dStart) / (dEnd - dStart)) * 100}%`, transform: 'translateX(-50%)', fontSize: 11, color: '#666', bottom: 4 }}>
            {h.toString().padStart(2, '0')}:00
          </div>
        ))}
      </div>

      <div style={{ position: 'relative', marginLeft: 140 }} ref={containerRef}>
        {/* Vertikale Rasterlinien */}
        <div style={{ position: 'absolute', top: 0, bottom: '100%', minHeight: rows.length * 38 + 16, left: 0, right: 0, pointerEvents: 'none' }}>
          {displayHours.map(h => (
            <div key={h} style={{ position: 'absolute', left: `${((h * 60 - dStart) / (dEnd - dStart)) * 100}%`, top: 0, bottom: 0, width: 1, background: '#e9ecef' }} />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {rows.map(row => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', height: 32, position: 'relative' }}>
              {/* Label links */}
              <div style={{ position: 'absolute', left: -140, width: 130, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.icon} {row.label}
              </div>

              {/* Add slot button */}
              {editable && timeEditMode && onAddSlot && (
                <div
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 100 }}
                  onPointerDown={e => e.stopPropagation()}
                >
                  <button
                    onClick={(e) => {
                      console.log('AddSlot clicked for row:', row.id);
                      onAddSlot(row.id);
                    }}
                    style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid #badbcc', background: '#d1e7dd', color: '#0f5132', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Neue Schicht hinzufügen"
                  >
                    +
                  </button>
                </div>
              )}

              {/* Balken-Hintergrund */}
              <div style={{ position: 'relative', width: '100%', height: '100%', background: 'rgba(241, 243, 245, 0.4)', borderRadius: 6 }}>
                {row.items.map(item => {
                  const st = isDragging(item.id) ? drag!.curStart : item.startMin;
                  const en = isDragging(item.id) ? drag!.curEnd : item.endMin;
                  const left = ((st - dStart) / (dEnd - dStart)) * 100;
                  const width = ((en - st) / (dEnd - dStart)) * 100;
                  const canDrag = editable && timeEditMode;

                  return (
                    <div
                      key={item.id}
                      className="gantt-item-wrapper"
                      onPointerDown={(e) => handlePointerDown(e, item, 'move')}
                      onClick={!canDrag && onItemClick ? () => onItemClick(item.id) : undefined}
                      style={{
                        position: 'absolute', left: `${left}%`, width: `${width}%`, top: 2, bottom: 2,
                        background: '#ffffff',
                        borderLeft: `4px solid ${row.color}`,
                        borderTop: item.isPending ? '2px dashed #fd7e14' : item.border || '1px solid #cbd5e1',
                        borderRight: item.isPending ? '2px dashed #fd7e14' : item.border || '1px solid #cbd5e1',
                        borderBottom: item.isPending ? '2px dashed #fd7e14' : item.border || '1px solid #cbd5e1',
                        borderRadius: 6,
                        boxShadow: isDragging(item.id) ? '0 8px 16px rgba(0,0,0,0.2)' : item.boxShadow || '0 2px 4px rgba(0,0,0,0.06)',
                        color: '#0f172a', fontSize: 11,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        whiteSpace: 'nowrap', padding: '0 6px', boxSizing: 'border-box',
                        cursor: isDragging(item.id) ? 'grabbing' : canDrag ? 'grab' : (onItemClick ? 'pointer' : 'default'),
                        opacity: isDragging(item.id) ? 0.9 : 1,
                        zIndex: isDragging(item.id) ? 50 : 1,
                        transition: isDragging(item.id) ? 'none' : 'left 0.15s, width 0.15s',
                        touchAction: canDrag ? 'none' : undefined
                      }}
                    >
                      {/* Custom Tooltip */}
                      <div className="gantt-item-tooltip">
                        {item.tooltip || `${minToTime(st)}–${minToTime(en)}`}
                      </div>

                      {canDrag && (
                        <div onPointerDown={(e) => handlePointerDown(e, item, 'start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 14, cursor: 'ew-resize', background: 'rgba(0,0,0,0.06)', borderRadius: '4px 0 0 4px', touchAction: 'none' }} title="Startzeit verschieben" />
                      )}

                      {/* Prominenter Auslastungs-Badge & dezentere Uhrzeit */}
                      {item.assignedCount != null && item.maxVolunteers != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', pointerEvents: 'none' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            padding: '1px 5px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 800,
                            background: item.assignedCount >= item.maxVolunteers ? '#dcfce7' : item.assignedCount > 0 ? '#fef3c7' : '#fee2e2',
                            color: item.assignedCount >= item.maxVolunteers ? '#15803d' : item.assignedCount > 0 ? '#b45309' : '#b91c1c',
                            border: `1px solid ${item.assignedCount >= item.maxVolunteers ? '#86efac' : item.assignedCount > 0 ? '#fde68a' : '#fca5a5'}`
                          }}>
                            {item.assignedCount >= item.maxVolunteers ? '✅' : item.assignedCount > 0 ? '🟡' : '⚠️'} {item.assignedCount}/{item.maxVolunteers}
                          </span>
                          {width > 12 && (
                            <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>
                              {minToTime(st)}–{minToTime(en)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 11, pointerEvents: 'none' }}>
                          {item.label || `${minToTime(st)}–${minToTime(en)}`}
                        </span>
                      )}

                      {canDrag && (
                        <div onPointerDown={(e) => handlePointerDown(e, item, 'end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 14, cursor: 'ew-resize', background: 'rgba(0,0,0,0.06)', borderRadius: '0 4px 4px 0', touchAction: 'none' }} title="Endzeit verschieben" />
                      )}

                      {/* Delete button – inside the bar */}
                      {canDrag && onDelete && width > 8 && (
                        <div
                          style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', zIndex: 70 }}
                          onPointerDown={e => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => {
                              onDelete(item.id);
                            }}
                            style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#dc3545', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(220,53,69,0.4)' }}
                            title="Entfernen"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
