import { CSSProperties, useState, useMemo } from 'react';
import { modal } from './Modal';
import { getDeleteImpact } from '../../api';

export const tdStyle: CSSProperties = { padding: '12px 16px', border: '1px solid #e9ecef', verticalAlign: 'top' };
export const thStyle: CSSProperties = { ...tdStyle, background: '#f8f9fa', fontWeight: '600', fontSize: 13, color: '#495057' };
// === Button-Standards (einheitlich für alle Admin-Komponenten) ===
// Primär-Buttons (Speichern, Erstellen, Hinzufügen): fontWeight 600
// Sekundär-Buttons (Abbrechen, Zurück): fontWeight 500
export const btnStyle: CSSProperties = { padding: '12px 20px', cursor: 'pointer', border: 'none', borderRadius: 8, background: '#f8f9fa', fontSize: 14, fontWeight: 600, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 };
export const btnStyleSecondary: CSSProperties = { ...btnStyle, fontWeight: 500 };
export const inputStyle: CSSProperties = { padding: '10px 14px', border: '1px solid #dee2e6', borderRadius: 10, fontSize: 14, outline: 'none', background: '#fff' };

export async function confirmWithImpact(type: string, id: number, entityName: string): Promise<boolean> {
  try {
    const impact = await getDeleteImpact(type, id);
    if (impact && impact.count > 0) {
      const impactList = impact.details.map((d: string) => `• ${d}`).join('\n');
      return await modal.confirm({
        title: `[WARNUNG] ${entityName} löschen`,
        message: `Möchtest du "${entityName}" wirklich löschen?\n\nACHTUNG: Folgende verknüpfte Daten werden dadurch ebenfalls unwiderruflich gelöscht:\n\n${impactList}\n\nDiese Aktion kann nicht rückgängig gemacht werden!`,
        variant: 'danger',
        confirmText: 'Ja, unwiderruflich löschen'
      });
    }
  } catch (error) {
    console.error('Failed to get delete impact:', error);
  }
  // Fallback / No impact
  return await modal.confirm({
    title: `${entityName} löschen`,
    message: `Möchtest du "${entityName}" wirklich löschen?`,
    variant: 'danger'
  });
}

export function useSortableData<T>(items: T[], config: { key: string, direction: 'asc' | 'desc' } | null = null) {
  const [sortConfig, setSortConfig] = useState<{ key: keyof T | string, direction: 'asc' | 'desc' } | null>(config);

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a: any, b: any) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        
        if (sortConfig.key === 'clubName') { aValue = a.club?.name || ''; bValue = b.club?.name || ''; }
        if (sortConfig.key === 'categoryName') { aValue = a.category?.name || ''; bValue = b.category?.name || ''; }
        if (sortConfig.key === 'yearGroupRange') { aValue = a.birthYearStart || 0; bValue = b.birthYearStart || 0; }
        if (sortConfig.key === 'statusBadge') { aValue = a.status || ''; bValue = b.status || ''; }

        if (typeof aValue === 'string') aValue = aValue.toLowerCase();
        if (typeof bValue === 'string') bValue = bValue.toLowerCase();

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key: keyof T | string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? ' 🔼' : ' 🔽';
  };

  return { items: sortedItems, requestSort, sortConfig, getSortIndicator };
}

export const shadeColor = (color: string, percent: number) => {
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);
  R = Math.max(0, Math.min(255, R + Math.round(R * percent / 100)));
  G = Math.max(0, Math.min(255, G + Math.round(G * percent / 100)));
  B = Math.max(0, Math.min(255, B + Math.round(B * percent / 100)));
  return '#' + (R.toString(16).padStart(2, '0')) + (G.toString(16).padStart(2, '0')) + (B.toString(16).padStart(2, '0'));
};

export const statusBadge = (status: string) => status === 'aktiv' ? '🟢' : status === 'entwurf' ? '⚪' : '⚫';

