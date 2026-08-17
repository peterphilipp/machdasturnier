import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { tryConditionalPasskeyLogin, loginWithPasskey } from '../../utils/passkey';
import { modal } from '../admin/Modal';

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

export default function LoginView({ clubPrimary: propClubPrimary, clubSecondary: propClubSecondary, clubAccent: propClubAccent, clubLogo: propClubLogo }: { clubPrimary?: string; clubSecondary?: string; clubAccent?: string; clubLogo?: string | null }) {
  const { login: contextLogin } = useUser();
  const navigate = useNavigate();
  
  const clubPrimary = propClubPrimary || '#0d6efd';
  const clubSecondary = propClubSecondary || '#6c757d';
  const clubAccent = propClubAccent || '#198754';
  const clubLogo = propClubLogo || null;

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  
  // We assume passkey is supported on modern browsers unless window.PublicKeyCredential is not available
  const passkeySupported = typeof window !== 'undefined' && !!window.PublicKeyCredential;

  const applyLoginResult = async (data: Record<string, any>) => {
    contextLogin(data.token, data.user || data.volunteer);
    navigate('/');
  };

  const login = async () => {
    if (!loginEmail || !loginPassword) return;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // Der Server antwortet durchgaengig mit { error: ... } - hier wurde
        // nur `message` gelesen, sodass jeder Fehlschlag als nacktes "Login
        // fehlgeschlagen" ankam. Damit war fuer den Nutzer nicht zu
        // unterscheiden, ob Passwort und Kennung nicht stimmen (401) oder ob
        // er nach zu vielen Fehlversuchen fuer 15 Minuten gesperrt ist (429).
        throw new Error(errData.error || errData.message || 'Login fehlgeschlagen');
      }
      const data = await res.json();
      await applyLoginResult(data);
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Login fehlgeschlagen' });
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    try {
      const data = await loginWithPasskey();
      if (!data) return;
      await applyLoginResult(data);
    } catch (err: unknown) {
      const e = err as Error;
      if (e?.name !== 'NotAllowedError') {
        await modal.alert({ title: 'Fehler', message: e.message || 'Anmeldung mit Passkey fehlgeschlagen' });
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div className="auth-wrapper" style={{ background: `linear-gradient(135deg, ${clubPrimary} 0%, ${shadeColor(clubPrimary, -30)} 100%)` }}>
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            {clubLogo ? (
              <img src={clubLogo} alt="Verein" className="auth-logo" />
            ) : (
              <img src="/logo.webp" alt="App Logo" className="auth-logo" />
            )}
            <div className="auth-emoji">👋</div>
            <h2 className="auth-title">Willkommen zurück</h2>
          </div>
          
          <div className="auth-form">
            {passkeySupported && (
              <>
                <button
                  disabled={passkeyLoading}
                  onClick={handlePasskeyLogin}
                  className="btn btn-accent"
                >
                  <span className="auth-btn-icon">🔐</span>
                  <span>{passkeyLoading ? 'Wird geprüft...' : 'Mit Face ID / Fingerabdruck anmelden'}</span>
                </button>
                <div className="auth-divider-container">
                  <div className="auth-divider-line" />
                  <span className="auth-divider-text">ODER MIT PASSWORT</span>
                  <div className="auth-divider-line" />
                </div>
              </>
            )}
            {/* autoCapitalize/autoCorrect aus: mobile Tastaturen schreiben den
                ersten Buchstaben sonst automatisch gross und korrigieren
                Nachnamen zu Woerterbuch-Eintraegen - beides fuehrte zu
                "Benutzer nicht gefunden". */}
            <input type="text" placeholder="Name oder Email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} className="input-base input-no-autofill-overlay" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
            <input type="password" placeholder="Passwort" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') login(); }} className="input-base" autoComplete="current-password" />
            <button onClick={login} className="btn btn-primary">Anmelden</button>
            <button onClick={() => navigate('/register')} className="btn btn-outline">Registrieren</button>
            <button onClick={() => navigate('/reset-password')} className="btn btn-text">Passwort vergessen?</button>
            <div style={{ marginTop: 16, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
              v{(__APP_VERSION__ || '1.14.0').replace(/^v/, '')} · {(__GIT_SHA__?.slice(0, 7)) || '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}