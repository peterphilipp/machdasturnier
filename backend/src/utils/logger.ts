/**
 * Zentrales JSON-Logging für Docker/Cloud-Auswertung.
 * 
 * Nutzung: log('EVENT_NAME', { key: 'value' })
 * Filter im Docker-Log: docker logs <container> 2>&1 | grep '"event"'
 */

export interface LogEntry {
  event: string;
  [key: string]: any;
  timestamp: string;
}

function log(event: string, data?: Record<string, any>): void {
  const entry: LogEntry = { event, timestamp: new Date().toISOString() };
  if (data) Object.assign(entry, data);
  console.log(JSON.stringify(entry));
}

// ─── Auth Events ──────────────────────────────────────────────────────────
export function logLoginSuccess(email: string, ip?: string) {
  log('LOGIN_SUCCESS', { email, ip });
}

export function logLoginFailed(email: string, reason: string, ip?: string) {
  log('LOGIN_FAILED', { email, reason, ip });
}

/**
 * Greift die Ratenbegrenzung, wird der Request abgewiesen BEVOR der Handler
 * laeuft - es entstuende also kein LOGIN_FAILED. Wer einem Anmeldeproblem
 * nachgeht, saehe im Log schlicht nichts, obwohl der Nutzer ausgesperrt ist.
 */
export function logRateLimited(pfad: string, ip?: string) {
  log('RATE_LIMITED', { pfad, ip });
}

// ─── Registration Events ──────────────────────────────────────────────────
export function logRegistrationCreated(name: string, email: string, ip?: string) {
  log('REGISTRATION_CREATED', { name, email, ip });
}

// ─── Volunteer Shift (Jobs) Events ────────────────────────────────────────
export function logJobAssigned(volunteerId: number, volunteerName: string, shiftId: number, shiftDate: string, ip?: string) {
  log('JOB_ASSIGNED', { volunteerId, volunteerName, shiftId, shiftDate, ip });
}

export function logJobUnassigned(volunteerId: number, volunteerName: string, shiftId: number, shiftDate: string, ip?: string) {
  log('JOB_UNASSIGNED', { volunteerId, volunteerName, shiftId, shiftDate, ip });
}

// ─── Food/Verpflegung Events ──────────────────────────────────────────────
export function logFoodDonationCreated(volunteerId: number, volunteerName: string, foodItemId: number, foodItemName: string, quantity: number, ip?: string) {
  log('VERPFLUGUNG_ERSTELLT', { volunteerId, volunteerName, foodItemId, foodItemName, quantity, ip });
}

export function logFoodDonationDeleted(volunteerId: number, volunteerName: string, donationId: number, ip?: string) {
  log('VERPFLUGUNG_GELÖSCHT', { volunteerId, volunteerName, donationId, ip });
}

// ─── Password Reset Events ────────────────────────────────────────────────
export function logPasswordResetRequested(email: string, ip?: string) {
  log('PASSWORD_RESET_REQUESTED', { email, ip });
}

export function logPasswordResetCompleted(volunteerId: number, volunteerName: string, ip?: string) {
  log('PASSWORD_RESET_COMPLETED', { volunteerId, volunteerName, ip });
}

// ─── Tournament Events ────────────────────────────────────────────────────
export function logTournamentCreated(id: number, name: string, ip?: string) {
  log('TOURNAMENT_CREATED', { id, name, ip });
}

export function logTournamentUpdated(id: number, changes: Record<string, any>, ip?: string) {
  log('TOURNAMENT_UPDATED', { id, changes, ip });
}

// ─── Match/Spielplan Events ───────────────────────────────────────────────
export function logMatchScoreUpdated(matchId: number, teamA: string, scoreA: number, teamB: string, scoreB: number, ip?: string) {
  log('SPIEL_ERGEBNIS_GESPEICHERT', { matchId, teamA, scoreA, teamB, scoreB, ip });
}

export function logMatchReset(matchId: number, tournamentName: string, ip?: string) {
  log('SPIEL_ZURUECKGESETZT', { matchId, tournamentName, ip });
}

// ─── Volunteer Management Events ──────────────────────────────────────────
export function logVolunteerUpdated(volunteerId: number, changes: Record<string, any>, ip?: string) {
  log('HELFER_DATEN_GEANDERT', { volunteerId, changes, ip });
}

export function logClubCreated(id: number, name: string, ip?: string) {
  log('VEREIN_ERSTELLT', { id, name, ip });
}

export function logFieldUpdated(fieldId: number, changes: Record<string, any>, ip?: string) {
  log('FELD_GEANDERT', { fieldId, changes, ip });
}
