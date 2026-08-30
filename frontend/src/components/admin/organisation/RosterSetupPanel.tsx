import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Tournament, TournamentWorkArea, TournamentDay, GlobalDayTemplate, Shift,
  btnStyle, inputStyle, tdStyle, thStyle, getTemplateDisplayName
} from '../shared';
import {
  getTournaments, getTournamentWorkAreas, syncTournamentWorkAreas, updateTournamentWorkArea,
  getTournamentDays, createTournamentDay, deleteTournamentDay,
  getDayTemplates, generateShifts, clearShifts,
  getDayWorkAreas, syncDayWorkAreas, updateDayWorkAreaTargetHelpers, removeDayWorkArea, addDayWorkArea,
  getShifts
} from '../../../api';
import { modal } from '../Modal';

type DayWorkAreasData = { active: Record<string, any>[]; all: Record<string, any>[] } | null;
interface DayWorkAreasCache {
  [dayId: number]: DayWorkAreasData;
}

const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);

function tournamentDateRange(tournament: Tournament | null | undefined): string[] {
  if (!tournament?.startDate || !tournament?.endDate) return [];
  const start = new Date(tournament.startDate);
  const end = new Date(tournament.endDate);
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const dates: string[] = [];
  while (cur <= endUTC) {
    dates.push(toDateOnly(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

const formatDateOption = (dateStr: string) =>
  new Date(dateStr + 'T00:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export default function RosterSetupPanel({
  selectedTournamentId,
  isMobile
}: {
  selectedTournamentId: number;
  isMobile: boolean;
}) {
  const queryClient = useQueryClient();
  const tid = selectedTournamentId;

  const [setupExpandedOverride, setSetupExpandedOverride] = useState<boolean | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [dayWorkAreasCache, setDayWorkAreasCache] = useState<DayWorkAreasCache>({});

  // Queries
  const { data: tournament } = useQuery<Tournament>({
    queryKey: ['tournament', tid],
    queryFn: async () => {
      const res = await getTournaments();
      return res.find((t: any) => t.id === tid) || null;
    },
    enabled: !!tid
  });

  const { data: areas = [] } = useQuery<TournamentWorkArea[]>({
    queryKey: ['t-work-areas', tid],
    queryFn: () => getTournamentWorkAreas(tid),
    enabled: !!tid
  });

  const { data: days = [] } = useQuery<TournamentDay[]>({
    queryKey: ['t-days', tid],
    queryFn: () => getTournamentDays(tid),
    enabled: !!tid
  });

  const { data: dayTemplates = [] } = useQuery<GlobalDayTemplate[]>({
    queryKey: ['day-templates'],
    queryFn: getDayTemplates
  });

  const { data: jobSlots = [] } = useQuery<Shift[]>({
    queryKey: ['shifts', tid],
    queryFn: () => getShifts(tid),
    enabled: !!tid
  });

  const hasShifts = jobSlots.length > 0;
  const setupExpanded = setupExpandedOverride !== null ? setupExpandedOverride : !hasShifts;

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Ein unerwarteter Fehler ist aufgetreten.' });
    }
  };

  const dayByDate = useMemo(() => {
    const m = new Map<string, TournamentDay>();
    for (const d of days) {
      if (d.date) {
        m.set(toDateOnly(new Date(d.date)), d);
      }
    }
    return m;
  }, [days]);

  const availableDates = useMemo(() => tournamentDateRange(tournament), [tournament]);

  const daysWithTypes = useMemo(() => days.filter(d => d.sourceTemplateId !== null), [days]);

  const fetchedDaysRef = useRef<Set<number>>(new Set());

  // Reset cache on tournament change
  useEffect(() => {
    setDayWorkAreasCache({});
    fetchedDaysRef.current.clear();
  }, [tid]);

  // Load day work areas details for all days with templates (active days)
  useEffect(() => {
    if (!daysWithTypes || daysWithTypes.length === 0) return;

    daysWithTypes.forEach(day => {
      if (fetchedDaysRef.current.has(day.id)) return;
      fetchedDaysRef.current.add(day.id);

      getDayWorkAreas(day.id).then(data => {
        setDayWorkAreasCache(prev => ({ ...prev, [day.id]: data }));
      }).catch(() => {
        // Remove from ref on failure to allow retry
        fetchedDaysRef.current.delete(day.id);
      });
    });
  }, [daysWithTypes]);

  // Synchronize target helpers if missing for day work areas
  const dayWorkAreasSynced = useMemo(() => {
    return daysWithTypes.every(d => dayWorkAreasCache[d.id] !== undefined);
  }, [daysWithTypes, dayWorkAreasCache]);

  const uniqueAreas = useMemo(() => {
    if (!dayWorkAreasSynced) return [];
    const set = new Set<string>();
    const list: { id: number; name: string; icon: string; order: number }[] = [];
    daysWithTypes.forEach(day => {
      const dayData = dayWorkAreasCache[day.id];
      const activeAreas = (dayData?.active || []).filter(a => a.active);
      activeAreas.forEach(a => {
        const key = `${a.tournamentWorkAreaId}`;
        if (!set.has(key)) {
          set.add(key);
          list.push({
            id: a.tournamentWorkAreaId,
            name: a.workArea?.name || '?',
            icon: a.workArea?.icon || '📍',
            order: a.workArea?.order ?? 0
          });
        }
      });
    });
    return list.sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.name.localeCompare(b.name);
    });
  }, [daysWithTypes, dayWorkAreasCache, dayWorkAreasSynced]);

  const handleDayTypeChange = async (dateStr: string, templateIdStr: string) => {
    if (!tid) return;
    const existing = dayByDate.get(dateStr);
    const templateId = templateIdStr ? Number(templateIdStr) : null;

    if (existing) {
      if (templateId === null) {
        const ok = await modal.confirm({
          title: 'Tag-Typ entfernen',
          message: 'Möchtest du den Tag-Typ entfernen? Dadurch verliert dieser Tag seine Zuordnung und alle zugehörigen Schichten werden gelöscht!',
          variant: 'danger'
        });
        if (!ok) return;
        guard(async () => {
          await deleteTournamentDay(existing.id);
          queryClient.invalidateQueries({ queryKey: ['t-days', tid] });
          queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
        });
      } else {
        const ok = await modal.confirm({
          title: 'Tag-Typ ändern',
          message: 'Achtung: Wenn du den Tag-Typ änderst, werden alle vorhandenen Schichten dieses Tages gelöscht und durch die neuen Slots der Vorlage ersetzt!',
          variant: 'warning'
        });
        if (!ok) return;
        guard(async () => {
          await deleteTournamentDay(existing.id);
          const created = await createTournamentDay({
            tournamentId: tid,
            date: new Date(dateStr).toISOString(),
            label: dayTemplates.find(t => t.id === templateId)?.name || null,
            order: availableDates.indexOf(dateStr),
            templateId
          });
          const syncResult = await syncDayWorkAreas(created.id);
          if (syncResult.added > 0) {
            queryClient.invalidateQueries({ queryKey: ['t-days', tid] });
          }
          queryClient.invalidateQueries({ queryKey: ['t-days', tid] });
          queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
        });
      }
    } else {
      if (templateId === null) return;
      guard(async () => {
        const tmpl = dayTemplates.find(t => t.id === templateId);
        const created = await createTournamentDay({
          tournamentId: tid,
          date: new Date(dateStr).toISOString(),
          label: tmpl?.name || null,
          order: availableDates.indexOf(dateStr),
          templateId
        });
        await syncDayWorkAreas(created.id);
        queryClient.invalidateQueries({ queryKey: ['t-days', tid] });
        queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
      });
    }
  };

  const handleSyncAreas = async () => {
    if (!tid) return;
    const result = await syncTournamentWorkAreas(tid);
    queryClient.invalidateQueries({ queryKey: ['t-work-areas', tid] });
    await modal.alert({ title: 'Synchronisiert', message: `${result.added} neue(r) Bereich(e) aus den Stammdaten hinzugefügt.` });
  };

  const doGenerate = () => guard(async () => {
    if (!tid) return;
    const res = await generateShifts(tid);
    const orphans: string[] = res.orphanedActiveAreas || [];
    const orphanNote = orphans.length > 0
      ? `\n\n⚠️ Aktiv, aber in keiner Tagesvorlage vorgesehen (keine Schichten erzeugt): ${orphans.join(', ')}. Ordne sie in „Tag-Vorlagen" einem Slot zu oder deaktiviere sie oben unter „Arbeitsbereiche dieses Turniers".`
      : '';
    await modal.alert({ title: 'Fertig', message: `${res.created} neue Schicht(en) erzeugt (${res.existing} bereits vorhanden).${orphanNote}` });
    queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
  });

  const doClear = () => guard(async () => {
    if (!tid) return;
    const volunteerAssignments = jobSlots.length;
    if (!(await modal.confirm({
      title: 'Schichten löschen',
      message: `Alle generierten Schichten dieses Turniers löschen (${volunteerAssignments} Stück), um sie neu zu konfigurieren? Bereits vorgenommene Helferzuweisungen gehen dabei verloren.`,
      variant: 'danger'
    }))) return;
    const res = await clearShifts(tid);
    await modal.alert({ title: 'Gelöscht', message: `${res.deletedShifts} Schicht(en) und ${res.deletedVolunteerShifts} Helferzuweisung(en) entfernt.` });
    queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
  });

  return (
    <div className="admin-core-style-111" style={{ marginBottom: 16 }}>
      <button
        onClick={() => setSetupExpandedOverride(!setupExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: setupExpanded ? '#f8f9fa' : 'transparent',
          border: setupExpanded ? '1px solid #e9ecef' : '1px dashed #ced4da',
          borderRadius: 8,
          cursor: 'pointer',
          color: '#495057',
          fontWeight: 600,
          fontSize: 14,
          transition: 'all 0.2s',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚙️</span>
          <span>Dienstplan-Generierung {setupExpanded ? 'ausblenden' : 'anzeigen'}</span>
        </div>
        <span style={{ fontSize: 18, color: '#adb5bd', transition: 'transform 0.2s', transform: setupExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
      </button>

      {setupExpanded && (
        <div className="admin-core-style-116">
          {/* Arbeitsbereiche — zwei Spalten: Aktiv (links) + Inaktiv (rechts) */}
          <section>
            <div className="admin-core-style-117">
              <h3 className="admin-core-style-118">🏪 Arbeitsbereiche dieses Turniers</h3>
              <span className="admin-core-style-119" />
              <button
                onClick={handleSyncAreas}
                style={{ ...btnStyle, background: '#e9ecef', color: '#495057' }}
              >
                🔄 Standard-Bereiche laden
              </button>
            </div>
            <p className="admin-core-style-120">
              💡 Standard-Bereiche werden automatisch aktiviert. In den Stammdaten → Arbeitsbereiche kannst du festlegen, welche Bereiche Standard sind.
            </p>

            {(() => {
              const activeAreas = areas.filter(a => a.active);
              const inactiveAreas = areas.filter(a => !a.active);
              return (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 80px 1fr', gap: 12, marginTop: 12 }}>
                  {/* Links: Aktiv (angeboten) */}
                  <div className="admin-core-style-121">
                    <div className="admin-core-style-122">✅ Aktiv (angeboten)</div>
                    {activeAreas.length === 0 ? (
                      <p className="admin-core-style-123">Noch keine Bereiche – klicke „Standard-Bereiche laden".</p>
                    ) : (
                      activeAreas.map(a => (
                        <div key={a.id} className="admin-core-style-124">
                          <span className="admin-core-style-125">{a.icon || '📍'} {a.name}</span>
                          <span className="admin-core-style-126" />
                          <button
                            onClick={() => guard(async () => {
                              await updateTournamentWorkArea(a.id, { active: false });
                              queryClient.invalidateQueries({ queryKey: ['t-work-areas', tid] });
                            })}
                            style={{ ...btnStyle, background: '#f8d7da', color: '#842029', fontSize: 12, minHeight: 26, padding: '2px 8px' }}
                            title="Deaktivieren"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Mitte: Pfeil */}
                  {!isMobile && (
                    <div className="admin-core-style-127">
                      <span className="admin-core-style-128">→</span>
                    </div>
                  )}

                  {/* Rechts: Inaktiv (Katalog) */}
                  {!isMobile && (
                    <div className="admin-core-style-129">
                      <div className="admin-core-style-130">⬜ Inaktiv (Katalog)</div>
                      {inactiveAreas.length === 0 ? (
                        <p className="admin-core-style-131">Alle Bereiche aktiv.</p>
                      ) : (
                        inactiveAreas.map(a => (
                          <div key={a.id} className="admin-core-style-132">
                            <span className="admin-core-style-133">{a.icon || '📍'} {a.name}</span>
                            <span className="admin-core-style-134" />
                            <button
                              onClick={() => guard(async () => {
                                await updateTournamentWorkArea(a.id, { active: true });
                                queryClient.invalidateQueries({ queryKey: ['t-work-areas', tid] });
                              })}
                              style={{ ...btnStyle, background: '#d1e7dd', color: '#0f5132', fontSize: 12, minHeight: 26, padding: '2px 8px' }}
                              title="Aktivieren"
                            >
                              ✓
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </section>

          {/* Tage */}
          <section>
            <h3 className="admin-core-style-135">📅 Turnier-Tage</h3>
            <p className="admin-core-style-136">
              {tournament && availableDates.length > 0
                ? <>Alle Kalendertage des Turniers (Stammdaten: <strong>{formatDateOption(availableDates[0])} – {formatDateOption(availableDates[availableDates.length - 1])}</strong>). Wähle je Tag einen Tag-Typ – die Zeit-Slots werden daraus übernommen.</>
                : 'Turnier wird geladen…'}
            </p>

            {availableDates.length === 0 ? (
              <p className="admin-core-style-137">Turnier hat keinen gültigen Zeitraum (Stammdaten prüfen).</p>
            ) : (
              <div className="admin-core-style-138">
                {/* Haupttabelle: pro Tag aufklappbar */}
                <table className="admin-core-style-139">
                  <thead>
                    <tr>
                      <th style={thStyle}>Turniertag</th>
                      <th style={thStyle}>Tag-Typ</th>
                      <th style={{ ...thStyle, textAlign: 'center', width: 80 }}>📊</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableDates.map((dateStr, idx) => {
                      const day = dayByDate.get(dateStr);
                      const isExpanded = expandedDays.has(`day-${day?.id || dateStr}`);
                      const data = day ? dayWorkAreasCache[day.id] : null;

                      return (
                        <Fragment key={dateStr}>
                          {/* Header-Zeile (aufklappbar) */}
                          <tr key={`${dateStr}-header`} className="admin-core-style-140"
                            onClick={() => {
                              if (!day) return;
                              const key = `day-${day.id}`;
                              setExpandedDays(prev => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              });
                            }}
                            style={{ cursor: day ? 'pointer' : 'default' }}
                          >
                            <td style={tdStyle}>
                              <span style={{ display: 'inline-block', width: 14, color: '#999', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 4 }}>{day ? '›' : ''}</span>
                              {formatDateOption(dateStr)}
                            </td>
                            <td style={tdStyle} onClick={e => e.stopPropagation()}>
                              <select
                                value={day?.sourceTemplateId ?? ''}
                                onChange={e => handleDayTypeChange(dateStr, e.target.value)}
                                style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, background: day ? '#e8f0fe' : '#fff' }}
                              >
                                <option value="">-- Kein Spieltag (Ruhetag) --</option>
                                {dayTemplates.map(t => (
                                  <option key={t.id} value={t.id}>{getTemplateDisplayName(t)}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold', color: day ? '#198754' : '#ccc' }}>
                              {day ? '✓' : '—'}
                            </td>
                          </tr>

                          {/* Detail-Zeile (nur wenn aufgeklappt und Daten da) */}
                          {isExpanded && day && (
                            <tr key={`${dateStr}-details`} className="admin-core-style-141">
                              <td colSpan={3} style={{ padding: '8px 16px', background: '#f8f9fa' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  <div className="admin-core-style-142">
                                    <strong className="admin-core-style-143">⚙️ Helferbedarf für {formatDateOption(dateStr)} ({day.label || 'Standard'})</strong>
                                    <span className="admin-core-style-144" />
                                    <button
                                      onClick={() => guard(async () => {
                                        const res = await syncDayWorkAreas(day.id);
                                        setDayWorkAreasCache(prev => {
                                          const next = { ...prev };
                                          delete next[day.id];
                                          return next;
                                        });
                                        await modal.alert({ title: 'Synchronisiert', message: `${res.added} neue(r) Bereich(e) hinzugefügt, ${res.removed} inaktive entfernt.` });
                                      })}
                                      style={{ ...btnStyle, background: '#fff', border: '1px solid #ced4da', color: '#495057', fontSize: 11, minHeight: 24, padding: '2px 8px' }}
                                      title="Aktivierte Bereiche für diesen Tag laden"
                                    >
                                      Bereiche synchronisieren
                                    </button>
                                  </div>

                                  {!data ? (
                                    <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Lade Bereiche...</p>
                                  ) : (data.active || []).length === 0 ? (
                                    <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Keine aktiven Bereiche an diesem Tag. Klicke „Bereiche synchronisieren".</p>
                                  ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                                      {(data.active || []).map((dwa: any) => (
                                        <div key={dwa.id} className="admin-core-style-145">
                                          <span className="admin-core-style-146">{dwa.workArea?.icon || '📍'} {dwa.workArea?.name}</span>
                                          <div className="admin-core-style-147">
                                            <input
                                              type="number"
                                              min="0"
                                              value={dwa.targetHelpers ?? 0}
                                              onChange={e => guard(async () => {
                                                const val = parseInt(e.target.value, 10) || 0;
                                                await updateDayWorkAreaTargetHelpers(dwa.id, val);
                                                setDayWorkAreasCache(prev => {
                                                  const next = { ...prev };
                                                  const dayData = next[day.id];
                                                  if (dayData) {
                                                    dayData.active = dayData.active.map((x: any) => x.id === dwa.id ? { ...x, targetHelpers: val } : x);
                                                  }
                                                  return next;
                                                });
                                              })}
                                              style={{ ...inputStyle, width: 50, padding: '2px 4px', fontSize: 12, textAlign: 'center' }}
                                            />
                                            <span style={{ fontSize: 11, color: '#666' }}>Helfer</span>
                                            <button
                                              onClick={() => guard(async () => {
                                                await removeDayWorkArea(dwa.id);
                                                setDayWorkAreasCache(prev => {
                                                  const next = { ...prev };
                                                  const dayData = next[day.id];
                                                  if (dayData) {
                                                    dayData.active = dayData.active.filter((x: any) => x.id !== dwa.id);
                                                  }
                                                  return next;
                                                });
                                              })}
                                              style={{ background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}
                                              title="Aus diesem Tag entfernen"
                                            >
                                              🗑️
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Neuen Bereich hinzufügen */}
                                  {data && (data.all || []).length > (data.active || []).length && (
                                    <div className="admin-core-style-148">
                                      <span className="admin-core-style-149">➕ Bereich hinzufügen:</span>
                                      <select
                                        value=""
                                        onChange={e => {
                                          const val = e.target.value;
                                          if (!val) return;
                                          guard(async () => {
                                            const areaId = Number(val);
                                            await addDayWorkArea(day.id, areaId);
                                            setDayWorkAreasCache(prev => {
                                              const next = { ...prev };
                                              delete next[day.id];
                                              return next;
                                            });
                                          });
                                        }}
                                        style={{ ...inputStyle, width: 'auto', padding: '2px 8px', fontSize: 12 }}
                                      >
                                        <option value="">-- Bereich auswählen --</option>
                                        {(data.all || []).filter((x: any) => !(data.active || []).some((y: any) => y.tournamentWorkAreaId === x.tournamentWorkAreaId)).map((x: any) => (
                                          <option key={x.id} value={x.tournamentWorkAreaId}>{x.icon} {x.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Matrix (Helferbedarf) */}
          {daysWithTypes.length > 0 && (
            <section>
              <div className="admin-core-style-150">
                <h3 className="admin-core-style-151">📊 Helferbedarf-Matrix</h3>
                <span className="admin-core-style-152" />
              </div>
              <p className="admin-core-style-153">
                Übersicht über den geplanten Helferbedarf an den aktiven Spieltagen. Die Bedarfe können direkt in den Tagen oben angepasst werden.
              </p>

              <div className="admin-core-style-154">
                <table className="admin-core-style-155">
                  <thead>
                    <tr className="admin-core-style-156">
                      <th style={thStyle}>Arbeitsbereich</th>
                      {daysWithTypes.map(day => (
                        <th key={day.id} style={thStyle}>
                          {new Date(day.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                          <div className="admin-core-style-157">({day.label})</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      if (!dayWorkAreasSynced) {
                        return (
                          <tr>
                            <td colSpan={daysWithTypes.length + 1} className="admin-core-style-170">
                              🔄 Daten werden geladen…
                            </td>
                          </tr>
                        );
                      }

                      const matrix: Record<string, Record<number, number>> = {};
                      daysWithTypes.forEach(day => {
                        const dayData = dayWorkAreasCache[day.id];
                        const activeAreas = (dayData?.active || []).filter(a => a.active);
                        activeAreas.forEach(a => {
                          const key = `${a.workArea?.icon || '📍'} ${a.workArea?.name || '?'}`;
                          if (!matrix[key]) matrix[key] = {};
                          matrix[key][day.id] = a.targetHelpers ?? 0;
                        });
                      });

                      if (uniqueAreas.length === 0) {
                        return (
                          <tr>
                            <td colSpan={daysWithTypes.length + 1} className="admin-core-style-171">
                              Keine aktiven Arbeitsbereiche für diese Tage.
                            </td>
                          </tr>
                        );
                      }

                      return uniqueAreas.map(area => {
                        return (
                          <tr key={area.id} className="admin-core-style-172">
                            <td className="admin-core-style-173">
                              {area.icon} {area.name}
                            </td>
                            {daysWithTypes.map(day => {
                              const dayData = dayWorkAreasCache[day.id];
                              const dva = (dayData?.active || []).find((x: any) => x.tournamentWorkAreaId === area.id && x.active);

                              if (!dva) {
                                return (
                                  <td key={day.id} className="admin-core-style-174" style={{ color: '#ccc' }}>
                                    —
                                  </td>
                                );
                              }

                              return (
                                <td key={day.id} className="admin-core-style-174" style={{ padding: '6px 4px' }}>
                                  <input
                                    type="number"
                                    min="0"
                                    value={dva.targetHelpers || ''}
                                    onChange={e => {
                                      const rawVal = e.target.value;
                                      const val = rawVal === '' ? 0 : (parseInt(rawVal, 10) || 0);

                                      // Optimistisches State-Update (sofortige Reaktion der UI & Summe)
                                      setDayWorkAreasCache(prev => {
                                        const next = { ...prev };
                                        const dayData = next[day.id];
                                        if (dayData) {
                                          dayData.active = dayData.active.map((x: any) => x.id === dva.id ? { ...x, targetHelpers: val } : x);
                                        }
                                        return next;
                                      });

                                      // API-Update im Hintergrund
                                      updateDayWorkAreaTargetHelpers(dva.id, val).catch(err => {
                                        console.error('Fehler beim Aktualisieren des Helferbedarfs:', err);
                                      });
                                    }}
                                    style={{
                                      width: 50,
                                      padding: '4px 6px',
                                      fontSize: 13,
                                      textAlign: 'center',
                                      border: '1px solid #ced4da',
                                      borderRadius: 6,
                                      background: (dva.targetHelpers ?? 0) > 0 ? '#e8f0fe' : '#fff',
                                      fontWeight: (dva.targetHelpers ?? 0) > 0 ? 'bold' : 'normal'
                                    }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="admin-core-style-176">
                      <td className="admin-core-style-177">
                        📊 Gesamtziel
                      </td>
                      {daysWithTypes.map(day => {
                        const dayData = dayWorkAreasCache[day.id];
                        const activeAreas = (dayData?.active || []).filter(a => a.active);
                        const sum = activeAreas.reduce((acc, dwa) => acc + Number(dwa.targetHelpers ?? 0), 0);
                        return (
                          <td key={day.id} className="admin-core-style-178">
                            {sum > 0 ? sum : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {/* Generieren */}
          <section>
            <div className="admin-core-style-179">
              <h3 className="admin-core-style-180">🧩 Schichten generieren</h3>
              <span className="admin-core-style-181" />
              {jobSlots.length > 0 && (
                <button style={{ ...btnStyle, background: '#f8d7da', color: '#842029' }} onClick={doClear}>Schichten löschen</button>
              )}
              <button style={{ ...btnStyle, background: '#0d6efd', color: '#fff' }} onClick={doGenerate}>Schichten generieren</button>
            </div>
            <p className="admin-core-style-182">
              „Schichten generieren" ist jederzeit gefahrlos erneut klickbar: bereits erzeugte Schichten
              und Helferzuweisungen bleiben unangetastet, es werden nur die Kombinationen aus (neuem)
              Arbeitsbereich und Zeit-Slot ergänzt, die es noch nicht gibt. Feinschliff der Zeiten,
              Helfer einplanen und einzelne Schichten entfernen geschieht weiter unten in der
              Tages-Übersicht – oder direkt über „➕ Schicht" bei jedem Tag.
            </p>
            {jobSlots.length === 0 && <div className="admin-core-style-183" style={{ lineHeight: 1.6 }}><strong>Noch keine Schichten im Dienstplan.</strong><br />So kommst du hin: oben die <strong>Arbeitsbereiche</strong> für dieses Turnier festlegen, dann die <strong>Turniertage</strong> aus einer Tagesvorlage anlegen – und zuletzt „Schichten generieren". Danach ziehst du die Zeiten im Diagramm zurecht und planst die Helfer ein.</div>}
          </section>
        </div>
      )}

    </div>
  );
}
