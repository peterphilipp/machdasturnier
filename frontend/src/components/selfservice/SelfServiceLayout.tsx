import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useUser, VolunteerData } from '../../context/UserContext';
import { apiFetch } from '../../api';
import { modal } from '../admin/Modal';
import PushNotificationBanner from '../PushNotificationBanner';
import PwaInstallPrompt from '../PwaInstallPrompt';
import { isPasskeySupported, registerPasskey } from '../../utils/passkey';
import { usePushSubscriptionStatus, subscribeToPushNotifications } from '../../utils/push';
import { btnStyle } from '../admin/shared';

// Hilfsfunktion für dunklere Farben (aus SelfServiceView.tsx)
function shadeColor(color: string | undefined, percent: number) {
  if (!color || typeof color !== 'string' || !color.startsWith('#')) {
    return color || '';
  }
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);
  R = Math.floor(R * (100 + percent) / 100);
  G = Math.floor(G * (100 + percent) / 100);
  B = Math.floor(B * (100 + percent) / 100);
  R = (R < 255) ? R : 255;
  G = (G < 255) ? G : 255;
  B = (B < 255) ? B : 255;
  const RR = ((R.toString(16).length === 1) ? '0' + R.toString(16) : R.toString(16));
  const GG = ((G.toString(16).length === 1) ? '0' + G.toString(16) : G.toString(16));
  const BB = ((B.toString(16).length === 1) ? '0' + B.toString(16) : B.toString(16));
  return '#' + RR + GG + BB;
}

