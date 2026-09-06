import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

// ===================== Rollen-System =====================
export type Role = 'HELPER' | 'ORGANIZER' | 'ADMIN' | 'TRAINER';

const GUELTIGE_ROLLEN: Role[] = ['HELPER', 'ORGANIZER', 'ADMIN', 'TRAINER'];

/**
 * Rollen aus dem gespeicherten Nutzer lesen.
 *
 * Verträgt beide Formen: die neue Liste `roles` und die alte Einzelrolle
 * `role`. Das ist nötig, weil im localStorage noch Nutzerobjekte aus der Zeit
 * vor den Mehrfachrollen liegen und die Tokens 90 Tage gelten - ohne diesen
 * Rückfallweg wären angemeldete Nutzer plötzlich nur noch Helfer.
 */
function leseRollen(v: { roles?: unknown; role?: unknown } | null): Role[] {
  const roh = Array.isArray(v?.roles) ? v!.roles : (v?.role != null ? [v.role] : []);
  const sauber = Array.from(new Set(roh.filter((r): r is Role => GUELTIGE_ROLLEN.includes(r as Role))));
  return sauber.length > 0 ? sauber : ['HELPER'];
}

/** Höchste Berechtigungsstufe - nur für Anzeigezwecke. */
function hoechsteRolle(roles: Role[]): Role {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('ORGANIZER')) return 'ORGANIZER';
  return 'HELPER';
}

export interface VolunteerData {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  /** Mehrfachrollen; `role` bleibt für ältere gespeicherte Objekte gelesen. */
  roles?: Role[];
  role?: Role;
  tournamentId?: number | null;
  consentGiven?: boolean;
  consentDate?: string;
  children?: { childName: string | null; childYear: number | null }[];
  /** Zusagen/Absagen/Verschiebungen zusaetzlich per Mail - Default an. */
  mailBenachrichtigungen?: boolean;
}

interface UserContextType {
  volunteer: VolunteerData | null;
  token: string;
  isLoggedIn: boolean;
  isInitializing: boolean; // True solange localStorage noch gelesen wird
  roles: Role[];
  /** Höchste Stufe - für Anzeige, nicht für Berechtigungen. */
  role: Role;
  isAdmin: boolean;
  isOrganizer: boolean;
  isTrainer: boolean;
  hasAdminAccess: boolean;
  login: (token: string, volunteer: VolunteerData) => void;
  logout: () => void;
}

const UserContext = createContext<UserContextType | null>(null);

export function useUser(): UserContextType {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser muss innerhalb eines UserContext.Provider verwendet werden');
  return ctx;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [volunteer, setVolunteer] = useState<VolunteerData | null>(null);
  const [token, setToken] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialisierung aus localStorage (nur beim Mounten)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('token');
      const savedVolunteer = localStorage.getItem('volunteer');
      if (savedToken && savedVolunteer) {
        try {
          setToken(savedToken);
          setVolunteer(JSON.parse(savedVolunteer));
          setIsLoggedIn(true);
        } catch {
          // Alte/gewandelte Daten ungültig – Cache leeren
          localStorage.removeItem('token');
          localStorage.removeItem('volunteer');
        }
      }
    }
    // Initialisierung abgeschlossen
    setIsInitializing(false);
  }, []);

  const login = useCallback((newToken: string, newVolunteer: VolunteerData) => {
    setToken(newToken);
    setVolunteer(newVolunteer);
    setIsLoggedIn(true);
    localStorage.setItem('token', newToken);
    localStorage.setItem('volunteer', JSON.stringify(newVolunteer));
  }, []);

  const logout = useCallback(() => {
    setVolunteer(null);
    setToken('');
    setIsLoggedIn(false);
    localStorage.removeItem('token');
    localStorage.removeItem('volunteer');
  }, []);

  const roles = leseRollen(volunteer);
  const role = hoechsteRolle(roles);
  const isAdmin = roles.includes('ADMIN');
  const isOrganizer = roles.includes('ORGANIZER');
  const isTrainer = roles.includes('TRAINER');
  const hasAdminAccessRole = isAdmin || isOrganizer;

  return (
    <UserContext.Provider value={{ volunteer, token, isLoggedIn, isInitializing, roles, role, isAdmin, isOrganizer, isTrainer, hasAdminAccess: hasAdminAccessRole, login, logout }}>
      {children}
    </UserContext.Provider>
  );
}
