import { useState, useEffect, useCallback, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { modal } from '../admin/Modal';
import { btnStyle } from '../admin/shared';
import { useUser, VolunteerData } from '../../context/UserContext';
import { apiFetch, apiPost, apiDelete } from '../../api';
import { Ladefehler } from '../Verbindung';
import '../../styles/components/dashboard.css';

interface Shift { id: number; date: string; slot: string; startMin?: number | null; endMin?: number | null; zeitslot: { name: string; startTime: string; endTime: string; color: string; order?: number } | null; arbeitsbereich: { name: string; icon: string; color: string; order?: number } | null; arbeitsbereichId: number | null; maxVolunteers: number; }
interface VolunteerShift { id: number; userId: number; date: string; slot: string; role: string; areaId: string | null; shiftId: number | null; shift: Shift | null; ratingWorkload?: number | null; ratingOrganization?: number | null; ratingFun?: number | null; ratingComment?: string | null; user?: { id: number; name: string } | null; }
interface ShiftOffer {
  id: number; date: string; startMin: number; endMin: number;
  note: string | null; status: 'OFFEN' | 'ANGENOMMEN' | 'ABGELEHNT';
  decisionNote: string | null;
  shift?: { arbeitsbereich?: { name: string } | null } | null;
}
interface FoodCategory { id: number; name: string; icon: string; items: { id: number; name: string; price: string | null; unit: string }[]; }
interface FoodDonation { id: number; foodItemId: number; quantity: number; note: string | null; createdAt: string; foodDonationSlotId: number | null; foodItem: { id: number; name: string; unit: string; category: { id: number; name: string; icon: string } } | null; }
interface FoodDonationSlot { id: number; tournamentId: number; yearGroupId: number | null; yearGroup?: { id: number; name: string; birthYearStart: number; birthYearEnd: number; timeSlots?: { date: string }[] } | null; foodItemId: number | null; targetQuantity: number; collected: number; foodItem: { id: number; name: string; unit: string; icon: string } | null; }

interface LayoutContext {
  clubPrimary: string;
  clubSecondary: string;
  clubAccent: string;
  fetchClubColors: (id: number) => void;
  setAvailableTournaments: (tournaments: {id: number, name: string, status?: string}[]) => void;
  selectedTournamentId: number | null;
  setSelectedTournamentId: (id: number | null) => void;
  setTournamentName: (name: string) => void;
}

/**
 * Eine Bewertungsstufe von 1 bis 5.
 *
 * Die Zahl allein sagt nicht, in welche Richtung sie zeigt - bei "Stress" ist
 * 5 das Warnsignal, bei "Spass" das Lob. Deshalb steht die gewaehlte Stufe
 * immer ausgeschrieben daneben, und jeder Knopf traegt seine Bedeutung als
 * title (fuer Maus und Screenreader).
 */
function RatingSkala({ frage, stufen, symbole, wert, onChange }: {
  frage: string;
  stufen: string[];
  symbole: string[];
  wert: number | null;
  onChange: (stufe: number) => void;
}) {
  return (
    <div className="rating-feld">
      <label className="rating-feld-label">
        {frage}
        {wert != null && <span className="rating-feld-stufe"> — {stufen[wert - 1]}</span>}
      </label>
      <div className="rating-skala" role="group" aria-label={frage}>
        {[1, 2, 3, 4, 5].map(stufe => (
          <button
            key={stufe}
            type="button"
            onClick={() => onChange(stufe)}
            aria-pressed={wert === stufe}
            aria-label={`${stufe}: ${stufen[stufe - 1]}`}
            title={stufen[stufe - 1]}
            className={`rating-skala-btn${wert === stufe ? ' rating-skala-btn--aktiv' : ''}`}
          >
            {symbole[stufe - 1]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DashboardView() {
  const { volunteer, token, isLoggedIn, login } = useUser();
  const { clubPrimary, clubSecondary, clubAccent, fetchClubColors, setAvailableTournaments, selectedTournamentId, setSelectedTournamentId, setTournamentName } = useOutletContext<LayoutContext>();
  const queryClient = useQueryClient();

  const currentLoadedTournamentId = useRef<number | null>(null);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [volunteerShifts, setVolunteerShifts] = useState<VolunteerShift[]>([]);
  // Schichten von Helfern ohne App-Zugang, fuer die dieser Nutzer als
  // Kontaktperson eingetragen ist - z.B. das eigene Kind. Getrennt von den
  // eigenen Zusagen, damit beides nicht durcheinandergeht.
  const [betreuteVolunteerShifts, setBetreuteVolunteerShifts] = useState<VolunteerShift[]>([]);
  const [tournament, setTournament] = useState<any>(null);
  const [filterDate, setFilterDate] = useState('');
  const [filterTimesOfDay, setFilterTimesOfDay] = useState<Set<'morgen' | 'mittag' | 'nachmittag' | 'abend'>>(new Set());
  const [busy, setBusy] = useState(false);
  
  const [activeSection, setActiveSection] = useState<'jobs' | 'verpflegung'>('jobs');
  const [foodCategories, setFoodCategories] = useState<FoodCategory[]>([]);
  const [myDonations, setMyDonations] = useState<FoodDonation[]>([]);
  const [foodDonationSlots, setFoodDonationSlots] = useState<FoodDonationSlot[]>([]);
  const [donationFoodId, setDonationFoodId] = useState(0);
  const [donationQuantity, setDonationQuantity] = useState('');
  const [donationNote, setDonationNote] = useState('');
  const [slotCommitments, setSlotCommitments] = useState<Record<number, number>>({});
  
  const [ratingModalVs, setRatingModalVs] = useState<VolunteerShift | null>(null);
  const [rateWorkload, setRateWorkload] = useState<number | null>(null);
  const [rateOrganization, setRateOrganization] = useState<number | null>(null);
  const [rateFun, setRateFun] = useState<number | null>(null);
  const [rateComment, setRateComment] = useState<string>('');
  // Zeitangebote: was der Nutzer angeboten hat, und das Formular dafuer.
  const [meineAngebote, setMeineAngebote] = useState<ShiftOffer[]>([]);
  const [angebotOffen, setAngebotOffen] = useState(false);
  const [angebotBezug, setAngebotBezug] = useState<{ shiftId: number; bereich: string } | null>(null);
  const [angebotDatum, setAngebotDatum] = useState('');
  const [angebotVon, setAngebotVon] = useState('09:00');
  const [angebotBis, setAngebotBis] = useState('12:00');
  const [angebotNotiz, setAngebotNotiz] = useState('');

  // Nach dem Speichern zeigt dasselbe Fenster den Dank, statt es zu schliessen.
  const [dankeSichtbar, setDankeSichtbar] = useState(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Belegung je Schicht (shiftId -> Anzahl). Kommt getrennt vom Server, damit
  // die Anzeige "3/8" moeglich ist, ohne dass der Client die Zusagen aller
  // anderen Teilnehmer erhaelt.
  const [shiftCounts, setShiftCounts] = useState<Record<number, number>>({});
  // Wann spielen die eigenen Kinder? Wenige Zeitfenster je Jahrgang; die
  // Ueberschneidung mit einer Schicht wird hier gerechnet.
  const [childPlaySlots, setChildPlaySlots] = useState<{ date: string; startMin: number; endMin: number; yearGroupName: string; children: string[] }[]>([]);
  // Fehler beim Laden der Verpflegung - damit die Liste nicht fälschlich leer
  // erscheint, wenn der Server nicht erreichbar war.
  const [foodFehler, setFoodFehler] = useState<unknown>(null);
  // Dasselbe für die Schichten. Wichtigster Fall überhaupt: Ohne diesen
  // Zustand sah ein nicht erreichbarer Server aus wie "du bist nirgends
  // eingeteilt" - und genau das glaubt dann auch der Helfer.
  const [schichtFehler, setSchichtFehler] = useState<unknown>(null);
  // Meldungen zu Planaenderungen. Sie stehen ganz oben, weil Push nur eine
  // Minderheit erreicht - sonst wuerde eine Verschiebung schlicht uebersehen.
  const [notifications, setNotifications] = useState<{ id: number; title: string; body: string; createdAt: string; stellvertretendFuer?: string | null }[]>([]);
  // PWA-Update: lag bisher im Burger-Menue und wurde dort kaum gesehen.
  const [updateVerfuegbar, setUpdateVerfuegbar] = useState(false);

  const applyAvailableData = (d: Record<string, any>) => {
    if (!d) return;

    const mapShift = (s: Record<string, any>) => ({
      ...s,
      date: s.day?.date || s.date,
      zeitslot: s.daySlot || s.timeSlot || s.zeitslot,
      arbeitsbereichId: s.workArea?.id || s.arbeitsbereichId,
      maxVolunteers: s.maxVolunteers,
      startMin: s.startMin ?? s.daySlot?.startMin ?? s.timeSlot?.startMin ?? null,
      endMin: s.endMin ?? s.daySlot?.endMin ?? s.timeSlot?.endMin ?? null,
      arbeitsbereich: s.workArea || s.arbeitsbereich
    });

    setShifts(d.shifts ? d.shifts.map(mapShift) : []);
    setShiftCounts(d.shiftAssignmentCounts || {});
    setChildPlaySlots(d.childPlaySlots || []);
    setNotifications(d.notifications || []);
    
    setVolunteerShifts(d.volunteerShifts ? d.volunteerShifts.map((vs: Record<string, any>) => ({
      ...vs,
      date: vs.shift?.day?.date || vs.shift?.date || vs.date,
      shift: vs.shift ? mapShift(vs.shift) : null
    })) : []);

    setBetreuteVolunteerShifts(d.betreuteVolunteerShifts ? d.betreuteVolunteerShifts.map((vs: Record<string, any>) => ({
      ...vs,
      date: vs.shift?.day?.date || vs.shift?.date || vs.date,
      shift: vs.shift ? mapShift(vs.shift) : null
    })) : []);

    if (d.tournament) {
      currentLoadedTournamentId.current = d.tournament.id;
      setSelectedTournamentId(d.tournament.id);
      setTournamentName(d.tournament.name || '');
      setTournament(d.tournament);
      fetchClubColors(d.tournament.id);
    }

    if (d.availableTournaments) {
      setAvailableTournaments(d.availableTournaments);
    }

    if (d.foodCategories) setFoodCategories(d.foodCategories);
    if (d.myDonations) setMyDonations(d.myDonations);
    if (d.foodDonationSlots) {
      setFoodDonationSlots(d.foodDonationSlots);
      const commitments: Record<number, number> = {};
      d.foodDonationSlots.forEach((slot: any) => {
        const matching = d.myDonations?.filter((md: any) => md.foodDonationSlotId === slot.id) || [];
        commitments[slot.id] = matching.reduce((sum: number, md: any) => sum + md.quantity, 0);
      });
      setSlotCommitments(commitments);
    }
  };

  const loadFood = async () => {
    try {
      setFoodFehler(null);
      // Bewusst OHNE catch(() => []): Ein gescheiterter Aufruf sah vorher aus
      // wie "es gibt keine Spenden". Der Fehler muss bis zum catch unten
      // durchkommen, damit die Oberfläche ihn anzeigen kann.
      const [cats, dons] = await Promise.all([
        apiFetch('/api/food/categories'),
        apiFetch('/api/food/donations')
      ]);
      setFoodCategories(cats);
      setMyDonations(dons.donations || []);

      const tId = selectedTournamentId || volunteer?.tournamentId;
      if (tId) {
        const allSlots = await apiFetch('/api/food-donation-slots?tournamentId=' + tId);
        const childYears = volunteer?.children?.map((c: any) => c.childYear).filter((y: any) => y != null) || [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const relevantSlots = allSlots.filter((slot: FoodDonationSlot) => {
          if (!slot.yearGroup) return false;
          if (slot.yearGroup.timeSlots && slot.yearGroup.timeSlots.length > 0) {
            const allPast = slot.yearGroup.timeSlots.every((ts: any) => new Date(ts.date) < today);
            if (allPast) return false;
          }
          const yg = slot.yearGroup;
          if (childYears.some((y: number) => yg.name.includes(String(y)))) return true;
          if (yg.birthYearStart != null && yg.birthYearEnd != null) {
            if (childYears.some((y: number) => y >= yg.birthYearStart && y <= yg.birthYearEnd)) return true;
          }
          if (childYears.includes(parseInt(yg.name))) return true;
          return false;
        });
        setFoodDonationSlots(relevantSlots);
      }
    } catch (e) {
      console.error(e);
      setFoodFehler(e);
    }
  };

  const submitDonation = async () => {
    if (!donationFoodId || !donationQuantity) {
      await modal.alert({ title: 'Hinweis', message: 'Artikel und Menge auswählen!' });
      return;
    }
    try {
      await apiPost('/api/food/donations', { foodItemId: donationFoodId, quantity: parseInt(donationQuantity, 10), note: donationNote || null });
      setDonationFoodId(0);
      setDonationQuantity('');
      setDonationNote('');
      await loadFood();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Fehler beim Eintragen' });
    }
  };

  const commitSlot = async (slotId: number, foodItemId?: number | null) => {
    if (!foodItemId) {
      await modal.alert({ title: 'Hinweis', message: 'Kein Artikel verfügbar!' });
      return;
    }
    const qty = slotCommitments[slotId] ?? 0;
    if (qty <= 0) {
      await modal.alert({ title: 'Hinweis', message: 'Bitte Menge eingeben!' });
      return;
    }
    try {
      await apiPost('/api/food/donations', { foodItemId: Number(foodItemId), quantity: qty, slotId });
      const newCommitments: Record<number, number> = {};
      Object.entries(slotCommitments).forEach(([k, v]) => { if (Number(k) !== slotId) newCommitments[Number(k)] = v; });
      setSlotCommitments(newCommitments);
      await loadFood();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Fehler beim Eintragen' });
    }
  };

  const removeCommitment = (slotId: number) => {
    const newCommitments: Record<number, number> = {};
    Object.entries(slotCommitments).forEach(([k, v]) => { if (Number(k) !== slotId) newCommitments[Number(k)] = v; });
    setSlotCommitments(newCommitments);
  };

  const cancelDonation = async (id: number) => {
    try {
      await apiDelete('/api/food/donations/' + id);
      await loadFood();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Fehler beim Löschen' });
    }
  };

  const loadAvailable = async (tId?: number) => {
    if (!isLoggedIn) return;
    try {
      const url = tId ? `/api/self/available?tournamentId=${tId}` : '/api/self/available';
      const d = await apiFetch(url);
      applyAvailableData(d);
      setSchichtFehler(null);
      if (d.volunteer) {
        login(token, d.volunteer);
      }
    } catch (e) {
      console.error(e);
      setSchichtFehler(e);
    }
  };

  useEffect(() => {
    loadAvailable();
    const interval = setInterval(loadAvailable, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadAvailable(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    const onStartTour = () => startTour();
    window.addEventListener('start-tour', onStartTour);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('start-tour', onStartTour);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (selectedTournamentId !== null && selectedTournamentId !== currentLoadedTournamentId.current) {
      loadAvailable(selectedTournamentId);
      if (activeSection === 'verpflegung') {
        loadFood();
      }
    }
  }, [selectedTournamentId]);

  const startTour = () => {
    const steps: DriveStep[] = [];
    steps.push(
      { element: '#tour-filter', popover: { title: 'Schichten filtern', description: 'Finde schneller die passende Schicht, indem du nach einem bestimmten Tag filterst.', side: 'bottom' } },
      { element: '#tour-tabs', popover: { title: 'Aufgaben-Bereiche', description: 'Wechsle hier zwischen Helfer-Schichten und Verpflegungs-Spenden (z.B. Kuchen oder Salate).', side: 'top' } },
      { element: '#tour-myshifts', popover: { title: 'Deine Zusagen', description: 'Hier findest du immer deine bereits zugesagten Schichten und Spenden im Überblick.', side: 'top' } }
    );
    const driverObj = driver({
      showProgress: true,
      nextBtnText: 'Weiter',
      prevBtnText: 'Zurück',
      doneBtnText: 'Fertig',
      steps
    });
    driverObj.drive();
    localStorage.setItem('hasSeenTour', 'true');
  };

  useEffect(() => {
    const beiUpdate = () => setUpdateVerfuegbar(true);
    window.addEventListener('pwa-update-available', beiUpdate);
    return () => window.removeEventListener('pwa-update-available', beiUpdate);
  }, []);

  const meldungenBestaetigen = async () => {
    const ids = notifications.map(n => n.id);
    setNotifications([]);            // sofort ausblenden, der Server folgt
    try {
      await apiPost('/api/self/notifications/read', { ids });
    } catch {
      // Nicht schlimm: beim naechsten Laden erscheinen sie erneut.
    }
  };

  // Pull-to-refresh logic
  const touchStartY = useRef(0);
  const scrollStartY = useRef(0);
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
      scrollStartY.current = window.scrollY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (scrollStartY.current > 0 || refreshing) return;
      const touchY = e.touches[0].clientY;
      const pull = touchY - touchStartY.current;
      if (pull > 0) {
        setPullDistance(Math.min(pull * 0.4, 80));
        if (pull > 50 && e.cancelable) e.preventDefault();
      }
    };
    const handleTouchEnd = async () => {
      if (pullDistance > 60 && !refreshing) {
        setRefreshing(true);
        setPullDistance(60);
        await loadAvailable();
        setPullDistance(0);
        setRefreshing(false);
      } else {
        setPullDistance(0);
      }
    };
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, refreshing]);

  const signUp = async (shift: Shift) => {
    if (busy) return;
    if (isPastShift(shift.date, shift.endMin)) {
      await modal.alert({ title: 'Fehler', message: 'Diese Schicht liegt in der Vergangenheit.' });
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/self/assign', {
        shiftId: shift.id
      });
      await loadAvailable();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Schicht konnte nicht übernommen werden.' });
    } finally {
      setBusy(false);
    }
  };

  const cancelShift = async (vs: VolunteerShift) => {
    if (busy) return;
    if (isPastShift(vs.date, vs.shift?.endMin)) {
      await modal.alert({ title: 'Fehler', message: 'Diese Schicht liegt in der Vergangenheit und kann nicht mehr storniert werden.' });
      return;
    }
    setBusy(true);
    try {
      await apiDelete(`/api/self/unassign/${vs.id}`);
      await loadAvailable();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Schicht konnte nicht storniert werden.' });
    } finally {
      setBusy(false);
    }
  };

  /** "09:30" -> Minuten seit Mitternacht. */
  const zeitZuMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const ladeMeineAngebote = useCallback(async () => {
    try {
      setMeineAngebote(await apiFetch('/api/shift-offers/mine') || []);
    } catch {
      // Angebote sind Beiwerk - ihr Fehlschlag darf das Dashboard nicht stoeren.
    }
  }, []);

  useEffect(() => { if (isLoggedIn) ladeMeineAngebote(); }, [isLoggedIn, ladeMeineAngebote]);

  /** Formular oeffnen - mit Bezug auf eine Schicht oder als freies Angebot. */
  const oeffneAngebot = (bezug: { shiftId: number; bereich: string; datum: string; startMin: number; endMin: number } | null) => {
    setAngebotBezug(bezug ? { shiftId: bezug.shiftId, bereich: bezug.bereich } : null);
    // Ein Vorschlag als Startpunkt: die Schichtzeit selbst, sonst der erste
    // Turniertag. Ein leeres Formular beantwortet niemand gern.
    const tag = bezug?.datum ?? shifts[0]?.date ?? new Date().toISOString();
    setAngebotDatum(new Date(tag).toISOString().slice(0, 10));
    if (bezug) {
      setAngebotVon(minToTime(bezug.startMin));
      setAngebotBis(minToTime(bezug.endMin));
    }
    setAngebotNotiz('');
    setAngebotOffen(true);
  };

  const sendeAngebot = async () => {
    if (!selectedTournamentId || busy) return;
    const von = zeitZuMin(angebotVon), bis = zeitZuMin(angebotBis);
    if (bis <= von) {
      return await modal.alert({ title: 'Hinweis', message: 'Die Endzeit muss nach der Startzeit liegen.' });
    }
    setBusy(true);
    try {
      await apiPost('/api/shift-offers', {
        tournamentId: selectedTournamentId,
        shiftId: angebotBezug?.shiftId ?? null,
        date: new Date(angebotDatum + 'T00:00:00.000Z').toISOString(),
        startMin: von, endMin: bis,
        note: angebotNotiz.trim() || null
      });
      setAngebotOffen(false);
      await ladeMeineAngebote();
      await modal.alert({
        title: 'Danke!',
        message: 'Wir haben deine Zeit notiert und melden uns, sobald wir wissen, ob es passt.'
      });
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Das Angebot konnte nicht gesendet werden.' });
    } finally {
      setBusy(false);
    }
  };

  const ziehAngebotZurueck = async (id: number) => {
    if (!(await modal.confirm({ title: 'Angebot zurückziehen', message: 'Möchtest du dein Zeitangebot zurückziehen?' }))) return;
    try {
      await apiDelete(`/api/shift-offers/${id}`);
      await ladeMeineAngebote();
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Das Angebot konnte nicht zurückgezogen werden.' });
    }
  };

  /** Hat der Helfer diese Schicht schon bewertet? Ein einzelnes Feld genuegt -
   *  das Formular speichert immer alle drei Stufen zusammen. */
  const bereitsBewertet = (vs: VolunteerShift) =>
    vs.ratingWorkload != null || vs.ratingOrganization != null || vs.ratingFun != null;

  // Voreinstellung beim Oeffnen: eine schon abgegebene Bewertung laesst sich so
  // korrigieren, statt bei null zu beginnen. Ohne Vorbewertung die neutrale
  // Mitte - eine Skala, die bei 1 startet, faerbt die Antwort.
  const openRatingModal = (vs: VolunteerShift) => {
    setDankeSichtbar(false);
    setRatingModalVs(vs);
    setRateWorkload(vs.ratingWorkload ?? 3);
    setRateOrganization(vs.ratingOrganization ?? 3);
    setRateFun(vs.ratingFun ?? 3);
    setRateComment(vs.ratingComment ?? '');
  };

  const saveRating = async () => {
    if (!ratingModalVs || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/self/shifts/${ratingModalVs.id}/rating`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ratingWorkload: rateWorkload,
          ratingOrganization: rateOrganization,
          ratingFun: rateFun,
          // Leerer Text heisst "keine Anmerkung" und nicht "leerer Kommentar" -
          // sonst taucht er in der Auswertung als leere Zeile auf.
          ratingComment: rateComment.trim() || null
        })
      });
      // Kein zweiter Dialog, den man wegklicken muss: Das Formular wird selbst
      // zum Dankeschoen und verabschiedet sich nach ein paar Sekunden. Wer
      // gerade fuenf Felder ausgefuellt hat, soll nicht noch auf "OK" tippen.
      setDankeSichtbar(true);
      await loadAvailable();
      queryClient.invalidateQueries({ queryKey: ['volunteerShifts'] });
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Bewertung konnte nicht gespeichert werden.' });
    } finally {
      setBusy(false);
    }
  };

  // Das Dankeschoen verabschiedet sich von selbst - wer will, tippt vorher
  // "Fertig". Der Timer wird aufgeraeumt, falls genau das passiert.
  useEffect(() => {
    if (!dankeSichtbar) return;
    const timer = setTimeout(() => setRatingModalVs(null), 4000);
    return () => clearTimeout(timer);
  }, [dankeSichtbar]);

  const TIME_BLOCKS = {
    morgen: { label: 'Morgen', startMin: 0, endMin: 720 },
    mittag: { label: 'Mittag', startMin: 720, endMin: 840 },
    nachmittag: { label: 'Nachmittag', startMin: 840, endMin: 1080 },
    abend: { label: 'Abend', startMin: 1080, endMin: 1440 }
  } as const;

  const minToTime = (min: number | null | undefined) => {
    if (min == null) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const shiftOverlapsBlock = (startMin: number | null | undefined, endMin: number | null | undefined, block: { startMin: number; endMin: number }): boolean => {
    if (startMin == null) return false;
    const end = endMin != null && endMin > startMin ? endMin : startMin + 1;
    return startMin < block.endMin && end > block.startMin;
  };

  const isPastShift = (dateStr: string, endMin: number | null | undefined): boolean => {
    if (!dateStr) return false;
    const end = new Date(dateStr);
    if (endMin != null) end.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
    else end.setHours(23, 59, 59, 999);
    return new Date() > end;
  };

  /**
   * Ueberschneidung einer Schicht mit den Spielzeiten der eigenen Kinder.
   * Gibt null zurueck, wenn es keine gibt - dann wird auch nichts angezeigt,
   * damit die Karten nicht unnoetig wachsen.
   */
  const spielKollision = (datum: string | null | undefined, startMin?: number | null, endMin?: number | null) => {
    if (!datum || startMin == null || endMin == null) return null;
    const tag = String(datum).slice(0, 10);
    const treffer = childPlaySlots.filter(p => String(p.date).slice(0, 10) === tag && p.startMin < endMin && p.endMin > startMin);
    if (treffer.length === 0) return null;

    const von = Math.max(startMin, Math.min(...treffer.map(p => p.startMin)));
    const bis = Math.min(endMin, Math.max(...treffer.map(p => p.endMin)));
    const kinder = Array.from(new Set(treffer.flatMap(p => p.children)));
    // "durchgehend" nur, wenn die Schicht komplett in der Spielzeit liegt.
    const durchgehend = treffer.some(p => p.startMin <= startMin && p.endMin >= endMin);
    return { von, bis, kinder, durchgehend };
  };

  const SpielHinweis = ({ datum, startMin, endMin }: { datum: string | null | undefined; startMin?: number | null; endMin?: number | null }) => {
    const k = spielKollision(datum, startMin, endMin);
    if (!k) return null;
    return (
      <div
        title={`${k.kinder.join(', ')} spielt ${minToTime(k.von)}–${minToTime(k.bis)} (${k.durchgehend ? 'während der ganzen Schicht' : 'teilweise während der Schicht'})`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
          background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: 999,
          padding: '2px 8px', fontSize: 12, color: '#664d03', maxWidth: '100%'
        }}
      >
        <span aria-hidden="true">⚽</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {k.kinder.join(', ')} {k.durchgehend ? 'spielt durchgehend' : `spielt ${minToTime(k.von)}–${minToTime(k.bis)}`}
        </span>
      </div>
    );
  };

  const FillBar = ({ assigned, max }: { assigned: number; max: number }) => {
    const ratio = max > 0 ? Math.min(1, assigned / max) : 0;
    const color = ratio >= 1 ? '#198754' : ratio > 0 ? '#ffc107' : '#dc3545';
    return (
      <div className="dashboard-progress-bg">
        <div className="dashboard-progress-fill" style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
    );
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Filter Shifts
  const filteredShifts = shifts.filter(s => {
    // Exclude assigned shifts from open shifts
    if (volunteerShifts.some(vs => vs.shift?.id === s.id)) return false;
    
    if (filterDate && s.date !== filterDate) return false;
    if (filterTimesOfDay.size > 0) {
      let matchesTime = false;
      for (const t of filterTimesOfDay) {
        if (shiftOverlapsBlock(s.startMin, s.endMin, TIME_BLOCKS[t])) {
          matchesTime = true;
          break;
        }
      }
      if (!matchesTime) return false;
    }
    return true;
  });

  const groupedShifts = filteredShifts.reduce((acc, shift) => {
    const d = shift.date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(shift);
    return acc;
  }, {} as Record<string, Shift[]>);

  const sortedDates = Object.keys(groupedShifts).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  sortedDates.forEach(d => {
    groupedShifts[d].sort((a, b) => {
      if (a.startMin !== b.startMin) return (a.startMin || 0) - (b.startMin || 0);
      return (a.arbeitsbereich?.name || '').localeCompare(b.arbeitsbereich?.name || '');
    });
  });

  const sortedMyShifts = [...volunteerShifts].sort((a, b) => {
    const timeA = new Date(a.date).getTime() + ((a.shift?.startMin || 0) * 60000);
    const timeB = new Date(b.date).getTime() + ((b.shift?.startMin || 0) * 60000);
    return timeA - timeB;
  });

  const zeitpunkt = (vs: VolunteerShift) => new Date(vs.date).getTime() + ((vs.shift?.startMin || 0) * 60000);

  // Nach betreuter Person gruppiert, damit "meine" und "die von X" nie in
  // einer Liste vermischt werden - genau das hatte zur irrefuehrenden
  // Push-Meldung gefuehrt, die den Anstoss fuer diesen Abschnitt gab.
  const betreuteGruppen = (() => {
    const gruppen = new Map<number, { name: string; shifts: VolunteerShift[] }>();
    for (const vs of betreuteVolunteerShifts) {
      const personId = vs.user?.id ?? -1;
      if (!gruppen.has(personId)) gruppen.set(personId, { name: vs.user?.name || 'Unbekannt', shifts: [] });
      gruppen.get(personId)!.shifts.push(vs);
    }
    for (const gruppe of gruppen.values()) gruppe.shifts.sort((a, b) => zeitpunkt(a) - zeitpunkt(b));
    return Array.from(gruppen.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Überschrift über den Meldungen: "an deinem Dienstplan" stimmt nur, wenn es
  // wirklich der eigene ist. Ein Badge an jeder einzelnen Meldung wirkte dafür
  // zu unruhig und passte nicht zum Rest des Kastens - die Überschrift selbst
  // trägt die Information jetzt stattdessen.
  const meldungsUeberschrift = (() => {
    const fremdeNamen = Array.from(new Set(
      notifications.filter(n => n.stellvertretendFuer).map(n => n.stellvertretendFuer as string)
    ));
    const nurEigene = fremdeNamen.length === 0;
    const nurEinePersonBetreut = !nurEigene && fremdeNamen.length === 1
      && notifications.every(n => n.stellvertretendFuer === fremdeNamen[0]);

    if (nurEigene) {
      return notifications.length === 1 ? 'Änderung an deinem Dienstplan' : `${notifications.length} Änderungen an deinem Dienstplan`;
    }
    if (nurEinePersonBetreut) {
      return notifications.length === 1
        ? `Änderung am Dienstplan von ${fremdeNamen[0]}`
        : `${notifications.length} Änderungen am Dienstplan von ${fremdeNamen[0]}`;
    }
    // Eigene und fremde gemischt, oder mehrere verschiedene betreute Personen -
    // wer wofür betroffen ist, steht bereits im Text jeder einzelnen Meldung.
    return `${notifications.length} Planänderungen`;
  })();

  return (
    <div>
      {/* PTR Indicator */}
      <div className="dashboard-ptr-indicator" style={{ height: pullDistance, transition: refreshing ? "height 0.3s" : "none" }}>
        <div className="dashboard-ptr-indicator-icon" style={{ transform: `rotate(${pullDistance * 4}deg)`, opacity: pullDistance / 60, color: clubSecondary }}>↻</div>
        {/* Ohne Beschriftung findet das Ziehen kaum jemand - das Symbol allein
            erklaert sich erst, wenn man es schon kennt. */}
        {pullDistance > 12 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', opacity: Math.min(1, pullDistance / 60) }}>
            {refreshing ? 'Wird aktualisiert…' : pullDistance > 60 ? 'Loslassen zum Aktualisieren' : 'Zum Aktualisieren ziehen'}
          </div>
        )}
      </div>
      
      {/* Meldungen ganz oben - vor allem anderen, damit eine Planaenderung
          nicht uebersehen wird. Gleiche Optik wie der Update-Hinweis. */}
      {updateVerfuegbar && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 12, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }} aria-hidden="true">🔄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#664d03' }}>Neue Version verfügbar</div>
            <div style={{ fontSize: 13, color: '#664d03' }}>Jetzt neu laden, um sie zu nutzen.</div>
          </div>
          <button
            onClick={() => { const w = window as any; if (w.updatePWA) w.updatePWA(true); else window.location.reload(); }}
            style={{ background: '#ffc107', color: '#000', border: 'none', borderRadius: 8, padding: '10px 14px', minHeight: 44, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
          >Neu laden</button>
        </div>
      )}

      {notifications.length > 0 && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }} aria-hidden="true">📣</span>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#664d03', flex: 1 }}>
              {meldungsUeberschrift}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notifications.map(n => (
              <div key={n.id} style={{ background: '#fff', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#212529' }}>{n.title}</div>
                <div style={{ fontSize: 13, color: '#495057', lineHeight: 1.5 }}>{n.body}</div>
                <div style={{ fontSize: 11, color: '#adb5bd', marginTop: 2 }}>
                  {new Date(n.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={meldungenBestaetigen}
            style={{ marginTop: 10, width: '100%', background: '#ffc107', color: '#000', border: 'none', borderRadius: 8, padding: '10px 14px', minHeight: 44, fontWeight: 600, cursor: 'pointer' }}
          >Verstanden</button>
        </div>
      )}

      {/* TABS */}
      <div id="tour-tabs" className="dashboard-tabs-wrapper">
        <button onClick={() => setActiveSection('jobs')} className={`dashboard-pill-tab ${activeSection === "jobs" ? "active" : ""}`} style={{ background: activeSection === "jobs" ? clubSecondary : 'var(--bg-surface)', color: activeSection === "jobs" ? '#fff' : 'var(--text-muted)' }}>📋 Jobs</button>
        <button onClick={() => { setActiveSection('verpflegung'); loadFood(); }} className={`dashboard-pill-tab ${activeSection === "verpflegung" ? "active" : ""}`} style={{ background: activeSection === "verpflegung" ? clubSecondary : 'var(--bg-surface)', color: activeSection === "verpflegung" ? '#fff' : 'var(--text-muted)' }}>🍔 Verpflegung</button>
      </div>

      <div className="dashboard-content">
        {activeSection === 'jobs' && (
          <>
            {/* Konnte der Dienstplan nicht geladen werden, darf hier NICHT
                "keine Schichten" stehen - sonst hält sich jemand für nicht
                eingeteilt, obwohl er es ist. */}
            {schichtFehler != null && (
              <div style={{ marginBottom: 16 }}>
                <Ladefehler was="Deine Schichten" fehler={schichtFehler} erneut={() => loadAvailable()} />
              </div>
            )}

            {/* My Shifts */}
            {sortedMyShifts.length > 0 && (
              <div id="tour-myshifts" className="dashboard-my-shifts-container" style={{ background: '#fff', border: `2px solid ${clubPrimary}`, borderRadius: 16 }}>
                <h3 className="dashboard-my-shifts-title" style={{ color: clubPrimary, borderBottom: '1px solid #e9ecef', paddingBottom: 8, marginBottom: 12 }}>
                  <span>⭐</span> Deine Jobs ({sortedMyShifts.length})
                </h3>
                <div className="dashboard-shifts-list">
                  {sortedMyShifts.map((vs, idx) => {
                    const isPast = isPastShift(vs.date, vs.shift?.endMin);
                    const d = new Date(vs.date);
                    const prevVs = idx > 0 ? sortedMyShifts[idx - 1] : null;
                    const showDayHeader = !prevVs || new Date(prevVs.date).toDateString() !== d.toDateString();
                    const assignedCount = vs.shift?.id != null ? (shiftCounts[vs.shift.id] ?? 0) : 0;
                    const remaining = (vs.shift?.maxVolunteers || 0) - assignedCount;

                    return (
                      <div key={vs.id || idx}>
                        {showDayHeader && (
                          <div className="dashboard-shift-day-header" style={{ color: clubPrimary, marginTop: idx > 0 ? 8 : 0 }}>
                            {d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}
                          </div>
                        )}
                        <div className={`dashboard-shift-card ${isPast ? "dashboard-shift-card-past" : ""}`} style={{ borderLeft: `4px solid ${clubAccent}` }}>
                          <div className="dashboard-shift-card-inner">
                            <div className="dashboard-shift-title">
                              {vs.shift?.arbeitsbereich?.icon} <span>{vs.shift?.arbeitsbereich?.name || vs.role}</span>
                            </div>
                            <div className="dashboard-shift-time">
                              <span>{vs.shift?.startMin != null ? `${minToTime(vs.shift.startMin)}-${minToTime(vs.shift.endMin || vs.shift.startMin + 60)}` : vs.shift?.zeitslot?.name || vs.slot}</span>
                            </div>
                            <SpielHinweis datum={vs.date} startMin={vs.shift?.startMin} endMin={vs.shift?.endMin} />
                          </div>
                          <div className="dashboard-shift-actions">
                            {vs.shift && (
                              <div className="dashboard-shift-remaining" style={{ color: remaining > 0 ? clubAccent : '#dc3545' }}>
                                {assignedCount}/{vs.shift.maxVolunteers}
                              </div>
                            )}
                            {isPast ? (
                              <button
                                onClick={() => openRatingModal(vs)}
                                title={bereitsBewertet(vs) ? 'Bewertung bearbeiten' : 'Schicht bewerten'}
                                style={bereitsBewertet(vs)
                                  ? { background: '#ffc107', color: '#000' }
                                  : { background: '#0d6efd', color: '#fff' }}
                                className="dashboard-btn-action"
                              >
                                {bereitsBewertet(vs) ? '✏️' : '📝'}
                              </button>
                            ) : (
                              <button onClick={() => cancelShift(vs)} disabled={busy} className="dashboard-btn-action" style={{ background: '#fde8e8', color: '#dc3545' }}>
                                ❌
                              </button>
                            )}
                          </div>
                          {vs.shift && (
                            <FillBar assigned={assignedCount} max={vs.shift.maxVolunteers || 0} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Schichten betreuter Helfer ohne App-Zugang - z.B. das eigene
                Kind. Gestrichelter statt durchgezogener Rahmen, damit auf den
                ersten Blick klar ist: das sind nicht die eigenen Jobs. */}
            {betreuteGruppen.map(gruppe => (
              <div key={gruppe.name} className="dashboard-my-shifts-container" style={{ background: '#fff', border: `2px dashed ${clubPrimary}`, borderRadius: 16, marginTop: 16 }}>
                <h3 className="dashboard-my-shifts-title" style={{ color: clubPrimary, borderBottom: '1px solid #e9ecef', paddingBottom: 8, marginBottom: 12 }}>
                  <span>🧑‍🤝‍🧑</span> Schichten von {gruppe.name} ({gruppe.shifts.length})
                </h3>
                <div className="dashboard-shifts-list">
                  {gruppe.shifts.map((vs, idx) => {
                    const isPast = isPastShift(vs.date, vs.shift?.endMin);
                    const d = new Date(vs.date);
                    const prevVs = idx > 0 ? gruppe.shifts[idx - 1] : null;
                    const showDayHeader = !prevVs || new Date(prevVs.date).toDateString() !== d.toDateString();
                    const assignedCount = vs.shift?.id != null ? (shiftCounts[vs.shift.id] ?? 0) : 0;

                    return (
                      <div key={vs.id || idx}>
                        {showDayHeader && (
                          <div className="dashboard-shift-day-header" style={{ color: clubPrimary, marginTop: idx > 0 ? 8 : 0 }}>
                            {d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}
                          </div>
                        )}
                        <div className={`dashboard-shift-card ${isPast ? "dashboard-shift-card-past" : ""}`} style={{ borderLeft: `4px solid ${clubAccent}` }}>
                          <div className="dashboard-shift-card-inner">
                            <div className="dashboard-shift-title">
                              {vs.shift?.arbeitsbereich?.icon} <span>{vs.shift?.arbeitsbereich?.name || vs.role}</span>
                            </div>
                            <div className="dashboard-shift-time">
                              <span>{vs.shift?.startMin != null ? `${minToTime(vs.shift.startMin)}-${minToTime(vs.shift.endMin || vs.shift.startMin + 60)}` : vs.shift?.zeitslot?.name || vs.slot}</span>
                            </div>
                          </div>
                          <div className="dashboard-shift-actions">
                            {vs.shift && (
                              <div className="dashboard-shift-remaining" style={{ color: clubAccent }}>
                                {assignedCount}/{vs.shift.maxVolunteers}
                              </div>
                            )}
                          </div>
                          {vs.shift && (
                            <FillBar assigned={assignedCount} max={vs.shift.maxVolunteers || 0} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Filter */}
            <div id="tour-filter" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24, marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {Array.from(new Set(shifts.map(s => s.date))).sort().map((date: any) => (
                    <button
                      key={date}
                      onClick={() => setFilterDate(date === filterDate ? '' : date)}
                      style={{
                        border: 'none',
                        cursor: 'pointer',
                        flex: 'none',
                        padding: '10px 16px',
                        borderRadius: 24,
                        fontWeight: 700,
                        fontSize: 14,
                        background: filterDate === date ? clubPrimary : '#fff',
                        color: filterDate === date ? '#fff' : '#212529',
                        boxShadow: filterDate === date ? '0 4px 12px rgba(13,110,253,0.3)' : '0 2px 6px rgba(0,0,0,0.06)'
                      }}
                    >{new Date(date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4 }}>
                  {(Object.keys(TIME_BLOCKS) as Array<keyof typeof TIME_BLOCKS>).map(block => (
                    <button
                      key={block}
                      onClick={() => {
                        const newSet = new Set(filterTimesOfDay);
                        if (newSet.has(block)) newSet.delete(block); else newSet.add(block);
                        setFilterTimesOfDay(newSet);
                      }}
                      style={{
                        border: 'none',
                        cursor: 'pointer',
                        flex: 'none',
                        padding: '8px 12px',
                        borderRadius: 24,
                        fontWeight: 700,
                        fontSize: 13,
                        background: filterTimesOfDay.has(block) ? clubPrimary : '#fff',
                        color: filterTimesOfDay.has(block) ? '#fff' : '#212529',
                        boxShadow: filterTimesOfDay.has(block) ? '0 4px 12px rgba(13,110,253,0.3)' : '0 2px 6px rgba(0,0,0,0.06)'
                      }}
                    >{TIME_BLOCKS[block].label}</button>
                  ))}
                </div>
              </div>

            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: clubPrimary }}>Offene Jobs</h3>

            {/* Available Shifts */}
            {filteredShifts.length > 0 ? (
              <div className="dashboard-dates-container">
                {sortedDates.map(dateStr => (
                  <div key={dateStr}>
                    <h3 className="dashboard-date-header">
                      {new Date(dateStr).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </h3>
                    <div className="dashboard-shifts-grid">
                      {groupedShifts[dateStr].map((s, idx) => {
                        const assignedCount = shiftCounts[s.id] ?? 0;
                        const isFull = assignedCount >= s.maxVolunteers;
                        const amIAssigned = volunteerShifts.some(vs => vs.shift?.id === s.id);
                        const isPast = isPastShift(s.date, s.endMin);

                        return (
                          <div key={idx} className={`dashboard-shift-card ${isPast || isFull ? "dashboard-shift-card-past" : ""}`} style={{ borderLeft: `6px solid ${clubAccent}`, paddingBottom: 20 }}>
                            <div className="dashboard-shift-card-inner">
                              <div className="dashboard-shift-title">{s.arbeitsbereich?.icon} <span>{s.arbeitsbereich?.name}</span></div>
                              <div className="dashboard-shift-time dashboard-shift-time-margin"><span>{s.startMin != null && s.endMin != null ? `${minToTime(s.startMin)}-${minToTime(s.endMin)}` : s.zeitslot?.name}</span></div>
                              <SpielHinweis datum={s.date} startMin={s.startMin} endMin={s.endMin} />
                            </div>
                            <div className="dashboard-shift-footer" style={{ gap: 16 }}>
                              <div className={`dashboard-shift-status ${isFull ? "full" : "open"}`}>{assignedCount}/{s.maxVolunteers}</div>
                              {!isPast && !isFull && !amIAssigned && (
                                <button onClick={() => signUp(s)} disabled={busy} className="dashboard-btn-action" style={{ background: clubPrimary, color: '#fff', fontSize: 24, fontWeight: 'bold' }}>
                                  +
                                </button>
                              )}
                              {amIAssigned && <div className="dashboard-shift-assigned-text" style={{ color: clubPrimary }}>✓ Deine Schicht</div>}
                              {isPast && !amIAssigned && <div className="dashboard-shift-past-text">Abgelaufen</div>}
                            </div>
                            <FillBar assigned={assignedCount} max={s.maxVolunteers} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : schichtFehler != null ? null : (
              /* Der leere Zustand gilt nur, wenn wirklich nichts da ist.
                 Bei einem Ladefehler steht oben bereits die Fehlermeldung -
                 beides zugleich hiesse "es gibt nichts UND es ging schief". */
              <div className="dashboard-empty-state">
                <img src="/404-dog.webp" alt="Keine Schichten" style={{ maxWidth: 200, margin: '0 auto 16px', display: 'block' }} />
                <div className="dashboard-empty-title">Keine Schichten gefunden</div>
                <div className="dashboard-empty-desc">Für die gewählten Filter gibt es aktuell keine offenen Schichten.</div>
              </div>
            )}

            {/* Wer keine passende Schicht findet, soll nicht wortlos abspringen:
                Eine Stunde, die nicht ins Raster passt, ist immer noch eine
                Stunde mehr als gar keine. */}
            {selectedTournamentId && (
              <div className="angebot-hinweis">
                <div className="angebot-hinweis-text">
                  <strong>Keine Schicht dabei, die passt?</strong>
                  <span>
                    Sag uns einfach, wann du Zeit hättest – wir schauen, ob wir daraus
                    etwas machen können.
                  </span>
                </div>
                <button
                  className="angebot-hinweis-btn"
                  style={{ background: clubPrimary }}
                  onClick={() => oeffneAngebot(null)}
                >
                  🙋 Zeit anbieten
                </button>
              </div>
            )}

            {meineAngebote.length > 0 && (
              <div className="angebot-liste">
                <h4 className="angebot-liste-titel">Deine Angebote</h4>
                {meineAngebote.map(a => (
                  <div key={a.id} className={`angebot-karte angebot-karte--${a.status.toLowerCase()}`}>
                    <div className="angebot-karte-zeit">
                      {new Date(a.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                      {' · '}{minToTime(a.startMin)}–{minToTime(a.endMin)}
                      {a.shift?.arbeitsbereich?.name && <> · {a.shift.arbeitsbereich.name}</>}
                    </div>
                    {a.note && <div className="angebot-karte-notiz">„{a.note}"</div>}
                    <div className="angebot-karte-fuss">
                      <span className={`angebot-status angebot-status--${a.status.toLowerCase()}`}>
                        {a.status === 'OFFEN' ? '⏳ Wird geprüft'
                          : a.status === 'ANGENOMMEN' ? '👍 Angenommen'
                          : 'Diesmal nicht'}
                      </span>
                      {a.status === 'OFFEN' && (
                        <button className="angebot-zurueck" onClick={() => ziehAngebotZurueck(a.id)}>
                          zurückziehen
                        </button>
                      )}
                    </div>
                    {a.decisionNote && <div className="angebot-karte-notiz">Rückmeldung: {a.decisionNote}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeSection === 'verpflegung' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Konnte nicht geladen werden? Dann NICHT so tun, als gäbe es
                nichts zu spenden - das war der gemeldete Fehler. */}
            {foodFehler != null && (
              <Ladefehler was="Die Verpflegung" fehler={foodFehler} erneut={loadFood} />
            )}

            {/* Meine Einträge */}
            {myDonations.length > 0 && (
              <div className="dashboard-my-shifts-container" style={{ background: '#fff', border: `2px solid ${clubPrimary}`, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <h3 className="dashboard-my-shifts-title" style={{ color: clubPrimary, borderBottom: '1px solid #e9ecef', paddingBottom: 8, marginBottom: 12 }}>
                  <span>⭐</span> Meine Einträge ({myDonations.length})
                </h3>
                {(() => {
                  const grouped: Record<string, FoodDonation[]> = {};
                  myDonations.forEach(d => {
                    let groupName = 'Ohne Zuordnung';
                    if (d.foodDonationSlotId) {
                      const slot = foodDonationSlots.find(s => s.id === d.foodDonationSlotId);
                      if (!slot) return; // Hide donations for past/unrelated slots

                      if (slot.yearGroup) {
                        let dateStr = '';
                        if (slot.yearGroup.timeSlots && slot.yearGroup.timeSlots.length > 0) {
                          const dates = Array.from(new Set(slot.yearGroup.timeSlots.map((ts: any) => new Date(ts.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }))));
                          dateStr = ` am ${dates.join(' & ')}`;
                        }

                        const matchingChildren = volunteer?.children?.filter((c: any) => {
                          if (!c.childYear) return false;
                          const yg = slot.yearGroup;
                          if (yg && yg.name.includes(String(c.childYear))) return true;
                          if (yg && yg.birthYearStart != null && yg.birthYearEnd != null) {
                            return c.childYear >= yg.birthYearStart && c.childYear <= yg.birthYearEnd;
                          }
                          if (yg && c.childYear === parseInt(yg.name)) return true;
                          return false;
                        }) || [];
                        
                        let childNameStr = slot.yearGroup.name;
                        if (matchingChildren.length > 0) {
                          childNameStr = matchingChildren.map((c: any) => c.childName).join(' & ');
                        }
                        
                        groupName = `${childNameStr}${dateStr}`;
                      }
                    }
                    if (!grouped[groupName]) grouped[groupName] = [];
                    grouped[groupName].push(d);
                  });
                  
                  return Object.entries(grouped).sort(([nameA, a], [nameB, b]) => {
                    if (nameA === 'Ohne Zuordnung') return 1;
                    if (nameB === 'Ohne Zuordnung') return -1;
                    const getEarliest = (donations: FoodDonation[]) => {
                      let earliest = Infinity;
                      donations.forEach(d => {
                        const slot = foodDonationSlots.find(s => s.id === d.foodDonationSlotId);
                        if (slot?.yearGroup?.timeSlots) {
                          slot.yearGroup.timeSlots.forEach((ts: any) => {
                            const t = new Date(ts.date).getTime();
                            if (t < earliest) earliest = t;
                          });
                        }
                      });
                      return earliest;
                    };
                    return getEarliest(a) - getEarliest(b);
                  }).map(([groupName, donations], index, arr) => (
                    <div key={groupName} style={{ marginBottom: index === arr.length - 1 ? 0 : 20 }}>
                      <div style={{ fontSize: 13, fontWeight: '600', color: '#6c757d', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #e9ecef', paddingBottom: 4 }}>
                        {groupName === 'Ohne Zuordnung' ? groupName : `👶 Für ${groupName}`}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {donations.map(d => (
                          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#f8f9fa', borderRadius: 10 }}>
                            <div style={{ fontSize: 24 }}>{d.foodItem?.category?.icon || '❓'}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: '600', fontSize: 14, color: '#333' }}>{d.foodItem?.name || '-'}</div>
                              <div style={{ fontSize: 12, color: '#999' }}>{d.quantity} {d.foodItem?.unit} • {new Date(d.createdAt).toLocaleDateString('de-DE')}</div>
                              {d.note && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{d.note}</div>}
                            </div>
                            <button type="button" onClick={() => cancelDonation(d.id)} title="Löschen" style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: '#fde8e8', color: '#dc3545', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🗑️</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Verpflegung für Kinder */}
            {foodDonationSlots.length > 0 && (
              <div className="dashboard-section" style={{ animation: 'fadeIn 0.4s ease-out' }}>
                <h3 className="dashboard-section-title">Verpflegung für deine Kinder</h3>
                {(() => {
                  type SlotWithInfo = FoodDonationSlot & { childrenStr: string };
                  const groupedByDate: Record<string, SlotWithInfo[]> = {};
                  
                  foodDonationSlots.forEach(slot => {
                    const matchingChildren = volunteer?.children?.filter(c => {
                      if (!c.childYear || !slot.yearGroup) return false;
                      const yg = slot.yearGroup;
                      if (yg.name.includes(String(c.childYear))) return true;
                      if (yg.birthYearStart != null && yg.birthYearEnd != null) {
                        return c.childYear >= yg.birthYearStart && c.childYear <= yg.birthYearEnd;
                      }
                      if (c.childYear === parseInt(yg.name)) return true;
                      return false;
                    }) || [];
                    
                    let childrenStr = '';
                    if (matchingChildren.length > 0) {
                      childrenStr = matchingChildren.map(c => c.childName ? `${c.childName} (${c.childYear})` : `Jahrgang ${c.childYear}`).join(', ');
                    } else {
                      childrenStr = slot.yearGroup?.name || 'Ohne Jahrgang';
                    }

                    if (slot.yearGroup?.timeSlots && slot.yearGroup.timeSlots.length > 0) {
                      const dates = Array.from(new Set(slot.yearGroup.timeSlots.map((ts: any) => ts.date.split('T')[0])));
                      dates.forEach(d => {
                        if (!groupedByDate[d]) groupedByDate[d] = [];
                        groupedByDate[d].push({ ...slot, childrenStr });
                      });
                    }
                  });

                  const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

                  if (sortedDates.length === 0) return null;

                  return sortedDates.map(dateStr => (
                    <div key={dateStr} className="dashboard-date-group" style={{ marginBottom: 24 }}>
                      <h4 className="dashboard-date-header" style={{ fontSize: 16, fontWeight: '600', color: '#333', borderBottom: '1px solid #dee2e6', paddingBottom: 8, marginBottom: 12 }}>
                        {new Date(dateStr).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                        <div style={{ fontSize: 13, color: '#666', marginTop: 4, fontWeight: 'normal' }}>
                          Für: {Array.from(new Set(groupedByDate[dateStr].map(s => s.childrenStr))).join(' | ')}
                        </div>
                      </h4>
                      <div className="dashboard-shifts-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {groupedByDate[dateStr].sort((a, b) => {
                          const aDone = a.targetQuantity > 0 && a.collected >= a.targetQuantity;
                          const bDone = b.targetQuantity > 0 && b.collected >= b.targetQuantity;
                          if (aDone === bDone) return 0;
                          return aDone ? 1 : -1;
                        }).map(slot => {
                          const remaining = slot.targetQuantity - slot.collected;
                          const committed = slotCommitments[slot.id] || 0;
                          const isDone = remaining <= 0;
                          
                          return (
                            <div key={slot.id} className="dashboard-shift-card" style={{ borderLeft: `6px solid ${isDone ? '#198754' : clubAccent}` }}>
                              <div className="dashboard-shift-card-inner">
                                <div className="dashboard-shift-title">
                                  <span>{slot.foodItem?.icon || '🍔'}</span> <span>{slot.foodItem?.name || '-'}</span>
                                </div>
                                <div className="dashboard-shift-time">
                                  <span>Bedarf: {slot.targetQuantity} {slot.foodItem?.unit}</span>
                                </div>
                              </div>
                              <div className="dashboard-shift-actions">
                                <div className="dashboard-shift-remaining" style={{ color: isDone ? '#198754' : '#212529' }}>
                                  {slot.collected}/{slot.targetQuantity}
                                </div>
                                {!isDone && !committed && (
                                  <button onClick={() => setSlotCommitments({ ...slotCommitments, [slot.id]: 1 })} title="Zusagen" className="dashboard-btn-action" style={{ background: '#e8f4fd', color: '#0d6efd' }}>
                                    ➕
                                  </button>
                                )}
                                {committed > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <input type="number" min="1" value={committed} onChange={e => setSlotCommitments({ ...slotCommitments, [slot.id]: parseInt(e.target.value, 10) || 0 })} style={{ width: 50, padding: '4px', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 13, textAlign: 'center' }} />
                                    <button onClick={() => commitSlot(slot.id, slot.foodItemId!)} title="Zusagen" className="dashboard-btn-action" style={{ background: '#e8f4fd', color: '#0d6efd' }}>
                                      ✓
                                    </button>
                                    <button onClick={() => removeCommitment(slot.id)} title="Abbrechen" className="dashboard-btn-action" style={{ background: '#fde8e8', color: '#dc3545', fontSize: 12 }}>
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>
                              <FillBar assigned={slot.collected} max={slot.targetQuantity || 0} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Zusätzliche Verpflegung */}
            {(!tournament || tournament.status === 'aktiv') && (
              <div style={{ background: '#fff', border: `2px solid ${clubPrimary}`, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: '600', color: clubPrimary }}>Zusätzliche Verpflegungsspenden</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <select value={donationFoodId} onChange={e => setDonationFoodId(parseInt(e.target.value, 10))} style={{ padding: '12px 14px', border: '2px solid #e9ecef', borderRadius: 10, fontSize: 15, outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                    <option value={0}>-- Artikel auswählen --</option>
                    {foodCategories.map(cat => (
                      <optgroup key={cat.id} label={`${cat.icon} ${cat.name}`}>
                        {cat.items.map(item => (
                          <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <input value={donationQuantity} onChange={e => setDonationQuantity(e.target.value)} placeholder="Menge" type="number" min="1" style={{ padding: '12px 14px', border: '2px solid #e9ecef', borderRadius: 10, fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
                  <input value={donationNote} onChange={e => setDonationNote(e.target.value)} placeholder="Notiz (optional, z.B. Kuchenart)" style={{ padding: '12px 14px', border: '2px solid #e9ecef', borderRadius: 10, fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
                  <button onClick={submitDonation} style={{ padding: '14px 0', background: clubSecondary, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: '600', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>Spende eintragen</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {angebotOffen && (
        <div className="feedback-modal-overlay" onClick={() => setAngebotOffen(false)}>
          <div
            className="feedback-modal-content feedback-modal-content--schmal"
            onClick={e => e.stopPropagation()}
          >
            <div className="feedback-modal-header">
              <div>
                <h3 className="feedback-modal-title">🙋 Zeit anbieten</h3>
                <div className="feedback-modal-subtitle">
                  {angebotBezug
                    ? `${angebotBezug.bereich} – sag uns, wann du kannst`
                    : 'Wann hättest du Zeit? Wir schauen, was dazu passt.'}
                </div>
              </div>
              <button className="feedback-modal-close" onClick={() => setAngebotOffen(false)} aria-label="Schließen">✕</button>
            </div>

            <div className="feedback-modal-body">
              <div className="rating-feld">
                <label className="rating-feld-label" htmlFor="angebot-datum">Tag</label>
                <input
                  id="angebot-datum" type="date" className="rating-kommentar"
                  value={angebotDatum} onChange={e => setAngebotDatum(e.target.value)}
                />
              </div>

              <div className="angebot-zeitraum">
                <div className="rating-feld">
                  <label className="rating-feld-label" htmlFor="angebot-von">Von</label>
                  <input
                    id="angebot-von" type="time" className="rating-kommentar"
                    value={angebotVon} onChange={e => setAngebotVon(e.target.value)}
                  />
                </div>
                <div className="rating-feld">
                  <label className="rating-feld-label" htmlFor="angebot-bis">Bis</label>
                  <input
                    id="angebot-bis" type="time" className="rating-kommentar"
                    value={angebotBis} onChange={e => setAngebotBis(e.target.value)}
                  />
                </div>
              </div>

              <div className="rating-feld">
                <label className="rating-feld-label" htmlFor="angebot-notiz">
                  Anmerkung (optional)
                </label>
                <textarea
                  id="angebot-notiz" className="rating-kommentar" rows={3} maxLength={500}
                  value={angebotNotiz} onChange={e => setAngebotNotiz(e.target.value)}
                  placeholder={'z. B. „lieber Küche als Grill“ oder „kann notfalls auch länger“'}
                />
              </div>

              <p className="angebot-erklaerung">
                Das ist noch keine feste Zusage: Die Organisatoren schauen, ob sich daraus
                eine Schicht machen lässt, und melden sich bei dir.
              </p>
            </div>

            <div className="feedback-modal-footer rating-modal-footer">
              <button
                onClick={() => setAngebotOffen(false)}
                className="feedback-modal-btn"
                style={{ background: '#fff', color: '#333', border: '1px solid #ccc' }}
              >
                Abbrechen
              </button>
              <button onClick={sendeAngebot} disabled={busy} className="feedback-modal-btn">
                {busy ? 'Sendet …' : 'Zeit anbieten'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ratingModalVs && dankeSichtbar && (
        <div className="feedback-modal-overlay" onClick={() => setRatingModalVs(null)}>
          <div
            className="feedback-modal-content feedback-modal-content--schmal rating-danke"
            onClick={e => e.stopPropagation()}
            role="status"
          >
            <div className="rating-danke-symbol">🎉</div>
            <h3 className="rating-danke-titel">Danke dir!</h3>
            <p className="rating-danke-text">
              Deine Rückmeldung hilft uns, das nächste Turnier besser zu planen –
              genau dafür fragen wir danach.
            </p>
            <button className="feedback-modal-btn" onClick={() => setRatingModalVs(null)}>
              Fertig
            </button>
          </div>
        </div>
      )}

      {ratingModalVs && !dankeSichtbar && (
        <div className="feedback-modal-overlay" onClick={() => setRatingModalVs(null)}>
          {/* Klick im Inneren darf nicht schliessen - sonst ist ein halb
              ausgefuelltes Formular bei jedem Fehlgriff weg. */}
          <div
            className="feedback-modal-content feedback-modal-content--schmal"
            onClick={e => e.stopPropagation()}
          >
            <div className="feedback-modal-header">
              <div>
                <h3 className="feedback-modal-title">⭐ Schicht bewerten</h3>
                <div className="feedback-modal-subtitle">
                  {ratingModalVs.shift?.arbeitsbereich?.name || ratingModalVs.role}
                  {' am '}
                  {new Date(ratingModalVs.date).toLocaleDateString('de-DE')}
                  {ratingModalVs.shift?.startMin != null && (
                    <> ({minToTime(ratingModalVs.shift.startMin)}–{minToTime(ratingModalVs.shift.endMin)})</>
                  )}
                </div>
              </div>
              <button className="feedback-modal-close" onClick={() => setRatingModalVs(null)} aria-label="Schließen">✕</button>
            </div>

            <div className="feedback-modal-body">
              <RatingSkala
                frage="1. Stress & Auslastung"
                stufen={['Viel zu ruhig', 'Eher ruhig', 'Genau richtig', 'Stressig', 'Überlastet / zu wenig Helfer']}
                symbole={['😴', '🙂', '😊', '🥵', '🚨']}
                wert={rateWorkload}
                onChange={setRateWorkload}
              />
              <RatingSkala
                frage="2. Organisation & Einweisung"
                stufen={['Chaotisch', 'Lückenhaft', 'Okay', 'Gut', 'Perfekt organisiert']}
                symbole={['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']}
                wert={rateOrganization}
                onChange={setRateOrganization}
              />
              <RatingSkala
                frage="3. Spaß & Stimmung"
                stufen={['Kein Spaß', 'Eher zäh', 'In Ordnung', 'Gut', 'Super Stimmung!']}
                symbole={['😞', '😐', '🙂', '😄', '🤩']}
                wert={rateFun}
                onChange={setRateFun}
              />


              <div className="rating-feld">
                <label className="rating-feld-label" htmlFor="rating-kommentar">
                  Notiz / Verbesserungsvorschlag (optional)
                </label>
                <textarea
                  id="rating-kommentar"
                  className="rating-kommentar"
                  value={rateComment}
                  onChange={e => setRateComment(e.target.value)}
                  placeholder="Was können wir beim nächsten Mal besser machen? (z. B. fehlendes Material, Uhrzeit …)"
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>

            <div className="feedback-modal-footer rating-modal-footer">
              <button
                onClick={() => setRatingModalVs(null)}
                className="feedback-modal-btn"
                style={{ background: '#fff', color: '#333', border: '1px solid #ccc' }}
              >
                Abbrechen
              </button>
              <button onClick={saveRating} disabled={busy} className="feedback-modal-btn">
                {busy ? 'Speichert …' : 'Bewertung speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
