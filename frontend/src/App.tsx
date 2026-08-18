import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ModalRoot } from './components/admin/Modal';
import { UserProvider, useUser } from './context/UserContext';
import { useUmgebung, TestumgebungsBand, TestumgebungsHinweis } from './components/Testumgebung';

// --- SelfService & Public ---
import Privacy from './components/Privacy';
import Impressum from './components/Impressum';
import SelfServiceLayout from './components/selfservice/SelfServiceLayout';
import LoginView from './components/selfservice/LoginView';
import RegisterView from './components/selfservice/RegisterView';
import PasswordResetView from './components/selfservice/PasswordResetView';
import ProfileView from './components/selfservice/ProfileView';
import DashboardView from './components/selfservice/DashboardView';
import TrainerView from './components/selfservice/TrainerView';

// --- Admin Layouts ---
import AdminLayout from './components/layouts/AdminLayout';
import { SpielplanLayout, OrganisationLayout, StammdatenLayout } from './components/layouts/AdminSubLayouts';

// --- Admin Pages: Spielplan ---
import TurnierTage from './components/admin/organisation/TurnierTage';
import Felder from './components/admin/organisation/Felder';
import Teilnehmer from './components/admin/organisation/Teilnehmer';
import TurnierModus from './components/admin/organisation/TurnierModus';
import Spielplan from './components/admin/organisation/Spielplan';

// --- Admin Pages: Organisation ---
import Uebersicht from './components/admin/organisation/Uebersicht';
import FoodDonationSlots from './components/admin/organisation/FoodDonationSlots';
import ShoppingList from './components/admin/organisation/ShoppingList';
import PushBroadcast from './components/admin/organisation/PushBroadcast';
import Verlauf from './components/admin/organisation/Verlauf';

// --- Admin Pages: Stammdaten ---
import Turniere from './components/admin/stammdaten/Turniere';
import Vereine from './components/admin/stammdaten/Vereine';
import WorkAreas from './components/admin/stammdaten/WorkAreas';
import GlobalDayTemplates from './components/admin/stammdaten/GlobalDayTemplates';
import Lebensmittel from './components/admin/stammdaten/Lebensmittel';
import Helfer from './components/admin/stammdaten/Helfer';
import Jahrgaenge from './components/admin/stammdaten/Jahrgaenge';
import DbManagement from './components/admin/stammdaten/DbManagement';

/**
 * Kennzeichnung der Testumgebung. Das Band steht ueberall, der blockierende
 * Hinweis nur, solange niemand angemeldet ist - dort landet der Fehlgeleitete,
 * und dort waere ein schlankes Band neben dem Anmeldeformular zu leise.
 * Sitzt innerhalb von UserProvider, weil es den Anmeldestatus braucht.
 */
function Umgebungshinweis() {
  const info = useUmgebung();
  const { isLoggedIn, isInitializing } = useUser();
  return (
    <>
      <TestumgebungsBand info={info} />
      {!isInitializing && !isLoggedIn && <TestumgebungsHinweis info={info} />}
    </>
  );
}

