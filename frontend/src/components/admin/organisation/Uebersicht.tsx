import { useMemo, useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Shift, VolunteerShift, TournamentWorkArea, TournamentDay, Tournament, WorkArea, minToTime, timeToMin } from '../shared';
import {
  getShifts, getVolunteerShifts, getVolunteers, updateShiftsBatch, updateShift,
  getTournamentWorkAreas, getTournamentDays, addDaySlot, getWorkAreas, adoptTournamentWorkArea,
  exportDayToTemplate, createShift, apiDelete, apiPost, getTournaments
} from '../../../api';
import { modal } from '../Modal';
import { btnStyle, inputStyle, tdStyle, thStyle } from '../shared';
import ShiftFeedbackModal from './ShiftFeedbackModal';
import ShiftTimeline from './ShiftTimeline';
import RosterSetupPanel from './RosterSetupPanel';
import StationPrintModal from './StationPrintModal';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export default function Uebersicht({ selectedTournament }: { selectedTournament: number | null }) {
  const [showPrintModal, setShowPrintModal] = useState(false);
  const queryClient = useQueryClient();
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [selectedVolunteerToAssign, setSelectedVolunteerToAssign] = useState<number | ''>('');
  const [assigning, setAssigning] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Editiermodus für Zeiten: Änderungen werden lokal gesammelt (keyed by
  // Shift-ID) und erst per Commit als eine Business-Transaktion übernommen.
  const [timeEditMode, setTimeEditMode] = useState(false);
  const [pendingTimeChanges, setPendingTimeChanges] = useState<Record<number, { startMin: number; endMin: number }>>({});
  const [committing, setCommitting] = useState(false);
  const pendingCount = Object.keys(pendingTimeChanges).length;

  // Turnierwechsel: offene, nicht committete Änderungen würden sich sonst auf
  // Shift-IDs eines nicht mehr sichtbaren Turniers beziehen.
  useEffect(() => {
    setTimeEditMode(false);
    setPendingTimeChanges({});
  }, [selectedTournament]);

  const tid = selectedTournament;

  const { data: allVolunteers = [] } = useQuery<any[]>({
    queryKey: ['volunteers', selectedTournament],
    queryFn: () => getVolunteers(selectedTournament),
    enabled: !!selectedTournament
  });

  const { data: jobSlots = [], isLoading: busySlots } = useQuery<Shift[]>({
    queryKey: ['shifts', selectedTournament],
    queryFn: () => getShifts(selectedTournament),
    enabled: !!selectedTournament,
    refetchInterval: 10000 // alle 10 Sekunden automatisch aktualisieren
  });

  const { data: volunteerShifts = [], isLoading: busyVolShifts } = useQuery<VolunteerShift[]>({
    queryKey: ['volunteerShifts', selectedTournament],
    queryFn: () => getVolunteerShifts(selectedTournament),
    enabled: !!selectedTournament,
    refetchInterval: 5000 // alle 5 Sekunden automatisch aktualisieren
  });

  const { data: areas = [] } = useQuery<TournamentWorkArea[]>({ queryKey: ['t-work-areas', tid], queryFn: () => getTournamentWorkAreas(tid), enabled: !!tid });
  const { data: days = [] } = useQuery<TournamentDay[]>({ queryKey: ['t-days', tid], queryFn: () => getTournamentDays(tid), enabled: !!tid });
  const { data: tournaments = [] } = useQuery<Tournament[]>({ queryKey: ['tournaments'], queryFn: getTournaments });
  const currentTournament = useMemo(() => tournaments.find(t => t.id === tid) || null, [tournaments, tid]);
  // Der Stammdaten-Katalog: damit "➕ Schicht" auch Bereiche anbieten kann,
  // die dieses Turnier noch nicht kennt.
  const { data: catalogAreas = [] } = useQuery<WorkArea[]>({ queryKey: ['work-areas'], queryFn: getWorkAreas, enabled: !!tid });

  /** Einheitliche Fehlerbehandlung für Setup-Mutationen (401 -> klarer Hinweis, kein Uncaught). */
  const guard = async (fn: () => Promise<void>) => {
    try { await fn(); }
    catch (err: unknown) { const e = err as Record<string, any>;
      await modal.alert({
        title: e?.status === 401 ? 'Sitzung abgelaufen' : 'Fehler',
        message: e?.status === 401
          ? 'Bitte melde dich neu an – dein Token ist ungültig oder abgelaufen.'
          : (e.message || 'Aktion fehlgeschlagen')
      });
    }
  };

  const doExportTemplate = useCallback(async (day: TournamentDay) => {
    const dayShifts = jobSlots.filter(s => (s as Record<string, any>).tournamentDayId === day.id);
    if (dayShifts.length === 0) {
      await modal.alert({ title: 'Hinweis', message: 'Für diesen Tag existieren keine Schichten, die als Vorlage exportiert werden könnten.' });
      return;
    }

    const res = await modal.form({
      title: '✨ Als neue Tagesvorlage speichern',
      fields: [
        { key: 'name', label: 'Name der neuen Vorlage', type: 'text', placeholder: 'z.B. Samstag - Optimierter Zeitplan', defaultValue: `${day.label || 'Turniertag'} - Optimiert` },
        { key: 'description', label: 'Beschreibung / Notiz (optional)', type: 'text', placeholder: 'z.B. Angepasste Aufbauzeiten aus dem Sommerturnier' }
      ]
    });

    if (!res || !res.name || !String(res.name).trim()) return;

    guard(async () => {
      const created = await exportDayToTemplate(day.id, {
        name: String(res.name).trim(),
        description: res.description ? String(res.description).trim() : undefined
      });
      queryClient.invalidateQueries({ queryKey: ['day-templates'] });
      await modal.alert({
        title: 'Vorlage gespeichert 🚀',
        message: `Die Vorlage „${created.name}“ wurde erfolgreich im Katalog unter Stammdaten angelegt und kann ab sofort für zukünftige Turniere verwendet werden!`
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobSlots, queryClient]);

/**
   * Fragt eine Uhrzeit ab und liefert das passende Zeitfenster des Tages -
   * oder null, wenn abgebrochen oder Unsinn eingegeben wurde.
   *
   * addDaySlot ist idempotent: Gibt es das Fenster zu dieser Uhrzeit schon,
   * kommt das bestehende zurück statt eines zweiten mit gleicher Zeit.
   */
  const erfrageNeueZeit = async (day: TournamentDay, bereichName?: string): Promise<number | null> => {
    const res = await modal.form({
      title: '⏰ Neue Zeit für diesen Tag',
      message: bereichName
        ? `„${bereichName}" ist an diesem Tag bereits in jedem Zeitfenster eingeplant. Für eine weitere Schicht braucht es eine neue Zeit.`
        : undefined,
      fields: [
        { key: 'start', label: 'Start (HH:MM)', type: 'text', placeholder: '10:30' },
        { key: 'end', label: 'Ende (HH:MM)', type: 'text', placeholder: '13:00' }
      ]
    });
    if (!res || !res.start || !res.end) return null;

    const startMin = timeToMin(String(res.start));
    const endMin = timeToMin(String(res.end));
    if (Number.isNaN(startMin) || Number.isNaN(endMin) || endMin <= startMin) {
      await modal.alert({ title: 'Hinweis', message: 'Bitte gültige Uhrzeiten im Format HH:MM angeben, Ende nach Start.' });
      return null;
    }

    const slot = await addDaySlot({ tournamentDayId: day.id, startMin, endMin, label: null });
    queryClient.invalidateQueries({ queryKey: ['t-days', tid] });
    return slot.id;
  };

  /**
   * "+ Schicht hinzufügen" pro Tag: bewusst nicht auf generateShifts()
   * gestützt, weil das den Fall nicht abdeckt, dass ein Arbeitsbereich an
   * diesem Tag schon eine Schicht hat, aber eine WEITERE (andere Zeit)
   * gebraucht wird - generateShifts() erzeugt nur Katalog-Kombinationen, die
   * es noch nie gab, und ist zudem an die Tagesvorlagen-Zuordnung gebunden.
   *
   * Die Bereichsliste enthält auch Bereiche, die es in diesem Turnier noch gar
   * nicht gibt. Sonst müsste man für einen einzelnen nachgemeldeten Bereich
   * ("wir brauchen doch noch Fußballgolf") erst in den Generator, dort den
   * Katalog synchronisieren und den Tag neu erzeugen lassen - für eine einzige
   * Schicht ein unverhältnismäßiger Umweg. Wird so ein Bereich gewählt, holt
   * ihn adoptTournamentWorkArea vorher ins Turnier.
   *
   * Gefragt wird nur nach dem Arbeitsbereich. Die Schicht landet im mittleren
   * Zeitfenster des Tages und wird danach im Gantt-Diagramm an ihren Platz
   * gezogen - das ist ohnehin der Weg, auf dem der Tag geplant wird. Eine
   * Uhrzeit im Dialog abzufragen hiesse, dieselbe Entscheidung zweimal zu
   * treffen. Auf dem Handy gibt es das Gantt nicht; dort hat jede Schichtkarte
   * einen eigenen "⏰ Zeit"-Knopf.
   */
  const addShiftToDay = (day: TournamentDay) => guard(async () => {
    if (!tid) return;
    const activeAreas = areas.filter(a => a.active);

    // Katalog-Bereiche, die in diesem Turnier noch fehlen oder deaktiviert sind.
    const aktiveHerkunft = new Set(activeAreas.map(a => a.sourceWorkAreaId).filter((v): v is number => v != null));
    const aktiveNamen = new Set(activeAreas.map(a => a.name));
    const zusaetzlich = catalogAreas.filter(w => !w.isObsolete && !aktiveHerkunft.has(w.id) && !aktiveNamen.has(w.name));

    if (activeAreas.length === 0 && zusaetzlich.length === 0) {
      await modal.alert({ title: 'Hinweis', message: 'Es gibt noch keine Arbeitsbereiche. Lege sie erst unter „Stammdaten → Arbeitsbereiche" an.' });
      return;
    }

    const areaOptions = [
      ...activeAreas.map(a => ({ value: `t:${a.id}`, label: `${a.icon} ${a.name}` })),
      ...zusaetzlich.map(w => ({ value: `k:${w.id}`, label: `${w.icon} ${w.name} — neu ins Turnier holen` }))
    ];

    const res = await modal.form({
      title: '➕ Schicht zu diesem Tag hinzufügen',
      message: 'Die Schicht wird mittig in den Tag gelegt. Die genaue Zeit ziehst du danach im Diagramm zurecht.',
      fields: [
        { key: 'areaId', label: 'Arbeitsbereich', type: 'select', options: areaOptions }
      ]
    });
    if (!res || !res.areaId) return;

    // Bereich aus dem Katalog? Dann zuerst ins Turnier übernehmen.
    let areaId: number;
    let area: { name: string } | undefined;
    const wahl = String(res.areaId);
    if (wahl.startsWith('k:')) {
      const katalogId = Number(wahl.slice(2));
      const uebernommen = await adoptTournamentWorkArea(tid, katalogId);
      areaId = uebernommen.id;
      area = uebernommen;
      queryClient.invalidateQueries({ queryKey: ['t-work-areas', tid] });
    } else {
      areaId = Number(wahl.slice(2));
      area = activeAreas.find(a => a.id === areaId);
    }

    // Mittiges Zeitfenster, in dem dieser Arbeitsbereich noch keine Schicht hat.
    const fenster = [...(day.slots || [])].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const dayShifts = jobSlots.filter((sh: Record<string, any>) => sh.tournamentDayId === day.id);
    const belegt = (slotId: number) => dayShifts.some((sh: Record<string, any>) =>
      sh.daySlotId === slotId && (sh.tournamentWorkAreaId === areaId || sh.arbeitsbereichId === areaId));
    let daySlotId: number;

    if (fenster.length > 0) {
      const tagStart = Math.min(...fenster.map(s => s.startMin));
      const tagEnde = Math.max(...fenster.map(s => s.endMin));
      const mitte = (tagStart + tagEnde) / 2;

      const verfuegbareFenster = fenster.filter(s => !belegt(s.id));

      if (verfuegbareFenster.length > 0) {
        const mittigstes = verfuegbareFenster.reduce((best, s) =>
          Math.abs((s.startMin + s.endMin) / 2 - mitte) < Math.abs((best.startMin + best.endMin) / 2 - mitte) ? s : best
        );
        daySlotId = mittigstes.id;
      } else {
        // Dieser Bereich steht bereits in JEDEM Zeitfenster des Tages. Ein
        // weiteres automatisch zu setzen ginge schief: addDaySlot ist idempotent
        // und liefert bei bekannter Uhrzeit das bestehende Fenster zurück - die
        // Schicht landete also ein zweites Mal dort, wo es sie schon gibt.
        // Hier fehlt schlicht die Information, also wird sie erfragt. Der
        // einzige Fall, in dem der Dialog nach einer Zeit fragt.
        const neueZeit = await erfrageNeueZeit(day, area?.name);
        if (neueZeit == null) return;
        daySlotId = neueZeit;
      }
    } else {
      // Ein Tag ohne jedes Zeitfenster (ohne Vorlage angelegt) braucht erst eins.
      const gewaehlt = activeAreas.find(a => a.id === areaId);
      const startMin = gewaehlt?.operatingStartMin ?? 600;
      const endMin = gewaehlt?.operatingEndMin ?? 840;
      const neu = await addDaySlot({ tournamentDayId: day.id, startMin, endMin, label: null });
      daySlotId = neu.id;
      queryClient.invalidateQueries({ queryKey: ['t-days', tid] });
    }

    // Letzte Sperre gegen die doppelte Schicht - greift auch, wenn die oben
    // benutzte Schichtliste aus dem Cache veraltet war.
    if (belegt(daySlotId)) {
      const f = fenster.find(s => s.id === daySlotId);
      await modal.alert({
        title: 'Gibt es schon',
        message: `„${area?.name}" ist an diesem Tag${f ? ` von ${minToTime(f.startMin)} bis ${minToTime(f.endMin)}` : ''} bereits eingeplant. `
          + 'Wähle eine andere Zeit, oder erhöhe die Helferzahl der bestehenden Schicht.'
      });
      return;
    }

    try {
      await createShift({ tournamentId: tid, tournamentDayId: day.id, daySlotId, tournamentWorkAreaId: areaId });
      queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
      await modal.alert({ title: 'Hinzugefügt ✅', message: `Schicht für „${area?.name}" wurde angelegt.` });
    } catch (err: unknown) { const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Schicht konnte nicht angelegt werden.' });
    }
  });

  /**
   * Zeit einer einzelnen Schicht per Dialog setzen.
   *
   * Auf dem Desktop zieht man die Ränder im Gantt-Diagramm; auf dem Handy gibt
   * es das Diagramm nicht, dort wäre eine Schicht sonst unveränderlich auf der
   * Zeit festgenagelt, mit der sie angelegt wurde. Speichert direkt (nicht über
   * den Sammel-Editiermodus), weil hier immer nur eine Schicht betroffen ist.
   */
  const editShiftTime = (shift: Record<string, any>) => guard(async () => {
    const aktStart = shift.startMin ?? shift.daySlot?.startMin ?? 0;
    const aktEnde = shift.endMin ?? shift.daySlot?.endMin ?? 0;
    const name = shift.workArea?.name || shift.arbeitsbereich?.name || 'Schicht';

    const res = await modal.form({
      title: `⏰ Zeit für „${name}"`,
      fields: [
        { key: 'start', label: 'Start (HH:MM)', type: 'text', defaultValue: minToTime(aktStart) },
        { key: 'end', label: 'Ende (HH:MM)', type: 'text', defaultValue: minToTime(aktEnde) }
      ]
    });
    if (!res || !res.start || !res.end) return;

    const startMin = timeToMin(String(res.start));
    const endMin = timeToMin(String(res.end));
    if (Number.isNaN(startMin) || Number.isNaN(endMin) || endMin <= startMin) {
      await modal.alert({ title: 'Hinweis', message: 'Bitte gültige Uhrzeiten im Format HH:MM angeben, Ende nach Start.' });
      return;
    }
    if (startMin === aktStart && endMin === aktEnde) return;

    await updateShift(shift.id, { startMin, endMin });
    queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
    await modal.alert({
      title: 'Gespeichert ✅',
      message: `„${name}" läuft jetzt von ${minToTime(startMin)} bis ${minToTime(endMin)}. Bereits eingeplante Helfer werden über die neue Zeit informiert.`
    });
  });

  /**
   * Zeiten einer Schicht anpassen. Zeit-Änderungen laufen über einen expliziten
   * Editiermodus statt sofort bei jedem Ziehen zu speichern: mehrere
   * Anpassungen (z. B. eine Schicht verkürzen, weil eine andere verlängert
   * wird) werden gesammelt und erst per Commit als eine Transaktion
   * übernommen. Das vermeidet einen Zwischenzustand, der später unnötige/
   * widersprüchliche Benachrichtigungen an eingeplante Helfer auslösen würde.
   */
  const handleStageShiftTime = (shiftId: number, startMin: number, endMin: number) => {
    setPendingTimeChanges(prev => ({ ...prev, [shiftId]: { startMin, endMin } }));
  };

  const handleDiscardTimeChanges = async () => {
    if (pendingCount > 0) {
      const ok = await modal.confirm({
        title: 'Änderungen verwerfen?',
        message: `${pendingCount} ungespeicherte Zeit-Änderung${pendingCount === 1 ? '' : 'en'} ${pendingCount === 1 ? 'geht' : 'gehen'} verloren.`,
        confirmText: 'Verwerfen',
        cancelText: 'Zurück',
        variant: 'warning'
      });
      if (!ok) return;
    }
    setPendingTimeChanges({});
    setTimeEditMode(false);
  };

  const handleCommitTimeChanges = async () => {
    if (pendingCount === 0) {
      setTimeEditMode(false);
      return;
    }
    const ok = await modal.confirm({
      title: 'Zeiten übernehmen?',
      message: `${pendingCount} Schicht${pendingCount === 1 ? '' : 'en'} ${pendingCount === 1 ? 'wird' : 'werden'} mit neuer Zeit gespeichert. Eingeplante Helfer sehen die neue Zeit im Dienstplan.`,
      confirmText: 'Übernehmen',
      cancelText: 'Abbrechen'
    });
    if (!ok) return;

    setCommitting(true);
    try {
      const changes = Object.entries(pendingTimeChanges).map(([id, c]) => ({ id: Number(id), ...c }));
      await updateShiftsBatch(changes);
      queryClient.invalidateQueries({ queryKey: ['shifts', selectedTournament] });
      setPendingTimeChanges({});
      setTimeEditMode(false);
      await modal.alert({ title: 'Gespeichert ✅', message: `${changes.length} Schicht${changes.length === 1 ? '' : 'en'} aktualisiert.` });
    } catch (err: unknown) { const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Änderungen konnten nicht gespeichert werden. Es wurde nichts übernommen.' });
    } finally {
      setCommitting(false);
    }
  };

  if (!selectedTournament) {
    return (
      <div style={{ padding: 48, textAlign: 'center', background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
        <div className="admin-core-style-107">📊</div>
        <div className="admin-core-style-108">Bitte ein Turnier auswählen</div>
        <div className="admin-core-style-109">Wähle oben ein Turnier aus, um die Übersicht zu sehen</div>
      </div>
    );
  }

  if (busySlots || busyVolShifts) {
    return <div className="admin-core-style-110">⏳ Lade Daten...</div>;
  }

  const grouped: Record<string, Record<string, any>[]> = {};
  [...jobSlots].sort((a: Record<string, any>, b: Record<string, any>) => {
    const dateA = a.day?.date || a.date;
    const dateB = b.day?.date || b.date;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  }).forEach((slot: Record<string, any>) => {
    const dateVal = slot.day?.date || slot.date;
    const dateKey = new Date(dateVal).toLocaleDateString('de-DE');
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(slot);
  });

  const unbesetzteSlots = jobSlots.filter(s => {
    const count = volunteerShifts.filter(vs => vs.shiftId === s.id).length;
    return count < s.maxVolunteers;
  });

  return (
    <div style={{ background: '#fff', padding: 24, borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
      {tid && (
        <RosterSetupPanel
          selectedTournamentId={tid}
          isMobile={isMobile}
        />
      )}

      {jobSlots.length > 0 && (
        <>
          {/* Offene Punkte Widget */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
            {unbesetzteSlots.length > 0 ? (
              <div className="admin-core-style-184">
                <div className="admin-core-style-185">⚠️ <strong className="admin-core-style-186">{unbesetzteSlots.length} unbesetzte Job-Slots</strong></div>
                <p className="admin-core-style-187">Es fehlen noch Helfer in verschiedenen Schichten.</p>
              </div>
            ) : (
              <div className="admin-core-style-188">
                <div className="admin-core-style-189">✅ <strong className="admin-core-style-190">Alle Job-Slots besetzt!</strong></div>
                <p className="admin-core-style-191">Gute Arbeit!</p>
              </div>
            )}
          </div>

          {/* Editiermodus-Toolbar: Zeiten sind standardmäßig gesperrt (nur Helfer
              ein-/ausplanen ist ohne Umschalten möglich). Erst hier freigeschaltet
              lassen sich Balken ziehen; verlassen geht nur über Commit oder Verwerfen. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            marginBottom: 32, padding: '10px 16px', borderRadius: 10,
            background: timeEditMode ? '#fff3cd' : '#f8f9fa',
            border: `1px solid ${timeEditMode ? '#ffe69c' : '#dee2e6'}`
          }}>
            {!timeEditMode ? (
              <>
                <span className="admin-core-style-192">🔒 Schicht-Zeiten sind gesperrt</span>
                <button
                  onClick={() => setTimeEditMode(true)}
                  className="admin-core-style-193"
                >
                  ✏️ Zeiten bearbeiten
                </button>
                <button
                  onClick={() => setShowPrintModal(true)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #0d6efd',
                    background: '#0d6efd',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  🖨️ Stationszettel (PDF)
                </button>
              </>
            ) : (
              <>
                <span className="admin-core-style-194">✏️ Bearbeitungsmodus aktiv – Ränder ziehen zum Anpassen</span>
                <span className="admin-core-style-195">
                  {pendingCount === 0 ? 'Noch keine Änderungen' : `${pendingCount} Änderung${pendingCount === 1 ? '' : 'en'} ausstehend`}
                </span>
                <span className="admin-core-style-196" />
                <button
                  onClick={handleDiscardTimeChanges}
                  disabled={committing}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ced4da', background: '#fff', color: '#495057', fontWeight: 600, cursor: committing ? 'not-allowed' : 'pointer', fontSize: 13, opacity: committing ? 0.6 : 1 }}
                >
                  ✖️ Verwerfen
                </button>
                <button
                  onClick={handleCommitTimeChanges}
                  disabled={committing}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#198754', color: '#fff', fontWeight: 600, cursor: committing ? 'not-allowed' : 'pointer', fontSize: 13, opacity: committing ? 0.6 : 1 }}
                >
                  {committing ? '...' : `✅ Übernehmen${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                </button>
              </>
            )}
          </div>

          {(() => {
            let globalStartMin = 1440;
            let globalEndMin = 0;
            jobSlots.forEach((s: Record<string, any>) => {
              const st = s.startMin ?? s.daySlot?.startMin ?? 480;
              const en = s.endMin ?? s.daySlot?.endMin ?? 1080;
              globalStartMin = Math.min(globalStartMin, st);
              globalEndMin = Math.max(globalEndMin, en);
            });
            if (globalStartMin > globalEndMin) {
              globalStartMin = 480;
              globalEndMin = 1080;
            }

            return Object.entries(grouped).map(([dateStr, slots]) => {
              const firstSlot = slots[0];
              const firstDate = new Date(firstSlot.day?.date || firstSlot.date);
              const dayName = firstDate.toLocaleDateString('de-DE', { weekday: 'long' });
              const tournamentDay = days.find(d => new Date(d.date).toLocaleDateString('de-DE') === dateStr);
              slots.sort((a: Record<string, any>, b: Record<string, any>) => {
                const timeDiff = (a.startMin ?? a.daySlot?.startMin ?? 0) - (b.startMin ?? b.daySlot?.startMin ?? 0);
                if (timeDiff !== 0) return timeDiff;
                const orderA = a.workArea?.order ?? a.arbeitsbereich?.order ?? 9999;
                const orderB = b.workArea?.order ?? b.arbeitsbereich?.order ?? 9999;
                if (orderA !== orderB) return orderA - orderB;
                const nameA = a.workArea?.name || a.arbeitsbereich?.name || '';
                const nameB = b.workArea?.name || b.arbeitsbereich?.name || '';
                return nameA.localeCompare(nameB);
              });
              const totalHelfer = slots.reduce((sum: number, s: Record<string, any>) => sum + volunteerShifts.filter(vs => vs.shiftId === s.id).length, 0);
              const isExpanded = expandedDays.has(dateStr);

              if (isMobile) {
                // Mobile: aufklappbares Accordion pro Tag
                return (
                  <div key={dateStr} className="admin-core-style-197">
                    <button
                      onClick={() => {
                        setExpandedDays(prev => {
                          const next = new Set(prev);
                          if (next.has(dateStr)) next.delete(dateStr);
                          else next.add(dateStr);
                          return next;
                        });
                      }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: isExpanded ? '#0d6efd' : '#f8f9fa', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8 }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: isExpanded ? '#fff' : '#212529' }}>📅 {dateStr} – {dayName}</div>
                        <div style={{ fontSize: 12, color: isExpanded ? 'rgba(255,255,255,0.8)' : '#6c757d', marginTop: 2 }}>{slots.length} Schichten · {totalHelfer} Helfer zugewiesen</div>
                      </div>
                      <span style={{ fontSize: 20, color: isExpanded ? '#fff' : '#6c757d', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
                    </button>
                    {isExpanded && (
                      <div className="admin-core-style-198">
                        {tournamentDay && (
                          <div className="admin-core-style-199">
                            <button style={{ ...btnStyle, background: '#e7f1ff', color: '#0d6efd', fontSize: 12, minHeight: 32, padding: '4px 10px' }} onClick={() => addShiftToDay(tournamentDay)}>➕ Schicht</button>
                            <button style={{ ...btnStyle, background: '#e2e3e5', color: '#383d41', fontSize: 12, minHeight: 32, padding: '4px 10px' }} onClick={() => doExportTemplate(tournamentDay)}>✨ Als Vorlage</button>
                          </div>
                        )}
                        {slots.map((s: Record<string, any>) => {
                          const assigned = volunteerShifts.filter(vs => vs.shiftId === s.id);
                          const startMin = s.startMin ?? s.daySlot?.startMin ?? 0;
                          const endMin = s.endMin ?? s.daySlot?.endMin ?? 0;
                          const areaName = (s.workArea?.name || s.arbeitsbereich?.name || 'Schicht');
                          const areaIcon = (s.workArea?.icon || s.arbeitsbereich?.icon || '📌');
                          const count = assigned.length;
                          const max = s.maxVolunteers || 1;
                          const isFull = count >= max;
                          const isPartial = count > 0 && count < max;

                          return (
                            <div key={s.id} className="admin-core-style-200" style={{ borderLeft: `4px solid ${s.workArea?.color || s.arbeitsbereich?.color || '#3b98f8'}` }}>
                              <div className="admin-core-style-201">
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                    <span className="admin-core-style-202">{areaIcon} {areaName}</span>
                                    <span style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontWeight: 800,
                                      background: isFull ? '#dcfce7' : isPartial ? '#fef3c7' : '#fee2e2',
                                      color: isFull ? '#15803d' : isPartial ? '#b45309' : '#b91c1c',
                                      border: `1px solid ${isFull ? '#86efac' : isPartial ? '#fde68a' : '#fca5a5'}`
                                    }}>
                                      {isFull ? '✅' : isPartial ? '🟡' : '⚠️'} {count}/{max} {isFull ? 'voll' : 'besetzt'}
                                    </span>
                                  </div>
                                  <div className="admin-core-style-203" style={{ color: '#64748b', fontSize: 12 }}>⏰ {minToTime(startMin)} – {minToTime(endMin)}</div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                  <button
                                    onClick={() => setSelectedShift(s as unknown as Shift)}
                                    className="admin-core-style-204"
                                  >
                                    👥 Details
                                  </button>
                                  <button
                                    onClick={() => editShiftTime(s)}
                                    style={{ ...btnStyle, background: '#e2e3e5', color: '#383d41', fontSize: 12, minHeight: 36, padding: '4px 10px' }}
                                  >
                                    ⏰ Zeit
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Tablet/Desktop: bestehende Timeline
              return (
                <ShiftTimeline
                  key={dateStr}
                  title={`📅 ${dateStr} (${dayName})`}
                  subtitle={
                    <span className="admin-core-style-205">
                      {slots.length} Schichten · {totalHelfer} Helfer
                      {' · '}💡 {timeEditMode ? 'Ränder ziehen = Zeiten anpassen, dann oben übernehmen' : 'Balken antippen = Helfer'}
                    </span>
                  }
                  headerRight={
                    tournamentDay && (
                      <div className="admin-core-style-206">
                        <button
                          style={{ ...btnStyle, background: '#e7f1ff', color: '#0d6efd', padding: '4px 10px', fontSize: 12, minHeight: 28 }}
                          onClick={() => addShiftToDay(tournamentDay)}
                          title="Eine Schicht für diesen Tag hinzufügen (neuer oder bereits vorhandener Arbeitsbereich, bestehender oder neuer Zeit-Slot)"
                        >
                          ➕ Schicht
                        </button>
                        <button
                          style={{ ...btnStyle, background: '#e2e3e5', color: '#383d41', padding: '4px 10px', fontSize: 12, minHeight: 28 }}
                          onClick={() => doExportTemplate(tournamentDay)}
                          title="Schichten dieses Tages als neue Tagesvorlage in den Katalog exportieren"
                        >
                          ✨ Als Vorlage
                        </button>
                      </div>
                    )
                  }
                  shifts={slots as unknown as Shift[]}
                  volunteerShifts={volunteerShifts}
                  globalStartMin={globalStartMin}
                  globalEndMin={globalEndMin}
                  editable
                  timeEditMode={timeEditMode}
                  overrides={pendingTimeChanges}
                  onShiftClick={s => setSelectedShift(s as unknown as Shift)}
                  onStageShiftTime={handleStageShiftTime}
                />
              );
            });
          })()}
        </>
      )}

      {/* Modal für Helfer-Details */}
      {selectedShift && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}>
          <div style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: '100%', maxWidth: isMobile ? undefined : 500, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: isMobile ? '92vh' : '90vh' }}>

            <div className="admin-core-style-207">
              <div className="admin-core-style-208">
                {(selectedShift as Record<string, any>).workArea?.icon || (selectedShift as Record<string, any>).arbeitsbereich?.icon} {(selectedShift as Record<string, any>).workArea?.name || (selectedShift as Record<string, any>).arbeitsbereich?.name}
              </div>
              <button onClick={() => setSelectedShift(null)} className="admin-core-style-209">×</button>
            </div>

            <div className="admin-core-style-210">
              <div className="admin-core-style-211">
                <div>📅 {new Date((selectedShift as Record<string, any>).day?.date || selectedShift.date).toLocaleDateString('de-DE')}</div>
                <div>⏰ {minToTime((selectedShift as Record<string, any>).startMin ?? (selectedShift as Record<string, any>).daySlot?.startMin ?? 0)} - {minToTime((selectedShift as Record<string, any>).endMin ?? (selectedShift as Record<string, any>).daySlot?.endMin ?? 0)}</div>
              </div>

              {/* Helfer-Anzahl bearbeiten */}
              <div className="admin-core-style-212">
                <h5 className="admin-core-style-213">👥 Geplante Helfer</h5>
                <div className="admin-core-style-214">
                  <label className="admin-core-style-215">Min:</label>
                  <input
                    type="number"
                    min={0}
                    defaultValue={selectedShift.minVolunteers ?? ''}
                    placeholder="—"
                    style={{ ...inputStyle, width: 64, textAlign: 'center', fontSize: 13 }}
                    onBlur={async e => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0) {
                        try {
                          await updateShift(selectedShift.id, { minVolunteers: val });
                          queryClient.invalidateQueries({ queryKey: ['shifts', selectedTournament] });
                        } catch (err: unknown) { const e = err as Error;
                          await modal.alert({ title: 'Fehler', message: e.message || 'Speichern fehlgeschlagen' });
                        }
                      }
                    }}
                  />
                  <label className="admin-core-style-216">Max:</label>
                  <input
                    type="number"
                    min={0}
                    defaultValue={selectedShift.maxVolunteers ?? ''}
                    placeholder="—"
                    style={{ ...inputStyle, width: 64, textAlign: 'center', fontSize: 13 }}
                    onBlur={async e => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0) {
                        try {
                          await updateShift(selectedShift.id, { maxVolunteers: val });
                          queryClient.invalidateQueries({ queryKey: ['shifts', selectedTournament] });
                        } catch (err: unknown) { const e = err as Error;
                          await modal.alert({ title: 'Fehler', message: e.message || 'Speichern fehlgeschlagen' });
                        }
                      }
                    }}
                  />
                  <span className="admin-core-style-217">Helfer</span>
                </div>
              </div>

              <h4 className="admin-core-style-218">Zugewiesene Helfer</h4>
              {(() => {
                const assigned = volunteerShifts.filter(vs => vs.shiftId === selectedShift.id);
                if (assigned.length === 0) return <div className="admin-core-style-219">Noch keine Helfer zugewiesen.</div>;
                return (
                  <div className="admin-core-style-220">
                    {assigned.map(vs => (
                      <div key={vs.id} className="admin-core-style-221">
                        <div className="admin-core-style-222">
                          <div className="admin-core-style-223">
                            {vs.user?.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="admin-core-style-224">{vs.user?.name || 'Unbekannt'}</div>
                            {vs.user?.phone && <div className="admin-core-style-225">📞 {vs.user.phone}</div>}
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            if (!(await modal.confirm({ title: 'Helfer ausplanen', message: `Soll "${vs.user?.name || 'Helfer'}" aus dieser Schicht entfernt werden? Der Helfer erhält eine Web-Push-Benachrichtigung.` }))) return;
                            try {
                              await apiDelete(`/api/volunteer-shifts/${vs.id}`);
                              queryClient.invalidateQueries({ queryKey: ['volunteerShifts'] });
                              await modal.alert({ title: 'Ausgeplant', message: 'Der Helfer wurde aus der Schicht entfernt.' });
                            } catch (err: unknown) { const e = err as Error;
                              await modal.alert({ title: 'Fehler', message: e.message || 'Fehler beim Ausplanen' });
                            }
                          }}
                          className="admin-core-style-226"
                          title="Aus Schicht entfernen"
                        >
                          ❌ Ausplanen
                        </button>

                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="admin-core-style-227">
                <h5 className="admin-core-style-228">➕ Helfer in Schicht einplanen</h5>
                <div style={{ display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap' }}>
                  <select
                    value={selectedVolunteerToAssign}
                    onChange={e => setSelectedVolunteerToAssign(e.target.value ? Number(e.target.value) : '')}
                    style={{ flex: 1, minWidth: 200, padding: isMobile ? '12px 14px' : '8px 12px', border: '1px solid #ced4da', borderRadius: 8, fontSize: 14, minHeight: 44 }}
                  >
                    <option value="">-- Helfer auswählen --</option>
                    {allVolunteers
                      .filter(v => !volunteerShifts.some(vs => vs.shiftId === selectedShift.id && vs.userId === v.id))
                      .map(v => (
                        <option key={v.id} value={v.id}>{v.name} {v.email ? `(${v.email})` : ''}</option>
                      ))}
                  </select>
                  <button
                    onClick={async () => {
                      if (!selectedVolunteerToAssign || !selectedShift) return;
                      setAssigning(true);
                      try {
                        const shiftDate = (selectedShift as Record<string, any>).day?.date || selectedShift.date;
                        const startMin = (selectedShift as Record<string, any>).startMin ?? (selectedShift as Record<string, any>).daySlot?.startMin ?? 0;
                        const endMin = (selectedShift as Record<string, any>).endMin ?? (selectedShift as Record<string, any>).daySlot?.endMin ?? 0;
                        const slotLabel = `${minToTime(startMin)}-${minToTime(endMin)}`;
                        const roleName = (selectedShift as Record<string, any>).workArea?.name || (selectedShift as Record<string, any>).arbeitsbereich?.name || 'Helfer';
                        const areaIdStr = (selectedShift as Record<string, any>).tournamentWorkAreaId ? String((selectedShift as Record<string, any>).tournamentWorkAreaId) : null;

                        await apiPost('/api/volunteer-shifts', {
                          userId: Number(selectedVolunteerToAssign),
                          tournamentId: selectedShift.tournamentId || selectedTournament,
                          shiftId: selectedShift.id,
                          date: shiftDate,
                          slot: slotLabel,
                          role: roleName,
                          areaId: areaIdStr
                        });

                        queryClient.invalidateQueries({ queryKey: ['volunteerShifts'] });
                        setSelectedVolunteerToAssign('');
                        await modal.alert({ title: 'Eingeplant ✅', message: 'Der Helfer wurde eingeplant und per Web-Push benachrichtigt!' });
                      } catch (err: unknown) { const e = err as Error;
                        await modal.alert({ title: 'Fehler', message: e.message || 'Fehler beim Einplanen' });
                      } finally {
                        setAssigning(false);
                      }
                    }}
                    disabled={!selectedVolunteerToAssign || assigning}
                    style={{ padding: '12px 20px', minHeight: 44, background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 8, cursor: !selectedVolunteerToAssign || assigning ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: !selectedVolunteerToAssign || assigning ? 0.6 : 1, width: isMobile ? '100%' : undefined }}
                  >
                    {assigning ? '...' : '✅ Einplanen'}
                  </button>
                </div>
              </div>
            </div>

            <div className="admin-core-style-229">
              <button
                onClick={async () => {
                  const assignedCount = volunteerShifts.filter(vs => vs.shiftId === selectedShift.id).length;
                  const areaName = (selectedShift as Record<string, any>).workArea?.name || (selectedShift as Record<string, any>).arbeitsbereich?.name || 'diese Schicht';
                  if (!(await modal.confirm({
                    title: 'Schicht entfernen',
                    message: assignedCount > 0
                      ? `"${areaName}" wirklich entfernen? ${assignedCount} zugewiesene Helfer werden automatisch ausgeplant und per Web-Push informiert.`
                      : `"${areaName}" wirklich entfernen? Nur diese eine Schicht wird gelöscht, der restliche Dienstplan bleibt unverändert.`,
                    variant: 'danger'
                  }))) return;
                  try {
                    await apiDelete(`/api/shifts/${selectedShift.id}`);
                    queryClient.invalidateQueries({ queryKey: ['shifts', selectedTournament] });
                    queryClient.invalidateQueries({ queryKey: ['volunteerShifts', selectedTournament] });
                    setSelectedShift(null);
                    await modal.alert({ title: 'Entfernt', message: 'Die Schicht wurde aus dem Dienstplan entfernt.' });
                  } catch (err: unknown) { const e = err as Error;
                    await modal.alert({ title: 'Fehler', message: e.message || 'Schicht konnte nicht entfernt werden' });
                  }
                }}
                className="admin-core-style-230"
              >
                🗑️ Schicht entfernen
              </button>
              <button onClick={() => setSelectedShift(null)} className="admin-core-style-231">Schließen</button>
            </div>
          </div>
        </div>
      )}

      {showFeedbackModal && selectedTournament && (
        <ShiftFeedbackModal
          tournament={{ id: selectedTournament, name: 'Turnier ' + selectedTournament } as unknown as Tournament}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      {showPrintModal && (
        <StationPrintModal
          isOpen={showPrintModal}
          onClose={() => setShowPrintModal(false)}
          tournament={currentTournament}
          days={days}
          workAreas={areas}
          jobSlots={jobSlots}
          volunteerShifts={volunteerShifts}
        />
      )}
    </div>
  );
}
