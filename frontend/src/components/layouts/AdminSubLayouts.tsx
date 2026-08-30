import { NavLink, Outlet, useOutletContext, useLocation, Navigate } from 'react-router-dom';
import { Tournament } from '../admin/shared';
import { useIsMobile } from '../../hooks/useIsMobile';
import Seitenhilfe from '../admin/Seitenhilfe';
import { SEITENHILFE, seitenSchluessel } from '../admin/hilfe';

/**
 * Reiter-Zeile der Unternavigation. Auf dem Desktop unveraendert umbrechend,
 * mobil eine einzige seitlich scrollbare Zeile (siehe .admin-subnav) - sonst
 * werden aus acht Stammdaten-Reitern vier gestapelte Zeilen.
 */
function SubNav({ tabs, activeColor }: { tabs: { to: string; icon: string; label: string }[]; activeColor: string }) {
  const isMobile = useIsMobile();

  return (
    <nav className="admin-subnav">
      {tabs.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          style={({ isActive }) => ({
            padding: isMobile ? '10px 14px' : '12px 16px',
            textDecoration: 'none', cursor: 'pointer',
            background: isActive ? activeColor : '#e9ecef',
            color: isActive ? '#fff' : '#000',
            border: 'none', borderRadius: 8,
            fontSize: isMobile ? 14 : 15,
            minHeight: 44,
            // Feste Mindestbreite nur am Desktop: mobil laesst sie die Zeile
            // unnoetig weit werden und kostet Scrollweg.
            minWidth: isMobile ? undefined : 120,
            whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 6
          })}
        >
          <span>{tab.icon}</span><span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

interface AdminContext {
  selectedTournamentId: number | null;
  selectedYearGroupId: number | null;
  setSelectedTournamentId: (id: number | null) => void;
  setSelectedYearGroupId: (id: number | null) => void;
  tournaments: Tournament[];
  isAdmin: boolean;
}

function TournamentSelectCard({ context, showYearGroup = false }: { context: AdminContext, showYearGroup?: boolean }) {
  const { selectedTournamentId, selectedYearGroupId, setSelectedTournamentId, setSelectedYearGroupId, tournaments } = context;
  const activeTournament = tournaments.find(t => t.id === selectedTournamentId);
  const sponsorLogo = activeTournament?.logo;
  const isMobile = useIsMobile();

  const formatDate = (dateStr: string | Date) => {
    const d = new Date(dateStr);
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  };

  // Mobil untereinander und ueber die volle Breite: die feste Mindestbreite
  // des Selects plus Label sprengte zusammen mit gap:32 jedes Handy-Display
  // und war der Hauptgrund fuers seitliche Wegscrollen der Seite.
  const selectStyle = {
    padding: isMobile ? '10px 12px' : '8px 12px',
    borderRadius: 8,
    border: '1px solid #ced4da',
    fontSize: isMobile ? 16 : 15,
    minWidth: isMobile ? 0 : 260,
    width: isMobile ? '100%' : undefined,
    minHeight: isMobile ? 44 : undefined,
    background: '#fff'
  } as const;

  const fieldWrapStyle = {
    display: 'flex',
    alignItems: isMobile ? 'stretch' : 'center',
    flexDirection: isMobile ? 'column' as const : 'row' as const,
    gap: isMobile ? 4 : 12,
    minWidth: 0,
    flex: isMobile ? '1 1 100%' : undefined
  };

  const labelStyle = { fontWeight: 'bold', color: '#495057', fontSize: isMobile ? 12 : 15 };

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e9ecef',
      borderRadius: 12,
      padding: isMobile ? 12 : '16px 24px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: isMobile ? 10 : 32,
      marginBottom: isMobile ? 12 : 24,
      boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
      marginTop: isMobile ? 0 : 12
    }}>
      <div style={fieldWrapStyle}>
        <span style={labelStyle}>{isMobile ? '🏆 Turnier' : 'Aktives Turnier:'}</span>
        <select
          value={selectedTournamentId || ''}
          onChange={(e) => {
            setSelectedTournamentId(Number(e.target.value));
            setSelectedYearGroupId(null);
          }}
          style={selectStyle}
        >
          <option value="" disabled>Turnier wählen...</option>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({formatDate(t.startDate)})</option>
          ))}
        </select>
      </div>

      {/* Sponsorlogo ist reine Zierde - auf dem Handy zaehlt der Platz mehr. */}
      {sponsorLogo && !isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#adb5bd', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sponsor:</span>
          <img src={sponsorLogo} alt="Sponsor" style={{ maxHeight: 36, objectFit: 'contain' }} />
        </div>
      )}

      {showYearGroup && selectedTournamentId && (
        <div style={{ ...fieldWrapStyle, marginLeft: isMobile ? undefined : 'auto' }}>
          <span style={labelStyle}>{isMobile ? '👶 Jahrgang' : 'Jahrgang:'}</span>
          <select
            value={selectedYearGroupId || ''}
            onChange={(e) => setSelectedYearGroupId(e.target.value ? Number(e.target.value) : null)}
            style={{ ...selectStyle, minWidth: isMobile ? 0 : 200 }}
          >
            <option value="">-- Alle --</option>
            {activeTournament?.yearGroups?.map((yg: any) => (
              <option key={yg.id} value={yg.id}>{yg.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ----------------------
// SPIELPLAN
// ----------------------
export function SpielplanLayout() {
  const context = useOutletContext<AdminContext>();
  const location = useLocation();

  // Redirect to default tab if base route is hit
  if (location.pathname === '/admin/spielplan' || location.pathname === '/admin/spielplan/') {
    return <Navigate to="turnier-tage" replace />;
  }

  const tabs = [
    { to: 'turnier-tage', icon: '🗓️', label: 'Turniertage' },
    { to: 'felder', icon: '🏟️', label: 'Spielfelder' },
    { to: 'teilnehmer', icon: '👥', label: 'Teilnehmer' },
    { to: 'modus', icon: '⚙️', label: 'Turniermodus' },
    { to: 'gruppenphase', icon: '📊', label: 'Gruppenphase' },
    { to: 'ko', icon: '🏆', label: 'K.O.-Runde' }
  ];

  return (
    <>
      <TournamentSelectCard context={context} showYearGroup={true} />
      <SubNav tabs={tabs} activeColor="#0d6efd" />
      <main>
        <Outlet context={context} />
      </main>
    </>
  );
}

// ----------------------
// ORGANISATION
// ----------------------
export function OrganisationLayout() {
  const context = useOutletContext<AdminContext>();
  const location = useLocation();

  if (location.pathname === '/admin/organisation' || location.pathname === '/admin/organisation/') {
    return <Navigate to="uebersicht" replace />;
  }

  const tabs = [
    { to: 'uebersicht', icon: '📋', label: 'Dienstplan' },
    { to: 'food-donation-slots', icon: '🍰', label: 'Verpflegung' },
    { to: 'shopping-list', icon: '🛒', label: 'Einkaufsliste' },
    { to: 'push-broadcast', icon: '🔔', label: 'Push-Nachrichten' },
    { to: 'bewertungen', icon: '⭐', label: 'Bewertungen' },
    { to: 'statistik', icon: '📊', label: 'Statistik' },
    { to: 'verlauf', icon: '🕓', label: 'Verlauf' }
  ];

  // Kurzfassung und "?" stammen aus derselben Quelle (hilfe.ts) - so gibt es
  // den Text nur einmal und Untertitel und Hilfe koennen nicht auseinanderlaufen.
  const hilfe = SEITENHILFE[seitenSchluessel(location.pathname)];

  return (
    <>
      <TournamentSelectCard context={context} showYearGroup={false} />
      <SubNav tabs={tabs} activeColor="#198754" />
      {hilfe && (
        <div className="admin-seitenhilfe">
          <span className="admin-seitenhilfe-text">{hilfe.zweck}</span>
          <Seitenhilfe pfad={location.pathname} />
        </div>
      )}
      <main>
        <Outlet context={context} />
      </main>
    </>
  );
}

// ----------------------
// STAMMDATEN
// ----------------------
export function StammdatenLayout() {
  const context = useOutletContext<AdminContext>();
  const { isAdmin } = context;
  const location = useLocation();

  if (location.pathname === '/admin/stammdaten' || location.pathname === '/admin/stammdaten/') {
    return <Navigate to="turniere" replace />;
  }

  const tabs = [
    { to: 'vereine', icon: '🛡️', label: 'Vereine' },
    { to: 'turniere', icon: '🏆', label: 'Turniere' },
    { to: 'jahrgaenge', icon: '👶', label: 'Jahrgänge' },
    { to: 'work-areas', icon: '📍', label: 'Arbeitsbereiche' },
    { to: 'global-time-slots', icon: '📅', label: 'Tagesvorlagen' },
    { to: 'lebensmittel', icon: '🍔', label: 'Verpflegung' },
    { to: 'helfer', icon: '👤', label: 'Benutzer', reqAdmin: true },
    { to: 'db-management', icon: '🗄️', label: 'DB-Management', reqAdmin: true }
  ];

  // Bei Stammdaten geht es weniger darum, WIE man ein Feld ausfüllt, als
  // darum, WAS anderswo davon abhängt - deshalb steht die Hilfe hier genauso
  // wie im Bereich Organisation.
  const hilfeStamm = SEITENHILFE[seitenSchluessel(location.pathname)];

  return (
    <>
      <SubNav tabs={tabs.filter(t => !t.reqAdmin || isAdmin)} activeColor="#6c757d" />
      {hilfeStamm && (
        <div className="admin-seitenhilfe">
          <span className="admin-seitenhilfe-text">{hilfeStamm.zweck}</span>
          <Seitenhilfe pfad={location.pathname} />
        </div>
      )}
      <main>
        <Outlet context={context} />
      </main>
    </>
  );
}
