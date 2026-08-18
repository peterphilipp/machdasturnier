// ===================== Auth Store (für API Calls ohne Hooks) =====================
let currentToken: string = '';

export function setAuthToken(token: string): void {
  currentToken = token;
}

export function getAuthToken(): string {
  return currentToken || localStorage.getItem('token') || '';
}

import { verbindungGestoert, verbindungWiederDa } from './verbindungsstatus';

// ===================== Error Types =====================
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Status 0 bedeutet: Der Server hat gar nicht geantwortet - Funkloch, WLAN weg,
 * Server aus. Bewusst von echten HTTP-Fehlern unterschieden, weil die
 * Oberfläche anders darauf reagieren muss: Bei 500 hilft ein zweiter Versuch
 * selten, bei 0 fast immer.
 */
export const KEINE_VERBINDUNG = 0;

/** True, wenn der Fehler daher kommt, dass der Server nicht erreichbar war. */
export function istVerbindungsfehler(err: unknown): boolean {
  return err instanceof ApiError && err.status === KEINE_VERBINDUNG;
}

// Generic fetch wrapper to handle errors and JSON parsing
export const apiFetch = async <T = any>(url: string, options?: RequestInit): Promise<T> => {
  // Automatisch Token hinzufügen wenn noch nicht in Options
  const authHeader = options?.headers && 
    (options.headers as Record<string, string>)['Authorization'];
  
  if (!authHeader) {
    const token = getAuthToken();
    if (token) {
      options = {
        ...options,
        headers: {
          ...(options?.headers as Record<string, string> || {}),
          'Authorization': `Bearer ${token}`
        }
      };
    }
  }

  /**
   * Netzwerkfehler abfangen, statt sie durchfliegen zu lassen.
   *
   * Ohne das wirft fetch ein englisches "TypeError: Failed to fetch", das
   * ungefiltert bis in die Oberfläche durchschlägt - oder, schlimmer, von
   * einem catch zu einer leeren Liste gemacht wird. Dann sieht ein fehlender
   * Server aus wie "es gibt hier nichts", und der Helfer glaubt, er sei
   * nicht eingeteilt.
   */
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch {
    const fehler = new ApiError(
      'Keine Verbindung zum Server. Prüfe deine Internetverbindung und versuche es erneut.',
      KEINE_VERBINDUNG
    );
    verbindungGestoert(fehler);
    throw fehler;
  }

  if (!res.ok) {
    // Spezielle Behandlung für 403 Forbidden
    if (res.status === 403) {
      throw new ApiError('Zugriff verweigert – du hast keine Berechtigung dafür', 403);
    }
    
    // Spezielle Behandlung für 401 Unauthorized
    if (res.status === 401) {
      // Nur "Session abgelaufen" anzeigen wenn der User bereits eingeloggt war.
      // Beim Login selbst ist ein 401 meist falsches Passwort – da die
      // eigentliche Fehlermeldung des Servers durchlassen.
      const hasActiveSession = currentToken || localStorage.getItem('token');
      if (hasActiveSession) {
        throw new ApiError('Session abgelaufen – bitte neu anmelden', 401);
      }
      // Kein Token vorhanden → Server-Fehlermeldung durchlassen
    }

    let errorMsg = 'Ein Fehler ist aufgetreten';
    /** Konnte eine echte Fehlermeldung des Servers gelesen werden? */
    let vomServer = false;
    const text = await res.text();
    console.error(`[API Error ${res.status}] ${options?.method || 'GET'} ${url}`, text);
    try {
      try {
        const errorData = JSON.parse(text);
        let detailMsg = '';
        if (errorData.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
          const detailStrings = errorData.details
            .map((d: any) => typeof d === 'string' ? d : (d.message || ''))
            .filter((m: string) => m && m !== 'Invalid input' && m !== 'Required');
          if (detailStrings.length > 0) {
            detailMsg = detailStrings.join('. ');
          }
        }

        if (errorData.error && errorData.error !== 'Validierungsfehler') {
          errorMsg = errorData.error;
          vomServer = true;
        } else if (detailMsg) {
          errorMsg = detailMsg;
          vomServer = true;
        } else {
          errorMsg = errorData.error || errorData.message || errorMsg;
          vomServer = !!(errorData.error || errorData.message);
        }
      } catch (e) {
        // Fallback to text if not JSON
        if (text) {
          errorMsg = `Server Response: ${text.substring(0, 100)}`;
        }
      }
    } catch (e) {
      // Ignore text read error
    }
    /**
     * Ein 5xx OHNE verwertbare Meldung kommt nicht von uns: Das Backend
     * antwortet auf Fehler immer mit JSON. Leerer Rumpf oder HTML heisst also,
     * dass ein Proxy stellvertretend fuer einen toten Server geantwortet hat.
     * Fuer den Nutzer ist das derselbe Fall wie gar keine Antwort - und ein
     * zweiter Versuch lohnt sich genauso.
     */
    if (res.status >= 500 && !vomServer) {
      const fehler = new ApiError(
        'Der Server ist gerade nicht erreichbar. Bitte versuche es in einem Moment erneut.',
        KEINE_VERBINDUNG
      );
      verbindungGestoert(fehler);
      throw fehler;
    }

    throw new ApiError(errorMsg, res.status);
  }
  
  // Der Server antwortet wieder - ein etwaiges Warnband darf verschwinden.
  verbindungWiederDa();

  // Für 204 No Content
  if (res.status === 204) return null as T;
  return res.json();
};