export default function App() {
  return (
    <UserProvider>
      <Umgebungshinweis />
      <BrowserRouter>
        <Routes>
          {/* Public / Static */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/impressum" element={<Impressum />} />

          {/* Self Service (Volunteers) */}
          <Route element={<SelfServiceLayout />}>
            <Route path="/" element={<DashboardView />} />
            <Route path="/trainer" element={<TrainerView />} />
            <Route path="/profile" element={<ProfileView />} />
          </Route>
          
          {/* Auth Pages (unmittelbar, ohne Layout-Wrapper) */}
          <Route path="/login" element={<LoginView clubPrimary="#0d6efd" clubSecondary="#6c757d" clubAccent="#198754" clubLogo={null} />} />
          <Route path="/register" element={<RegisterView clubPrimary="#0d6efd" clubSecondary="#6c757d" clubAccent="#198754" clubLogo={null} />} />
          <Route path="/reset-password" element={<PasswordResetView clubPrimary="#0d6efd" clubSecondary="#6c757d" clubAccent="#198754" clubLogo={null} />} />

          {/* Admin Area */}
          <Route path="/admin" element={<AdminLayout />}>
            {/* Redirect /admin to /admin/spielplan */}
            <Route index element={<Navigate to="spielplan" replace />} />
            
            {/* Level 1: Spielplan */}
            <Route path="spielplan" element={<SpielplanLayout />}>
              <Route path="turnier-tage" element={<TurnierTageWrapper />} />
              <Route path="felder" element={<FelderWrapper />} />
              <Route path="teilnehmer" element={<TeilnehmerWrapper />} />
              <Route path="modus" element={<TurnierModusWrapper />} />
              <Route path="gruppenphase" element={<SpielplanWrapper phase="gruppenphase" />} />
              <Route path="ko" element={<SpielplanWrapper phase="ko" />} />
            </Route>

            {/* Level 1: Organisation */}
            <Route path="organisation" element={<OrganisationLayout />}>
              <Route path="uebersicht" element={<UebersichtWrapper />} />
              <Route path="food-donation-slots" element={<FoodDonationSlotsWrapper />} />
              <Route path="shopping-list" element={<ShoppingListWrapper />} />
              <Route path="push-broadcast" element={<PushBroadcastWrapper />} />
              <Route path="verlauf" element={<VerlaufWrapper />} />
            </Route>

            {/* Level 1: Stammdaten */}
            <Route path="stammdaten" element={<StammdatenLayout />}>
              <Route path="turniere" element={<Turniere adminPrimary="#6c757d" adminSecondary="#adb5bd" />} />
              <Route path="vereine" element={<Vereine adminPrimary="#6c757d" />} />
              <Route path="jahrgaenge" element={<Jahrgaenge adminPrimary="#6c757d" />} />
              <Route path="work-areas" element={<WorkAreas adminPrimary="#6c757d" />} />
              <Route path="global-time-slots" element={<GlobalDayTemplates adminPrimary="#6c757d" />} />
              <Route path="lebensmittel" element={<Lebensmittel adminPrimary="#6c757d" />} />
              <Route path="helfer" element={<HelferWrapper />} />
              <Route path="db-management" element={<DbManagement />} />
            </Route>
          </Route>
          
          {/* Catch-all 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <ModalRoot />
    </UserProvider>
  );
}

// ==============================================================================
// WRAPPERS FÜR ADMIN-KOMPONENTEN
// Da die alten Admin-Komponenten ihre Parameter über Props bekamen (aus dem App.tsx State),
// nutzen wir hier Wrapper-Komponenten, die den Context via `useOutletContext` auslesen
// und als Props weiterreichen, damit wir die alten Komponenten nicht anfassen müssen.
// ==============================================================================
import { useOutletContext } from 'react-router-dom';

function TurnierTageWrapper() {
  const ctx = useOutletContext<any>();
  return <TurnierTage tournamentId={ctx.selectedTournamentId} yearGroupId={ctx.selectedYearGroupId} yearGroups={(ctx.tournaments.find((t:any) => t.id === ctx.selectedTournamentId)?.yearGroups) || []} />;
}
function FelderWrapper() {
  const ctx = useOutletContext<any>();
  return <Felder tournamentId={ctx.selectedTournamentId} yearGroupId={ctx.selectedYearGroupId} />;
}
function TeilnehmerWrapper() {
  const ctx = useOutletContext<any>();
  return <Teilnehmer tournamentId={ctx.selectedTournamentId} yearGroupId={ctx.selectedYearGroupId} tournament={(ctx.tournaments.find((t:any) => t.id === ctx.selectedTournamentId)) || null} />;
}
function TurnierModusWrapper() {
  const ctx = useOutletContext<any>();
  return <TurnierModus tournament={ctx.tournaments.find((t:any) => t.id === ctx.selectedTournamentId) || null} selectedYearGroupId={ctx.selectedYearGroupId} yearGroups={(ctx.tournaments.find((t:any) => t.id === ctx.selectedTournamentId)?.yearGroups) || []} />;
}
function SpielplanWrapper({ phase }: { phase: 'gruppenphase' | 'ko' }) {
  const ctx = useOutletContext<any>();
  return <Spielplan tournamentId={ctx.selectedTournamentId} yearGroupId={ctx.selectedYearGroupId} phase={phase} />;
}
function VerlaufWrapper() {
  const ctx = useOutletContext<any>();
  return <Verlauf selectedTournament={ctx.selectedTournamentId} />;
}
function UebersichtWrapper() {
  const ctx = useOutletContext<any>();
  return <Uebersicht selectedTournament={ctx.selectedTournamentId} />;
}
function FoodDonationSlotsWrapper() {
  const ctx = useOutletContext<any>();
  return <FoodDonationSlots selectedTournament={ctx.selectedTournamentId} tournament={ctx.tournaments.find((t:any) => t.id === ctx.selectedTournamentId) || null} adminPrimary="#198754" />;
}
function ShoppingListWrapper() {
  const ctx = useOutletContext<any>();
  return <ShoppingList selectedTournament={ctx.selectedTournamentId} tournaments={ctx.tournaments} />;
}
function PushBroadcastWrapper() {
  const ctx = useOutletContext<any>();
  return <PushBroadcast selectedTournament={ctx.selectedTournamentId} />;
}
function HelferWrapper() {
  const ctx = useOutletContext<any>();
  if (!ctx.isAdmin) return <Navigate to="/admin" replace />;
  return <Helfer adminPrimary="#6c757d" tournamentId={ctx.selectedTournamentId} />;
}


