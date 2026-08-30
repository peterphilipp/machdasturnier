import { useMemo, useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Shift, VolunteerShift, TournamentWorkArea, TournamentDay, Tournament, WorkArea, minToTime, timeToMin } from '../shared';
import {
  getShifts, getVolunteerShifts, getVolunteers, updateShiftsBatch, updateShift,
  getTournamentWorkAreas, getTournamentDays, addDaySlot, getWorkAreas, adoptTournamentWorkArea,
  exportDayToTemplate, createShift, apiDelete, apiPost, getTournaments, getAenderungen
} from '../../../api';
import { modal } from '../Modal';
import { btnStyle, inputStyle, tdStyle, thStyle, BESETZUNG_FARBEN, besetzungsStufe, MAX_BESETZUNGS_PUNKTE } from '../shared';
import ShiftTimeline from './ShiftTimeline';
import RosterSetupPanel from './RosterSetupPanel';
import StationPrintModal from './StationPrintModal';
import { Ladefehler } from '../../Verbindung';
import PersonenAuswahl from '../PersonenAuswahl';

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

/**
 * "vor 8 Minuten" - grobe, aber sofort verständliche Angabe. Eine Uhrzeit
 * müsste man im Kopf mit der aktuellen verrechnen; hier zählt nur, ob die
 * Änderung frisch genug ist, um sich vor dem eigenen Eingriff abzustimmen.
 */
function vorWieLange(iso: string): string {
  const sekunden = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sekunden < 60) return 'gerade eben';
  const minuten = Math.round(sekunden / 60);
  if (minuten < 60) return `vor ${minuten} Minute${minuten === 1 ? '' : 'n'}`;
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return `vor ${stunden} Stunde${stunden === 1 ? '' : 'n'}`;
  const tage = Math.round(stunden / 24);
  return `vor ${tage} Tag${tage === 1 ? '' : 'en'}`;
}