// ===================== Queries =====================
export const getTournaments = () => apiFetch('/api/tournaments');
export const getWorkAreas = () => apiFetch('/api/work-areas');
export const getGlobalTimeSlots = () => apiFetch('/api/global-time-slots');
export const getVolunteers = (tournamentId?: number | null) => 
  apiFetch(tournamentId ? `/api/volunteers?tournamentId=${tournamentId}` : '/api/volunteers');
export const getClubs = () => apiFetch('/api/clubs').catch(() => []); // Fallback if clubs endpoint doesn't exist
export const getTournamentClubs = (tournamentId: number | null) =>
  tournamentId ? apiFetch(`/api/tournament-clubs?tournamentId=${tournamentId}`) : Promise.resolve([]);
export const addTournamentClub = (tournamentId: number, clubId: number) =>
  apiPost('/api/tournament-clubs', { tournamentId, clubId });
export const removeTournamentClub = (tournamentId: number, clubId: number) =>
  apiDelete(`/api/tournament-clubs?tournamentId=${tournamentId}&clubId=${clubId}`);

// ===================== Aenderungsverlauf =====================
/** Wer hat wann was am Dienstplan geaendert. `vor` blaettert aelter (Id-basiert, nicht Offset). */
export const getAenderungen = (tournamentId: number, opts?: { vor?: number | null; art?: string | null; userId?: number | null; limit?: number }) => {
  const q = new URLSearchParams({ tournamentId: String(tournamentId) });
  if (opts?.vor) q.set('vor', String(opts.vor));
  if (opts?.art) q.set('art', opts.art);
  if (opts?.userId) q.set('userId', String(opts.userId));
  if (opts?.limit) q.set('limit', String(opts.limit));
  return apiFetch(`/api/changes?${q.toString()}`);
};

export const getShifts = (tournamentId?: string | number | null) => 
  tournamentId ? apiFetch(`/api/shifts?tournamentId=${tournamentId}`) : Promise.resolve([]);
/** allowParallel: bewusst eine weitere Schicht neben einer bestehenden im selben Zeitfenster. */
export const createShift = (data: { tournamentId: number; tournamentDayId: number; daySlotId: number; tournamentWorkAreaId: number; minVolunteers?: number; maxVolunteers?: number; allowParallel?: boolean }) =>
  apiPost('/api/shifts', data);