export default function SelfServiceLayout() {
  const { isLoggedIn, volunteer, token, logout, isAdmin, isOrganizer, isTrainer, login, isInitializing } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const [clubPrimary, setClubPrimary] = useState('#0d6efd');
  const [clubSecondary, setClubSecondary] = useState('#6c757d');
  const [clubAccent, setClubAccent] = useState('#198754');
  const [clubLogo, setClubLogo] = useState<string | null>(null);
  const [tournamentName, setTournamentName] = useState('');
  const [availableTournaments, setAvailableTournaments] = useState<{id: number, name: string, status?: string}[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [hasSponsor, setHasSponsor] = useState(false);
  const [sponsorName, setSponsorName] = useState<string | null>(null);
  const [sponsorUrl, setSponsorUrl] = useState<string | null>(null);
  const [sponsorLogo, setSponsorLogo] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  
  const { supported: pushSupported, subscribed: pushSubscribed, setSubscribed: setPushSubscribed } = usePushSubscriptionStatus();
  const [pushMenuLoading, setPushMenuLoading] = useState(false);
  const [passkeySupportedState, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const [exportLoading, setExportLoading] = useState(false);
  
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(false);
  const [dismissedUpdate, setDismissedUpdate] = useState(false);

  useEffect(() => {
    isPasskeySupported().then(setPasskeySupported);
  }, []);

  // PWA Update-Erkennung via Service Worker
  useEffect(() => {
    const handleUpdate = () => {
      setPwaUpdateAvailable(true);
    };
    window.addEventListener('pwa-update-available', handleUpdate);
    return () => window.removeEventListener('pwa-update-available', handleUpdate);
  }, []);

  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const data = await apiFetch('/api/auth/export');
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mein-dienstplan-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      await modal.alert({ title: 'Exportiert 🎉', message: 'Deine persönlichen Daten wurden erfolgreich als JSON-Datei exportiert.' });
    } catch (e: any) {
      await modal.alert({ title: 'Fehler', message: e.message || 'Daten konnten nicht exportiert werden.' });
    } finally {
      setExportLoading(false);
    }
  };

  const fetchClubColors = async (tid: number) => {
    try {
      const data = await apiFetch('/api/tournaments/' + tid);
      if (data) {
        if (data.club) {
          setClubPrimary(data.club.primaryColor || '#0d6efd');
          setClubSecondary(data.club.secondaryColor || '#6c757d');
          setClubLogo(data.club.logo || null);
        }
        if (data.name) setTournamentName(data.name);
        setHasSponsor(data.hasSponsor || false);
        setSponsorName(data.sponsorName || null);
        setSponsorUrl(data.sponsorUrl || null);
        setSponsorLogo(data.logo || null);
      }
    } catch (e) {
      // Ignorieren
    }
  };

  // Farben laden wenn volunteer.tournamentId ODER selectedTournamentId sich ändert
  useEffect(() => {
    const tid = selectedTournamentId || volunteer?.tournamentId;
    if (tid) {
      fetchClubColors(tid);
    }
  }, [selectedTournamentId, volunteer?.tournamentId]);

  // Handle protected routes – NICHT während der Initialisierung (localStorage-Lesevorgang)
  useEffect(() => {
    if (isInitializing) return; // Warten bis Auth-Status bekannt ist
    const isAuthRoute = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/reset-password';
    if (!isLoggedIn && !isAuthRoute) {
      /**
       * Das Ziel mitnehmen, nicht wegwerfen.
       *
       * Die Links aus den Mails tragen ihr Ziel im Parameter (`/?schicht=12`,
       * `/?zeitangebot=1`). Ohne diese Weitergabe fuehrt jeder solche Link bei
       * jemandem, der gerade nicht angemeldet ist - auf dem Handy der
       * Regelfall - nach der Anmeldung auf die nackte Uebersicht. Der Link hat
       * dann etwas versprochen, das nicht eintritt, und niemand kann sagen,
       * warum.
       */
      const ziel = `${location.pathname}${location.search}`;
      navigate(ziel === '/' ? '/login' : `/login?next=${encodeURIComponent(ziel)}`, { replace: true });
    }
  }, [isLoggedIn, isInitializing, location.pathname, location.search, navigate]);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate('/login');
  };

  const handlePasskeySetup = async () => {
    setPasskeyLoading(true);
    try {
      await registerPasskey();
      setMenuOpen(false);
      await modal.alert({ title: 'Eingerichtet 🎉', message: 'Face ID / Fingerabdruck ist jetzt eingerichtet.' });
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name !== 'NotAllowedError') {
        await modal.alert({ title: 'Fehler', message: e.message || 'Passkey konnte nicht eingerichtet werden.' });
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/reset-password';

  if (isAuthRoute) {
    return <Outlet context={{ clubPrimary, clubSecondary, clubAccent, clubLogo, fetchClubColors }} />;
  }

  return (
    <div className="selfservice-wrapper">
      <div className="selfservice-container">
        {/* HEADER */}
        <header className="selfservice-header" style={{ background: `linear-gradient(135deg, ${clubPrimary} 0%, ${shadeColor(clubPrimary, -30)} 100%)` }}>
          <div className="selfservice-header-left">
            {clubLogo && (
              <div className="selfservice-header-logo-wrapper">
                <img src={clubLogo} alt="Logo" className="selfservice-header-logo" />
              </div>
            )}
            <div className="selfservice-header-text">
              <h1 className="selfservice-header-title">{tournamentName || 'Mach das Turnier!'}</h1>
              {isLoggedIn && volunteer && <div className="selfservice-header-greeting">Hallo, {volunteer.name}!</div>}
            </div>
          </div>

          <div className="selfservice-header-actions">
            {isLoggedIn && (
              <>
                <button
                  onClick={() => window.dispatchEvent(new Event('start-tour'))}
                  className="btn-icon"
                  style={{ background: 'rgba(255, 255, 255, 0.2)' }}
                >
                  ?
                </button>
                <button
                  id="burger-menu-btn"
                  onClick={() => setMenuOpen(true)}
                  className="btn-icon"
                  style={{ background: 'rgba(255, 255, 255, 0.2)' }}
                >
                  ☰
                </button>
              </>
            )}
          </div>
        </header>

        {/* BENACHRICHTIGUNGS-BANNER */}
        {isLoggedIn && pushSupported && !pushSubscribed && (
          <PushNotificationBanner />
        )}

        {/* OFFLINE PWA PROMPT */}
        <PwaInstallPrompt />

        {/* HAUPTINHALT (geroutet) */}
        <main className="selfservice-content">
          <Outlet context={{ clubPrimary, clubSecondary, clubAccent, clubLogo, fetchClubColors, setAvailableTournaments, selectedTournamentId, setSelectedTournamentId, setTournamentName }} />
        </main>
      </div>

      {/* SPONSOR FOOTER */}
      {hasSponsor && (
        <div className="selfservice-footer">
          <p className="selfservice-footer-label">Powered by</p>
          {sponsorUrl ? (
            <a href={sponsorUrl} target="_blank" rel="noopener noreferrer" className="selfservice-sponsor-link">
              {sponsorLogo ? (
                <img src={sponsorLogo} alt={sponsorName || 'Sponsor'} className="selfservice-sponsor-logo" />
              ) : (
                <span className="selfservice-sponsor-text" style={{ color: clubPrimary }}>{sponsorName}</span>
              )}
            </a>
          ) : (
            <div>
              {sponsorLogo ? (
                <img src={sponsorLogo} alt={sponsorName || 'Sponsor'} className="selfservice-sponsor-logo" />
              ) : (
                <span className="selfservice-sponsor-text" style={{ color: clubPrimary }}>{sponsorName}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* OFFCANVAS MENU */}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: isMobile ? '85%' : 400, maxWidth: '100%', background: '#fff', zIndex: 1000, boxShadow: '-4px 0 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
            <div className="admin-core-style-15">
              <h2 className="admin-core-style-16">Menü</h2>
              <button onClick={() => setMenuOpen(false)} className="admin-core-style-17">×</button>
            </div>
            
            <div className="admin-core-style-18">
              <button onClick={() => { setMenuOpen(false); navigate('/profile'); }} className="admin-core-style-19">👤 Profil bearbeiten</button>
              
              <button onClick={() => { setMenuOpen(false); navigate('/'); }} className="admin-core-style-20">📅 Mein Dienstplan</button>

              {/* Trainer-Ansicht ist ein Rollenwechsel, kein weiterer Reiter im
                  Dienstplan - deshalb hier im Menü, wie der Admin-Bereich. */}
              {isTrainer && (
                <button onClick={() => { setMenuOpen(false); navigate('/trainer'); }} className="admin-core-style-20">⚽ Mein Jahrgang</button>
              )}

              {/* Turnier-Auswahl */}
              <div style={{ paddingLeft: 16, paddingBottom: 8 }}>
                <label style={{ fontSize: 12, color: '#6c757d', marginBottom: 4, display: 'block' }}>🏆 Turnier</label>
                {availableTournaments.length > 0 ? (
                  <select
                    value={selectedTournamentId || ''}
                    onChange={e => setSelectedTournamentId(parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: 14,
                      border: '1px solid #dee2e6',
                      borderRadius: 8,
                      background: '#fff',
                      color: '#333',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {availableTournaments.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: 13, color: '#6c757d', padding: '8px 0' }}>Keine Turniere verfügbar</div>
                )}
              </div>

              {passkeySupportedState && (
                <button
                  onClick={handlePasskeySetup}
                  disabled={passkeyLoading}
                  style={{ width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', borderRadius: 8, cursor: passkeyLoading ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: 14, color: '#333', opacity: passkeyLoading ? 0.6 : 1 }}
                >
                  {passkeyLoading ? '⏳ Richte ein...' : '📱 Face ID / Fingerabdruck einrichten'}
                </button>
              )}

               {pushSupported && (
                 pushSubscribed ? (
                   <button className="admin-core-style-23" style={{ width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', borderRadius: 8, cursor: 'default', textAlign: 'left', fontSize: 14, color: '#198754' }}>
                     ✅ Benachrichtigungen aktiv
                   </button>
                 ) : (
                   <button
                     disabled={pushMenuLoading}
                     onClick={async () => {
                       setPushMenuLoading(true);
                       try {
                         const permission = await Notification.requestPermission();
                         if (permission !== 'granted') {
                           await modal.alert({ title: 'Hinweis', message: 'Benachrichtigungen wurden im Browser nicht erlaubt. Bitte erlaube sie in deinen Browser-Einstellungen.' });
                           setPushMenuLoading(false);
                           return;
                         }
                         const ok = await subscribeToPushNotifications();
                         if (!ok) {
                           await modal.alert({ title: 'Fehler', message: 'Benachrichtigungen konnten nicht aktiviert werden (Service Worker antwortet nicht).' });
                           setPushMenuLoading(false);
                           return;
                         }
                         setPushSubscribed(true);
                         await modal.alert({ title: 'Erfolg', message: 'Benachrichtigungen sind nun aktiv!' });
                       } catch (e) {
                         await modal.alert({ title: 'Fehler', message: 'Benachrichtigungen konnten nicht aktiviert werden.' });
                       } finally {
                         setPushMenuLoading(false);
                       }
                     }}
                     style={{ width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', borderRadius: 8, cursor: pushMenuLoading ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: 14, color: '#333', opacity: pushMenuLoading ? 0.6 : 1 }}
                   >
                     {pushMenuLoading ? '⏳ Aktivieren...' : '🔔 Benachrichtigungen aktivieren'}
                   </button>
                 )
               )}

               <button
                 onClick={handleExportData}
                 disabled={exportLoading}
                 style={{ width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', borderRadius: 8, cursor: exportLoading ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: 14, color: '#333', opacity: exportLoading ? 0.6 : 1 }}
               >
                 {exportLoading ? '⏳ Exportiere...' : '📥 Meine Daten exportieren (DSGVO)'}
               </button>

              {/* Der Update-Hinweis sitzt jetzt oben im Dienstplan statt hier im
                  Menue - dort wurde er kaum gesehen. */}

              {(isAdmin || isOrganizer) && (
                <button
                  onClick={() => { setMenuOpen(false); navigate('/admin'); }}
                  className="admin-core-style-21"
                  style={{ marginTop: 8, marginBottom: 8 }}
                >
                  ⚙️ Admin-Bereich
                </button>
              )}

              <hr className="admin-core-style-22" />

              <button onClick={handleLogout} className="admin-core-style-25">
                🚪 Abmelden
              </button>
            </div>
            
            <div style={{ padding: '16px 20px', borderTop: '1px solid #e9ecef', fontSize: 12, color: '#6c757d', textAlign: 'center' }}>
              <button
                onClick={() => { setMenuOpen(false); navigate('/privacy'); }}
                style={{ background: 'none', border: 'none', color: '#6c757d', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 }}
              >Datenschutz</button>
              {' · '}
              <button
                onClick={() => { setMenuOpen(false); navigate('/impressum'); }}
                style={{ background: 'none', border: 'none', color: '#6c757d', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 }}
              >Impressum</button>
              <div style={{ marginTop: 4, fontSize: 11 }}>
v{(__APP_VERSION__ || '1.14.0').replace(/^v/, '')} · {(__GIT_SHA__?.slice(0, 7)) || '—'}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