export default function Uebersicht({ selectedTournament }: { selectedTournament: number | null }) {
  const [showPrintModal, setShowPrintModal] = useState(false);
  const queryClient = useQueryClient();
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [assigning, setAssigning] = useState(false);

  /**
   * Plant einen Helfer in die gerade geöffnete Schicht ein.
   *
   * Wird unmittelbar beim Auswählen aufgerufen - siehe Kommentar am
   * Auswahlfeld im Schicht-Dialog.
   */
  const helferEinplanen = async (userId: number) => {
    if (!selectedShift || assigning) return;
    setAssigning(true);
    try {
      const shiftDate = (selectedShift as Record<string, any>).day?.date || selectedShift.date;
      const startMin = (selectedShift as Record<string, any>).startMin ?? (selectedShift as Record<string, any>).daySlot?.startMin ?? 0;
      const endMin = (selectedShift as Record<string, any>).endMin ?? (selectedShift as Record<string, any>).daySlot?.endMin ?? 0;
      const slotLabel = `${minToTime(startMin)}-${minToTime(endMin)}`;
      const roleName = (selectedShift as Record<string, any>).workArea?.name || (selectedShift as Record<string, any>).arbeitsbereich?.name || 'Helfer';
      const areaIdStr = (selectedShift as Record<string, any>).tournamentWorkAreaId ? String((selectedShift as Record<string, any>).tournamentWorkAreaId) : null;

      await apiPost('/api/volunteer-shifts', {
        userId,
        tournamentId: selectedShift.tournamentId || selectedTournament,
        shiftId: selectedShift.id,
        date: shiftDate,
        slot: slotLabel,
        role: roleName,
        areaId: areaIdStr
      });

      queryClient.invalidateQueries({ queryKey: ['volunteerShifts'] });
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Fehler beim Einplanen' });
    } finally {
      setAssigning(false);
    }
  };
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedYearGroupStats, setSelectedYearGroupStats] = useState<{ day: string, name: string, members: { name: string, shifts: { role: string, slot: string }[] }[] } | null>(null);

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

  /**
   * Zum Einplanen zaehlt der ganze Verein, nicht nur wer in diesem Turnier
   * schon aktiv ist.
   *
   * Die turniergefilterte Liste oben zeigt nur Helfer mit Schicht,
   * Mitgliedschaft oder passender Turnier-Praeferenz. Ein frisch angelegter
   * Helfer hat nichts davon - und liesse sich deshalb nie eintragen, obwohl er
   * genau dafuer angelegt wurde. Die Schicht-Zuweisung erzeugt die
   * Zugehoerigkeit erst.
   *
   * Fuer Organisatoren lehnt der Server die ungefilterte Abfrage mit 403 ab;
   * dann bleibt es bei der Turnierliste (siehe Zusammenfuehrung unten).
   */
  const { data: alleNutzer = [] } = useQuery<any[]>({
    queryKey: ['volunteers', 'alle'],
    queryFn: () => getVolunteers(),
    enabled: !!selectedTournament,
    retry: false
  });

  const { data: jobSlots = [], isLoading: busySlots, isError: schichtenFehler, error: schichtenFehlerObj, refetch: schichtenNeu } = useQuery<Shift[]>({
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

  /**
   * Letzte Änderungen, um im Schicht-Dialog "zuletzt geändert von ..." zu
   * zeigen. Genau dort steht jemand kurz davor, die Arbeit eines anderen zu
   * überschreiben - der Verlauf im eigenen Reiter erklärt es erst hinterher.
   */
  const { data: verlauf } = useQuery<{ eintraege: { objektTyp: string | null; objektId: number | null; userName: string; createdAt: string; beschreibung: string }[] }>({
    queryKey: ['aenderungen-kurz', tid],
    queryFn: () => getAenderungen(tid as number, { limit: 100 }),
    enabled: !!tid,
    refetchInterval: 30000
  });

  /** Jüngster Eintrag zu genau dieser Schicht, oder null. */
  const letzteAenderung = useMemo(() => {
    if (!selectedShift || !verlauf?.eintraege) return null;
    return verlauf.eintraege.find(e => e.objektTyp === 'shift' && e.objektId === selectedShift.id) || null;
  }, [selectedShift, verlauf]);

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
   * Legt eine weitere Schicht parallel zur geöffneten an - gleicher Bereich,
   * gleicher Tag, gleiches Zeitfenster.
   *
   * Ein Arbeitsbereich kann zur selben Zeit mehrfach besetzt sein: zwei
   * Verkaufsstände laufen gleichzeitig, werden aber getrennt geplant und haben
   * jeweils eigene Helfer und einen eigenen Stationszettel. Einfach die
   * Helferzahl der bestehenden Schicht hochzusetzen würde alle in einen Topf
   * werfen und die Trennung verlieren.
   */
  const parallelSchichtAnlegen = (shift: Record<string, any>) => guard(async () => {
    if (!tid) return;
    const name = shift.workArea?.name || shift.arbeitsbereich?.name || 'Schicht';
    const areaId = shift.tournamentWorkAreaId ?? shift.arbeitsbereichId;
    const startMin = shift.startMin ?? shift.daySlot?.startMin ?? 0;
    const endMin = shift.endMin ?? shift.daySlot?.endMin ?? 0;
    const bisher = jobSlots.filter((s: Record<string, any>) =>
      s.tournamentDayId === shift.tournamentDayId
      && s.daySlotId === shift.daySlotId
      && (s.tournamentWorkAreaId ?? s.arbeitsbereichId) === areaId).length;

    if (!(await modal.confirm({
      title: '➕ Parallele Schicht anlegen',
      message: `„${name}" läuft von ${minToTime(startMin)} bis ${minToTime(endMin)} bereits ${bisher}× parallel.\n\n`
        + 'Eine weitere Schicht mit denselben Zeiten anlegen? Sie bekommt eigene Helfer und einen eigenen Stationszettel.',
      confirmText: 'Anlegen'
    }))) return;

    const neu = await createShift({
      tournamentId: tid,
      tournamentDayId: shift.tournamentDayId,
      daySlotId: shift.daySlotId,
      tournamentWorkAreaId: areaId,
      minVolunteers: shift.minVolunteers,
      maxVolunteers: shift.maxVolunteers,
      allowParallel: true
    });

    // Weicht die Vorlage vom Zeitfenster ab (im Diagramm zurechtgezogen), muss
    // die Kopie dieselbe Abweichung bekommen - sonst stünde sie woanders.
    if (shift.startMin != null || shift.endMin != null) {
      await updateShift(neu.id, { startMin, endMin });
    }

    queryClient.invalidateQueries({ queryKey: ['shifts', tid] });
    setSelectedShift(null);
    await modal.alert({
      title: 'Angelegt ✅',
      message: `„${name}" läuft jetzt ${bisher + 1}× parallel von ${minToTime(startMin)} bis ${minToTime(endMin)}.`
    });
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
    <div style={{
      background: isMobile ? 'transparent' : '#fff',
      padding: isMobile ? '12px 0' : 24,
      borderRadius: isMobile ? 0 : 16,
      boxShadow: isMobile ? 'none' : '0 2px 12px rgba(0,0,0,0.08)',
      border: isMobile ? 'none' : '1px solid #e9ecef'
    }}>
      {/* Ohne diesen Kasten sähe ein nicht erreichbarer Server hier aus wie
          ein Turnier ganz ohne Dienstplan - und jemand legt ihn neu an. */}
      {schichtenFehler && (
        <div style={{ marginBottom: 16 }}>
          <Ladefehler was="Der Dienstplan" fehler={schichtenFehlerObj} erneut={() => schichtenNeu()} />
        </div>
      )}

      {tid && (
        <RosterSetupPanel
          selectedTournamentId={tid}
          isMobile={isMobile}
        />
      )}

      {jobSlots.length > 0 && (
        <>
          {/* Editiermodus-Toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap',
            marginBottom: 24, padding: timeEditMode ? '12px 16px' : '0', borderRadius: timeEditMode ? 12 : 0,
            background: timeEditMode ? '#fff3cd' : 'transparent',
            border: timeEditMode ? '1px solid #ffe69c' : 'none'
          }}>
            {!timeEditMode ? (
              <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto' }}>
                <button
                  onClick={() => setShowPrintModal(true)}
                  style={{
                    flex: isMobile ? 1 : 'none', padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                >
                  🖨️ PDF
                </button>
                <button
                  onClick={() => setTimeEditMode(true)}
                  style={{ flex: isMobile ? 1 : 'none', padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                >
                  🔒 Zeiten bearbeiten
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: isMobile ? '1 1 100%' : 'none', marginBottom: isMobile ? 8 : 0 }}>
                  <span style={{ fontWeight: 600, color: '#856404', fontSize: 14 }}>✏️ Bearbeitungsmodus aktiv – Ränder ziehen</span>
                  <span style={{ fontSize: 12, color: '#856404', opacity: 0.8 }}>
                    {pendingCount === 0 ? 'Noch keine Änderungen' : `${pendingCount} Änderung${pendingCount === 1 ? '' : 'en'} ausstehend`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleDiscardTimeChanges}
                    disabled={committing}
                    style={{ flex: isMobile ? 1 : 'none', padding: '10px 14px', borderRadius: 8, border: '1px solid #ced4da', background: '#fff', color: '#495057', fontWeight: 600, cursor: committing ? 'not-allowed' : 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: committing ? 0.6 : 1 }}
                  >
                    ✖️ Verwerfen
                  </button>
                  <button
                    onClick={handleCommitTimeChanges}
                    disabled={committing}
                    style={{ flex: isMobile ? 1 : 'none', padding: '10px 14px', borderRadius: 8, border: 'none', background: '#198754', color: '#fff', fontWeight: 600, cursor: committing ? 'not-allowed' : 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: committing ? 0.6 : 1 }}
                  >
                    {committing ? '...' : `✅ Speichern${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                  </button>
                </div>
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
              const fehlendeHelfer = slots.reduce((sum: number, s: Record<string, any>) => {
                const count = volunteerShifts.filter(vs => vs.shiftId === s.id).length;
                return sum + Math.max(0, (s.maxVolunteers || 1) - count);
              }, 0);
              
              const assignedShiftsForDay = volunteerShifts.filter(vs => slots.some((s: any) => vs.shiftId === s.id));
              const ygMembers = new Map<number, Map<number, { name: string, shifts: { role: string, slot: string }[] }>>();
              
              assignedShiftsForDay.forEach(vs => {
                const uniqueYearGroupIds = new Set<number>();
                
                // Match children with year groups
                if (vs.user?.children && currentTournament?.yearGroups) {
                  vs.user.children.forEach(child => {
                    const matchedYg = currentTournament.yearGroups?.find(yg => child.childYear >= yg.birthYearStart && child.childYear <= yg.birthYearEnd);
                    if (matchedYg) uniqueYearGroupIds.add(matchedYg.id);
                  });
                }
                
                // Add trained year groups
                if (vs.user?.trainedYearGroups) {
                  vs.user.trainedYearGroups.forEach(tyg => {
                    uniqueYearGroupIds.add(tyg.id);
                  });
                }
                
                if (uniqueYearGroupIds.size === 0) {
                  uniqueYearGroupIds.add(-1); // "Ohne Zuordnung"
                }
                
                uniqueYearGroupIds.forEach(ygId => {
                  if (!ygMembers.has(ygId)) ygMembers.set(ygId, new Map());
                  const memberMap = ygMembers.get(ygId)!;
                  const userId = vs.user?.id || -1;
                  const userName = vs.user?.name || 'Unbekannt';
                  
                  if (!memberMap.has(userId)) {
                    memberMap.set(userId, { name: userName, shifts: [] });
                  }
                  memberMap.get(userId)!.shifts.push({ role: vs.role || 'Unbekannt', slot: vs.slot || 'Unbekannt' });
                });
              });
              
              const yearGroupStats = Array.from(ygMembers.entries())
                .map(([ygId, memberMap]) => {
                  const members = Array.from(memberMap.values()).sort((a, b) => b.shifts.length - a.shifts.length);
                  const totalCount = members.reduce((sum, m) => sum + m.shifts.length, 0);
                  
                  if (ygId === -1) return { id: ygId, name: 'Ohne Zuordnung', count: totalCount, members };
                  const yg = currentTournament?.yearGroups?.find(y => y.id === ygId);
                  
                  let displayName = yg?.name || `JG ${ygId}`;
                  if (!displayName.toLowerCase().startsWith('jahrgang')) {
                    displayName = `Jahrgang: ${displayName}`;
                  }
                  
                  return { id: ygId, name: displayName, count: totalCount, members };
                })
                .sort((a, b) => {
                  if (a.name === 'Ohne Zuordnung') return 1;
                  if (b.name === 'Ohne Zuordnung') return -1;
                  return b.count - a.count;
                });

              const isExpanded = expandedDays.has(dateStr);

              if (isMobile) {
                // Mobile: aufklappbares Accordion pro Tag
                return (
                  <div key={dateStr} style={{ marginBottom: 12, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', background: '#fff' }}>
                    <button
                      onClick={() => {
                        setExpandedDays(prev => {
                          const next = new Set(prev);
                          if (next.has(dateStr)) next.delete(dateStr);
                          else next.add(dateStr);
                          return next;
                        });
                      }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: isExpanded ? '#eff6ff' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 8, borderLeft: isExpanded ? '4px solid #3b82f6' : '4px solid transparent', transition: 'all 0.2s' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: isExpanded ? '#1e40af' : '#0f172a' }}>📅 {dateStr} – {dayName}</div>
                        <div style={{ fontSize: 12, color: isExpanded ? '#3b82f6' : '#64748b', marginTop: 4 }}>
                          {slots.length} Schichten · {totalHelfer} Helfer zugewiesen
                          {fehlendeHelfer > 0 && (
                            <span style={{ color: '#b91c1c', fontWeight: 600, marginLeft: 6 }}>
                              · ⚠️ {fehlendeHelfer} fehlen
                            </span>
                          )}
                        </div>
                        {yearGroupStats.length > 0 && (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {yearGroupStats.map(yg => (
                              <button key={yg.name} onClick={(e) => { e.stopPropagation(); setSelectedYearGroupStats({ day: dateStr, name: yg.name, members: yg.members }); }} style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, border: '1px solid #e2e8f0', cursor: 'pointer', textAlign: 'left', fontSize: 'inherit', color: 'inherit' }}>
                                👶 {yg.name}: {yg.count}x
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 20, color: isExpanded ? '#3b82f6' : '#94a3b8', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
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
                          const stufe = besetzungsStufe(count, max);
                          const farben = BESETZUNG_FARBEN[stufe];

                          // Laeuft dieser Bereich zur selben Zeit mehrfach (zwei
                          // Verkaufsstaende etwa), waeren die Karten sonst nicht
                          // auseinanderzuhalten - im Diagramm trennen sie die Spuren,
                          // hier braucht es eine Nummer.
                          const parallele = slots.filter((x: Record<string, any>) =>
                            x.daySlotId === s.daySlotId
                            && (x.tournamentWorkAreaId ?? x.arbeitsbereichId) === (s.tournamentWorkAreaId ?? s.arbeitsbereichId));
                          const parallelNr = parallele.length > 1
                            ? parallele.findIndex((x: Record<string, any>) => x.id === s.id) + 1
                            : 0;

                          return (
                            // Wie im Diagramm traegt die Besetzung die Farbe: die linke
                            // Kante der Karte, damit eine luckenhafte Liste schon beim
                            // Ueberfliegen auffaellt. Der Arbeitsbereich steht daneben
                            // im Klartext und braucht die Farbe nicht.
                            <div key={s.id} className="admin-core-style-200" style={{ borderLeft: `4px solid ${farben.punkt}` }}>
                              <div className="admin-core-style-201">
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                    <span className="admin-core-style-202">
                                      {areaIcon} {areaName}
                                      {parallelNr > 0 && <span style={{ color: '#64748b', fontWeight: 500 }}> · {parallelNr} von {parallele.length}</span>}
                                    </span>
                                    <span style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5,
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontWeight: 700,
                                      background: farben.flaeche,
                                      color: farben.text,
                                      border: `1px solid ${farben.rand}`
                                    }}>
                                      {max <= MAX_BESETZUNGS_PUNKTE && (
                                        <span style={{ display: 'inline-flex', gap: 2 }} aria-hidden="true">
                                          {Array.from({ length: max }, (_, i) => (
                                            <span key={i} style={{
                                              width: 6, height: 6, borderRadius: '50%',
                                              background: i < count ? farben.punkt : 'transparent',
                                              boxShadow: `inset 0 0 0 1px ${farben.punkt}`
                                            }} />
                                          ))}
                                        </span>
                                      )}
                                      {count}/{max} {stufe === 'voll' ? 'voll' : 'besetzt'}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className="admin-core-style-205">
                        {slots.length} Schichten · {totalHelfer} Helfer zugewiesen
                        {fehlendeHelfer > 0 && (
                          <span style={{ color: '#b91c1c', fontWeight: 600, marginLeft: 4, marginRight: 4 }}>
                            · ⚠️ {fehlendeHelfer} fehlen
                          </span>
                        )}
                        {' · '}💡 {timeEditMode ? 'Ränder ziehen = Zeiten anpassen, dann oben übernehmen' : 'Balken antippen = Helfer'}
                      </span>
                      {yearGroupStats.length > 0 && (
                        <div style={{ fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          {yearGroupStats.map(yg => (
                            <button key={yg.name} onClick={(e) => { e.stopPropagation(); setSelectedYearGroupStats({ day: dateStr, name: yg.name, members: yg.members }); }} style={{ background: '#f8fafc', padding: '2px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontSize: 'inherit', color: 'inherit' }}>
                              👶 {yg.name}: {yg.count}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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

              {letzteAenderung && (
                <div style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  background: '#FAEEDA', border: '1px solid #EF9F27', borderRadius: 8,
                  padding: '9px 11px', marginBottom: 12
                }}>
                  <span style={{ fontSize: 14 }} aria-hidden="true">🕓</span>
                  <span style={{ fontSize: 12, color: '#633806', lineHeight: 1.5 }}>
                    Zuletzt geändert von <strong>{letzteAenderung.userName}</strong>,{' '}
                    {vorWieLange(letzteAenderung.createdAt)}
                  </span>
                </div>
              )}

              <div className="admin-core-style-227">
                <h5 className="admin-core-style-228">➕ Helfer in Schicht einplanen</h5>
                {/* Die Wahl plant sofort ein. Vorher waren es zwei Schritte -
                    wählen, dann "Einplanen" - und der kräftige Knopf gehörte
                    zum zweiten, während das blasse Auswahlfeld daneben
                    überlesen wurde. Ein Fehlgriff ist unkritisch: Die
                    Zuweisung steht sofort darüber und lässt sich dort wieder
                    entfernen.

                    Suchbare Auswahl statt Scroll-Liste: Bei über fünfzig
                    Helfern war das native Auswahlfeld am Handy nicht mehr
                    bedienbar. Wer im Turnier schon aktiv ist, steht oben -
                    das ist der Regelfall; darunter der Rest des Vereins,
                    damit auch ein gerade erst angelegter Helfer eingeplant
                    werden kann. */}
                <PersonenAuswahl
                  key={selectedShift.id}
                  variante="aktion"
                  startetOffen={volunteerShifts.filter(vs => vs.shiftId === selectedShift.id).length === 0}
                  erlaubeLeer={false}
                  wert=""
                  leerText={assigning ? 'wird eingeplant …' : '🔍 Helfer suchen und einplanen'}
                  platzhalter="Name oder E-Mail eingeben …"
                  onWaehlen={id => { if (id !== '') helferEinplanen(Number(id)); }}
                  personen={(() => {
                    const imTurnierIds = new Set(allVolunteers.map(v => v.id));
                    const zusammen = [...allVolunteers];
                    for (const v of alleNutzer) if (!imTurnierIds.has(v.id)) zusammen.push(v);

                    const waehlbar = zusammen.filter(v =>
                      !volunteerShifts.some(vs => vs.shiftId === selectedShift.id && vs.userId === v.id));
                    const mehrereGruppen = waehlbar.some(v => !imTurnierIds.has(v.id))
                      && waehlbar.some(v => imTurnierIds.has(v.id));

                    return waehlbar
                      .slice()
                      .sort((a, b) => Number(imTurnierIds.has(b.id)) - Number(imTurnierIds.has(a.id)))
                      .map(v => ({
                        id: v.id,
                        name: v.name,
                        email: v.email,
                        // Ohne zweite Gruppe keine Ueberschrift - sonst stuende
                        // eine einzelne ueber der gesamten Liste.
                        gruppe: mehrereGruppen
                          ? (imTurnierIds.has(v.id) ? 'In diesem Turnier aktiv' : 'Weitere Helfer aus den Stammdaten')
                          : undefined
                      }));
                  })()}
                />
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6c757d', lineHeight: 1.5 }}>
                  Wer hier gewählt wird, ist sofort eingeplant und bekommt eine Push-Benachrichtigung.
                </p>
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
              <button
                onClick={() => parallelSchichtAnlegen(selectedShift as unknown as Record<string, any>)}
                style={{ ...btnStyle, background: '#e7f1ff', color: '#0d6efd' }}
                title="Eine weitere Schicht mit denselben Zeiten anlegen (z.B. zweiter Verkaufsstand)"
              >
                ➕ Parallele Schicht
              </button>
              <button onClick={() => setSelectedShift(null)} className="admin-core-style-231">Schließen</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal für YearGroup Stats Details */}
      {selectedYearGroupStats && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 16 : 24 }} onClick={() => setSelectedYearGroupStats(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
             <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{selectedYearGroupStats.name}</h3>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{selectedYearGroupStats.day}</div>
                </div>
                <button onClick={() => setSelectedYearGroupStats(null)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b' }}>×</button>
             </div>
             <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                   {selectedYearGroupStats.members.map((m, i) => (
                      <li key={i} style={{ display: 'flex', flexDirection: 'column', paddingBottom: 12, borderBottom: i < selectedYearGroupStats.members.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: '#334155' }}>👤 {m.name}</span>
                          <span style={{ color: '#64748b', fontSize: 13, background: '#f8fafc', padding: '2px 6px', borderRadius: 6 }}>{m.shifts.length} Schicht{m.shifts.length !== 1 ? 'en' : ''}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, paddingLeft: 24 }}>
                          {m.shifts.map((s, sidx) => (
                            <div key={sidx} style={{ fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: '#94a3b8', fontSize: 10 }}>▶</span>
                              <span style={{ fontWeight: 500 }}>{s.role}</span>
                              <span style={{ color: '#94a3b8' }}>({s.slot})</span>
                            </div>
                          ))}
                        </div>
                      </li>
                   ))}
                </ul>
             </div>
          </div>
        </div>
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
