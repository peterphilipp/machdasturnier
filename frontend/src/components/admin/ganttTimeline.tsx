import { useState, useRef, useEffect } from 'react';
import { BESETZUNG_FARBEN, besetzungsStufe, MAX_BESETZUNGS_PUNKTE } from './shared';

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
  /**
   * Eigene Flaechenfarbe statt der Zeilen-Toenung. Fuer Balken, die keine
   * Besetzung ausdruecken - etwa Zeitangebote, deren Farbe den Status meint.
   * Die Besetzungsfarbe hat weiterhin Vorrang, sonst waere die Kernaussage
   * des Dienstplans ueberschreibbar.
   */
  background?: string;
  /**
   * Zusatztext im Besetzungs-Balken, wo `label` nicht greift (dort rendert das
   * Gantt Punkte und Belegungszahl selbst). Ersetzt die Uhrzeit - die steht
   * ohnehin auf der Achse, waehrend etwa die Namen der Eingeplanten sonst
   * nirgends sichtbar waeren. Der Aufrufer entscheidet, ob der Balken dafuer
   * breit genug ist.
   */
  detail?: string;
}

export interface GanttRow {
  id: number;
  label: string;
  icon?: string;
  color: string;
  items: GanttItem[];
}

const GRID_MINUTES = 15;
/** Hoehe einer einzelnen Balkenspur. Eine Zeile ist so hoch wie ihre Spuren zusammen. */
const SPUR_HOEHE = 32;

/**
 * Verteilt die Balken einer Zeile auf Spuren, sodass sich gleichzeitige
 * Schichten nicht verdecken.
 *
 * Ein Arbeitsbereich kann zur selben Zeit mehrfach besetzt sein - zwei
 * Verkaufsstaende etwa laufen parallel und werden getrennt geplant. In einer
 * einzigen Spur laegen ihre Balken uebereinander: weder lesbar noch einzeln
 * anklickbar.
 *
 * Uebliches Gantt-Verfahren: nach Startzeit sortieren und jeden Balken in die
 * erste Spur legen, die zu diesem Zeitpunkt frei ist. Ueberschneidungsfreie
 * Schichten teilen sich damit weiterhin eine Spur, die Zeile bleibt so flach
 * wie moeglich.
 *
 * Bewusst auf den gespeicherten Zeiten gerechnet, nicht auf den gezogenen:
 * sonst wuerde ein Balken beim Ziehen die Spur wechseln und unter dem Finger
 * wegspringen.
 */
function verteileAufSpuren(items: GanttItem[]): { spurVon: Map<number, number>; anzahl: number } {
  const spurEnde: number[] = [];
  const spurVon = new Map<number, number>();

  for (const item of [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)) {
    let spur = spurEnde.findIndex(ende => ende <= item.startMin);
    if (spur === -1) {
      spur = spurEnde.length;
      spurEnde.push(item.endMin);
    } else {
      spurEnde[spur] = item.endMin;
    }
    spurVon.set(item.id, spur);
  }

  return { spurVon, anzahl: Math.max(1, spurEnde.length) };
}

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

export function getSoftTint(color: string, opacityPercent = 16): string {
  if (!color) return '#f1f5f9';
  if (color.startsWith('#') && color.length === 7) {
    const alphaHex = Math.round((opacityPercent / 100) * 255).toString(16).padStart(2, '0');
    return `${color}${alphaHex}`;
  }
  return color;
}

export function getSoftBorder(color: string, opacityPercent = 45): string {
  if (!color) return '#cbd5e1';
  if (color.startsWith('#') && color.length === 7) {
    const alphaHex = Math.round((opacityPercent / 100) * 255).toString(16).padStart(2, '0');
    return `${color}${alphaHex}`;
  }
  return color;
}

/**
 * Gefuellte und leere Punkte fuer "3 von 5 besetzt". Der Unterschied liegt in
 * der Form, nicht im Farbton - damit bleibt er auch bei Rot-Gruen-Schwaeche
 * lesbar, wo die Ampelfarbe allein nichts aussagt. Ab zu vielen Plaetzen
 * werden die Punkte zu klein zum Zaehlen; dann traegt die Zahl daneben allein.
 */