export const updateShift = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/shifts/${id}`, data);
export const updateShiftsBatch = (changes: { id: number; startMin: number; endMin: number }[]) =>
  apiPatch('/api/shifts/batch', { changes });

export const getVolunteerShifts = (tournamentId?: string | number | null) => 
  tournamentId ? apiFetch(`/api/volunteer-shifts?tournamentId=${tournamentId}`) : Promise.resolve([]);

// ===================== Food (Verpflegung-Stammdaten) =====================
export const getFoodCategoriesForDonations = () => apiFetch('/api/food/categories');
export const getFoodItems = () => apiFetch('/api/food/items');
export const getFoodDonations = () => apiFetch('/api/food/donations');
export const getAllFoodDonations = (tournamentId: number | null) =>
  tournamentId ? apiFetch(`/api/food/donations/all?tournamentId=${tournamentId}`) : Promise.resolve({ donations: [] });
export const getFoodDonationSlots = (tournamentId?: number | null) =>
  apiFetch(`/api/food-donation-slots?tournamentId=${tournamentId}`);

// ===================== Year Groups =====================
export const getYearGroups = () => apiFetch('/api/year-groups');

// ===================== Tournament (Phase 1) =====================
export const getTimeSlots = (tournamentId: number | null) => 
  tournamentId ? apiFetch(`/api/time-slots?tournamentId=${tournamentId}`) : Promise.resolve([]);
export const getFields = (tournamentId: number | null) => 
  tournamentId ? apiFetch(`/api/fields?tournamentId=${tournamentId}`) : Promise.resolve([]);
export const getStandings = (tournamentId: number | null) => 
  tournamentId ? apiFetch(`/api/standings/${tournamentId}`) : Promise.resolve([]);
export const recalculateStandings = (tournamentId: number) => 
  apiFetch(`/api/standings/${tournamentId}/recalculate`, { method: 'POST' });
export const getGroups = (tournamentId: number | null) => 
  tournamentId ? apiFetch(`/api/groups/${tournamentId}`) : Promise.resolve([]);
export const getTeamsByGroup = (groupId: number | null) => 
  groupId ? apiFetch(`/api/teams?groupId=${groupId}`) : Promise.resolve([]);
export const getTeamsByTournament = (tournamentId: number | null) =>
  tournamentId ? apiFetch(`/api/teams?tournamentId=${tournamentId}`) : Promise.resolve([]);

// ===================== Match Generation (Phase 1) =====================
export const generateMatchesForYearGroup = (tournamentId: number, yearGroupId: number) => 
  apiPost(`/api/tournaments/${tournamentId}/generate-matches`, { yearGroupId });

// ===================== Knockout Brackets =====================
export const getBrackets = (tournamentId: number | null) => 
  tournamentId ? apiFetch(`/api/knockout-brackets?tournamentId=${tournamentId}`) : Promise.resolve([]);

// ===================== Mutations (Generic) =====================
export const apiPost = <T = any, R = any>(url: string, data: T): Promise<R> => 
  apiFetch<R>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const apiPatch = <T = any, R = any>(url: string, data: T): Promise<R> => 
  apiFetch<R>(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const apiPut = <T = any, R = any>(url: string, data: T): Promise<R> => 
  apiFetch<R>(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const apiDelete = <R = any>(url: string): Promise<R> => 
  apiFetch<R>(url, { method: 'DELETE' });

export const getDeleteImpact = (type: string, id: number) =>
  apiFetch(`/api/impact/${type}/${id}`);

// ===================== Tag-/Slot-System (Etappe 3) =====================
// Katalog (Tag-Vorlagen)
export const getDayTemplates = () => apiFetch('/api/day-templates');
export const createDayTemplate = (data: { name: string }) => apiPost('/api/day-templates', data);
export const updateDayTemplate = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/day-templates/${id}`, data);
export const deleteDayTemplate = (id: number) => apiDelete(`/api/day-templates/${id}`);
export const addTemplateWorkArea = <T = Record<string, unknown>>(data: T) => apiPost('/api/day-templates/work-areas', data);
export const updateTemplateWorkArea = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/day-templates/work-areas/${id}`, data);
export const deleteTemplateWorkArea = (id: number) => apiDelete(`/api/day-templates/work-areas/${id}`);

// Work Area Categories (Stammdaten)
export const getWorkAreaCategories = () => apiFetch('/api/work-area-categories');
export const createWorkAreaCategory = <T = Record<string, unknown>>(data: T) => apiPost('/api/work-area-categories', data);
export const updateWorkAreaCategory = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/work-area-categories/${id}`, data);
export const deleteWorkAreaCategory = (id: number) => apiDelete(`/api/work-area-categories/${id}`);
export const updateWorkAreaCategoryOrder = (order: number[]) => apiPost('/api/work-area-categories/reorder', { order });
export const updateWorkAreaOrder = (order: number[]) => apiPost('/api/work-areas/reorder', { order });

// Turnier-Work-Areas (Snapshot)
export const getTournamentWorkAreas = (tid: number | null) =>
  tid ? apiFetch(`/api/tournament-work-areas?tournamentId=${tid}`) : Promise.resolve([]);
export const syncTournamentWorkAreas = (tid: number) => apiPost('/api/tournament-work-areas/sync', { tournamentId: tid });
/** Holt EINEN Katalog-Bereich ins Turnier und aktiviert ihn (ohne den ganzen Katalog zu synchronisieren). */
export const adoptTournamentWorkArea = (tournamentId: number, workAreaId: number) =>
  apiPost('/api/tournament-work-areas/adopt', { tournamentId, workAreaId });
export const updateTournamentWorkArea = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/tournament-work-areas/${id}`, data);

// Turnier-Tage + Slots
export const getTournamentDays = (tid: number | null) =>
  tid ? apiFetch(`/api/tournament-days?tournamentId=${tid}`) : Promise.resolve([]);
export const createTournamentDay = <T = Record<string, unknown>>(data: T) => apiPost('/api/tournament-days', data);
export const updateTournamentDay = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/tournament-days/${id}`, data);
export const deleteTournamentDay = (id: number) => apiDelete(`/api/tournament-days/${id}`);
export const addDaySlot = <T = Record<string, unknown>>(data: T) => apiPost('/api/day-slots', data);
export const updateDaySlot = <T = Record<string, unknown>>(id: number, data: T) => apiPatch(`/api/day-slots/${id}`, data);
export const deleteDaySlot = (id: number) => apiDelete(`/api/day-slots/${id}`);
export const generateShifts = (tid: number) => apiPost('/api/tournament-days/generate-shifts', { tournamentId: tid });
export const clearShifts = (tid: number) => apiPost('/api/tournament-days/clear-shifts', { tournamentId: tid });
export const exportDayToTemplate = (dayId: number, data: { name: string; description?: string }) => apiPost(`/api/tournament-days/${dayId}/export-template`, data);