// Zeit-Helfer: Minuten seit Mitternacht <-> "HH:MM"
export const minToTime = (min: number) => `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
export const timeToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function getTemplateDisplayName(t: GlobalDayTemplate): string {
  // 1. Sammle alle Kategorien aus allen WorkAreas
  const categoryMap = new Map<number, WorkAreaCategory>();
  
  if (t.workAreas) {
    t.workAreas.forEach(twa => {
      if (twa.workArea?.categories) {
        twa.workArea.categories.forEach(cat => {
          if (!categoryMap.has(cat.id)) {
            categoryMap.set(cat.id, cat);
          }
        });
      }
    });
  }

  // 2. Sortiere nach globaler Order
  const sortedCategories = Array.from(categoryMap.values()).sort((a, b) => a.order - b.order);
  const tagsStr = sortedCategories.length > 0 ? `[${sortedCategories.map(c => c.name).join(', ')}]` : '';
  
  let timeStr = '';
  if (t.workAreas && t.workAreas.length > 0) {
    const minStart = Math.min(...t.workAreas.map(wa => wa.startMin));
    const maxEnd = Math.max(...t.workAreas.map(wa => wa.endMin));
    timeStr = `${minToTime(minStart)}–${minToTime(maxEnd)}`;
  }
  
  return [timeStr, tagsStr, t.name].filter(Boolean).join(' ').trim();
}

// ---- Tag-/Slot-System (Etappe 3) ----
export interface WorkAreaCategory { id: number; name: string; order: number; color: string; isObsolete: boolean; }
export interface TemplateWorkArea {
  id: number;
  templateId: number;
  workAreaId: number;
  startMin: number;
  endMin: number;
  order: number;
  workArea?: WorkArea;
}

export interface GlobalDayTemplate {
  id: number;
  name: string;
  order: number;
  isObsolete: boolean;
  workAreas?: TemplateWorkArea[];
}
export interface TournamentWorkArea { id: number; tournamentId: number; sourceWorkAreaId: number | null; name: string; icon: string; order?: number; color: string; minVolunteers: number; maxVolunteers: number; operatingStartMin: number | null; operatingEndMin: number | null; active: boolean; }
export interface DaySlot { id: number; tournamentDayId: number; startMin: number; endMin: number; label: string | null; color: string; order: number; }
export interface TournamentDay { id: number; tournamentId: number; date: string; order: number; label: string | null; sourceTemplateId: number | null; slots?: DaySlot[]; }
export interface PlanningShift {
  id: number;
  tournamentId: number;
  tournamentDayId: number;
  daySlotId: number;
  tournamentWorkAreaId: number;
  startMin: number | null;
  endMin: number | null;
  minVolunteers: number;
  maxVolunteers: number;
  description: string | null;
  workArea?: WorkArea;
  daySlot?: DaySlot;
  volunteerShifts?: VolunteerShift[];
}

export interface Tournament {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  turnierModus: string;
  teamsAdvancingPerGroup: number;
  playoutAllPlacements: boolean;
  thirdPlaceMatch: boolean;
  qualificationRule: string | null;
  clubId: number | null;
  logo?: string | null;
  hasSponsor?: boolean;
  sponsorName?: string | null;
  sponsorUrl?: string | null;
  club?: Club | null;
  yearGroups?: YearGroup[];
}
export interface Shift { id: number; tournamentId: number; date: string; zeitslotId: number | null; slot: string; arbeitsbereichId: number | null; minVolunteers: number; maxVolunteers: number; description: string | null; zeitslot: { id: number; name: string; startTime: string; endTime: string; color: string; order: number } | null; arbeitsbereich: { id: number; name: string; icon: string; order?: number; color: string } | null; workArea?: { id: number; name: string; icon: string; order?: number; color: string } | null; }
export interface WorkArea { id: number; name: string; icon: string; order?: number; color: string; minVolunteers: number; maxVolunteers: number; isStandard?: boolean; isObsolete?: boolean; categories?: WorkAreaCategory[]; }
export interface GlobalTimeSlot { id: number; name: string; startTime: string; endTime: string; color: string; order: number; }
export interface VolunteerShift { id: number; userId: number; tournamentId: number | null; date: string; slot: string; role: string; areaId: number | null; shiftId: number | null; arbeitsbereichId?: number | null; arbeitsbereich: { id: number; name: string; icon: string; order?: number; color: string } | null; user?: { id: number; name: string; role?: string; phone?: string; children?: { childName: string; childYear: number }[]; trainedYearGroups?: { id: number; name: string }[] }; shift?: any; }
export interface Volunteer { id: number; name: string; email: string | null; phone: string | null; role?: 'HELPER' | 'ORGANIZER' | 'ADMIN' | 'TRAINER'; roles?: ('HELPER' | 'ORGANIZER' | 'ADMIN' | 'TRAINER')[]; tournamentId: number | null; consentGiven?: boolean; consentDate?: string; createdAt?: string; lastLoginAt?: string | null; lastActivityAt?: string | null; children?: { childName: string; childYear: number }[]; pushSubscriptions?: { id: number; userAgent?: string | null; createdAt?: string; deviceLabel?: string }[]; trainedYearGroups?: { id: number; name: string }[]; }
export interface Club { id: number; name: string; city: string | null; logo: string | null; primaryColor: string; secondaryColor: string; }
export interface FoodCategory { id: number; name: string; icon: string; order: number; items: FoodItem[]; }
export interface FoodItem { id: number; categoryId: number; name: string; price: string | null; unit: string; category?: { id: number; name: string; icon: string }; }
export interface YearGroup { id: number; name: string; birthYearStart: number; birthYearEnd: number; order: number; isActive: boolean; }
export interface FoodDonationSlot { id: number; tournamentId: number; yearGroupId: number | null; yearGroup?: YearGroup | null; foodItemId: number | null; targetQuantity: number; collected: number; description: string | null; userId: number | null; tournament?: { id: number; name: string }; foodItem?: { id: number; categoryId: number; name: string; icon: string; unit: string; category?: { id: number; name: string; icon: string } }; user?: { id: number; name: string; email: string }; }
export interface FoodDonation { id: number; tournamentId: number; userId: number | null; foodDonationSlotId: number | null; foodItemId: number; quantity: number; note: string | null; createdAt: string; foodItem?: { id: number; name: string; unit: string; category?: { id: number; name: string; icon: string } }; user?: { id: number; name: string } | null; }
export interface TimeSlot { id: number; tournamentId: number; date: string; startTime: string; endTime: string; label: string | null; order: number; matches: Match[]; }
export interface Field { id: number; tournamentId: number; name: string; status: string; matches: Match[]; }
export interface StandingsEntry { id: number; teamId: number; tournamentId: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number; position: number; team?: Team | null; }
export interface Match { id: number; tournamentId: number; yearGroupId: number | null; runde: string | null; bracketTyp: string | null; siegerId: number | null; verliererId: number | null; bracketId: number | null; timeSlotId: number | null; fieldId: number | null; teamAId: number; teamBId: number; scoreA: number | null; scoreB: number | null; placeholderA: string | null; placeholderB: string | null; phase: string; stage: number | null; status: string; time: string; teamA?: Team | null; teamB?: Team | null; timeSlot?: TimeSlot | null; field?: Field | null; bracket?: { id: number } | null; }
export interface Group { id: number; name: string; tournamentId: number; teams?: Team[]; }
export interface Team { id: number; name: string; groupId: number | null; tournamentId: number | null; yearGroupId: number | null; clubId: number | null; club?: Club | null; yearGroup?: { id: number; name: string }; goalsFor: number; goalsAgainst: number; group?: Group | null; }
export interface KnockoutBracket { id: number; tournamentId: number; name: string; runde: string; order: number; matches: Match[]; }