function BesetzungsPunkte({ belegt, max, farbe }: { belegt: number; max: number; farbe: string }) {
  if (max > MAX_BESETZUNGS_PUNKTE) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }} aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: i < belegt ? farbe : 'transparent',
          boxShadow: `inset 0 0 0 1px ${farbe}`
        }} />
      ))}
    </span>
  );
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
          {rows.map(row => {
            const rowTintBg = getSoftTint(row.color, 16);
            const rowBorderTint = getSoftBorder(row.color, 45);
            const { spurVon, anzahl: spurAnzahl } = verteileAufSpuren(row.items);

            return (
              <div key={row.id} style={{ display: 'flex', alignItems: 'center', height: spurAnzahl * SPUR_HOEHE, position: 'relative' }}>
                {/* Label links */}
                <div style={{ position: 'absolute', left: -140, width: 130, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.icon} {row.label}
                  {spurAnzahl > 1 && (
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{spurAnzahl} parallel</div>
                  )}
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

                {/* Balken-Hintergrund (Spur) */}
                <div style={{ position: 'relative', width: '100%', height: '100%', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 6 }}>
                  {row.items.map(item => {
                    const st = isDragging(item.id) ? drag!.curStart : item.startMin;
                    const en = isDragging(item.id) ? drag!.curEnd : item.endMin;
                    const left = ((st - dStart) / (dEnd - dStart)) * 100;
                    const width = ((en - st) / (dEnd - dStart)) * 100;
                    const canDrag = editable && timeEditMode;

                    // Die Flaeche traegt die Besetzung, nicht den Arbeitsbereich:
                    // welcher Bereich gemeint ist, steht links als Name und Symbol,
                    // die offene Frage beim Blick auf den Tag ist "wo fehlen Leute".
                    // Die Bereichsfarbe bleibt als Kante links, um eine Zeile quer
                    // durch das Diagramm verfolgen zu koennen.
                    const zeigtBesetzung = item.assignedCount != null && item.maxVolunteers != null;
                    const stufe = zeigtBesetzung
                      ? besetzungsStufe(item.assignedCount as number, item.maxVolunteers as number)
                      : null;
                    const farben = stufe ? BESETZUNG_FARBEN[stufe] : null;

                    return (
                      <div
                        key={item.id}
                        className="gantt-item-wrapper"
                        onPointerDown={(e) => handlePointerDown(e, item, 'move')}
                        onClick={!canDrag && onItemClick ? () => onItemClick(item.id) : undefined}
                        style={{
                          position: 'absolute', left: `${left}%`, width: `${width}%`,
                          top: (spurVon.get(item.id) ?? 0) * SPUR_HOEHE + 2,
                          height: SPUR_HOEHE - 4,
                          background: farben ? farben.flaeche : (item.background || rowTintBg),
                          border: item.isPending ? '2px dashed #fd7e14' : item.border || `1px solid ${farben ? farben.rand : rowBorderTint}`,
                          borderLeft: `4px solid ${row.color}`,
                          borderRadius: 6,
                          boxShadow: isDragging(item.id) ? '0 8px 16px rgba(0,0,0,0.18)' : '0 2px 4px rgba(0,0,0,0.06)',
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

                      {/* Besetzung zuerst, Uhrzeit nur wenn der Balken breit genug ist */}
                      {zeigtBesetzung && farben ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', pointerEvents: 'none' }}>
                          {/* Auf sehr schmalen Balken verdraengen die Punkte die Zahl,
                              und uebrig bleibt ein angeschnittenes "2/". Die Zahl
                              traegt die Aussage allein, die Punkte sind die Zugabe. */}
                          {width > 3 && (
                            <BesetzungsPunkte
                              belegt={item.assignedCount as number}
                              max={item.maxVolunteers as number}
                              farbe={farben.punkt}
                            />
                          )}
                          <span style={{ fontSize: 12, fontWeight: 700, color: farben.text, flexShrink: 0 }}>
                            {item.assignedCount}/{item.maxVolunteers}
                          </span>
                          {item.detail ? (
                            <span style={{ fontSize: 10, color: '#334155', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.detail}
                            </span>
                          ) : width > 18 && (
                            <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>
                              {minToTime(st)}–{minToTime(en)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{
                          fontWeight: 700, color: '#0f172a', fontSize: 11, pointerEvents: 'none',
                          // Nur die Beschriftung kappen, nicht den ganzen Balken: der
                          // Tooltip liegt ueber ihm und wuerde sonst mit abgeschnitten.
                          overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%'
                        }}>
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
          );
        })}
        </div>
      </div>
    </div>
  );
}