// TournamentDayWorkArea — Zielhelfer pro Bereich pro Tag
export const getDayWorkAreas = (dayId: number) => apiFetch(`/api/tournament-days/${dayId}/work-areas`);

/** Lädt Slots mit ihren zugehörigen Arbeitsbereichen für einen Tag. */
export const getDaySlotsWithWorkAreas = (dayId: number) => apiFetch(`/api/tournament-days/${dayId}/slots-with-work-areas`);
export const syncDayWorkAreas = (dayId: number) => apiPost(`/api/tournament-days/${dayId}/sync-work-areas`, {});
export const updateDayWorkAreaTargetHelpers = (id: number, targetHelpers: number | null) => apiPatch(`/api/tournament-days/tournament-day-work-areas/${id}`, { targetHelpers });
export const removeDayWorkArea = (id: number) => apiDelete(`/api/tournament-days/tournament-day-work-areas/${id}`);
export const addDayWorkArea = (dayId: number, workAreaId: number, order?: number) =>
  apiPost('/api/tournament-days/day-work-areas', { tournamentDayId: dayId, tournamentWorkAreaId: workAreaId, order });

// ===================== Web Push =====================
export const getVapidPublicKey = () => apiFetch('/api/self/vapid-public-key');
export const subscribeToPush = <T = Record<string, unknown>>(subscription: T) => apiPost('/api/self/push-subscribe', subscription);
export const broadcastPush = <T = Record<string, unknown>>(data: T) => apiPost('/api/volunteers/push-broadcast', data);

// ===================== Passkeys (WebAuthn) =====================
export const getPasskeyRegistrationOptions = () => apiPost('/api/auth/passkey/register-options', {});
export const verifyPasskeyRegistration = <T = any>(data: { response: T; challengeToken: string; label?: string }) =>
  apiPost('/api/auth/passkey/register-verify', data);
export const getMyPasskeys = () => apiFetch('/api/auth/passkey');
export const deletePasskey = (id: number) => apiDelete(`/api/auth/passkey/${id}`);
// identifier optional: weggelassen löst den identifier-losen ("discoverable")
// Flow aus - der Browser bietet dann selbst alle passenden Passkeys auf dem
// Gerät an, ohne dass Name/E-Mail vorher eingegeben werden muss.
export const getPasskeyAuthenticationOptions = (identifier?: string) =>
  apiPost('/api/auth/passkey/login-options', identifier ? { identifier } : {});
export const verifyPasskeyAuthentication = <T = any>(data: { response: T; challengeToken: string }) =>
  apiPost('/api/auth/passkey/login-verify', data);

// ===================== Einkaufsliste =====================
export const searchShoppingCatalog = (search?: string) =>
  apiFetch(`/api/shopping-list/catalog${search ? '?search=' + encodeURIComponent(search) : ''}`);
export const lookupShoppingBarcode = (barcode: string) =>
  apiFetch(`/api/shopping-list/catalog/barcode/${encodeURIComponent(barcode)}`);
export const createShoppingCatalogItem = (data: { name: string; category?: string | null; unit?: string; barcode?: string | null }) =>
  apiPost('/api/shopping-list/catalog', data);
export const getShoppingList = (tournamentId: number) =>
  apiFetch(`/api/shopping-list?tournamentId=${tournamentId}`);
export const addShoppingListItem = (data: { tournamentId: number; catalogItemId: number; plannedQuantity?: number; note?: string | null }) =>
  apiPost('/api/shopping-list', data);
export const updateShoppingListItem = (id: number, data: { plannedQuantity?: number; purchasedQuantity?: number; note?: string | null }) =>
  apiPatch(`/api/shopping-list/${id}`, data);
export const deleteShoppingListItem = (id: number) => apiDelete(`/api/shopping-list/${id}`);
export const copyShoppingListFrom = (sourceTournamentId: number, targetTournamentId: number) =>
  apiPost(`/api/shopping-list/copy-from/${sourceTournamentId}?targetTournamentId=${targetTournamentId}`, {});

// FoodCategory Mapping (Verpflegung-Stammdaten)
export const getFoodCategories = () =>
  apiFetch('/api/shopping-list/food-categories');
export const linkFoodCategoryToCatalogItem = (catalogItemId: number, foodCategoryId: number) =>
  apiPatch(`/api/shopping-list/catalog/${catalogItemId}/link-food-category`, { foodCategoryId });

