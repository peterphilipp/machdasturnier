import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiPost } from '../../api';
import { modal } from '../admin/Modal';
import { inputStyle, btnStyle } from '../admin/shared';
import { formatPhoneNumber } from '../../utils/phone';

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

export default function RegisterView({ clubPrimary: propClubPrimary, clubSecondary: _cs, clubAccent: _ca, clubLogo: _cl }: { clubPrimary?: string; clubSecondary?: string; clubAccent?: string; clubLogo?: string | null }) {
  const { login: contextLogin } = useUser();
  const navigate = useNavigate();
  const clubPrimary = propClubPrimary || '#0d6efd';

  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [regChildren, setRegChildren] = useState<{ childName: string; childYear: string }[]>([{ childName: '', childYear: '' }]);
  const [consentGiven, setConsentGiven] = useState(false);
  // Voreingestellt an: Es geht um Zusagen, Absagen und Verschiebungen zur
  // eigenen Schicht - betriebliche Info, keine Werbung. Push allein erreicht
  // die wenigsten, weil kaum jemand die App installiert und Benachrichtigungen
  // erlaubt; abschalten geht jederzeit im Profil.
  const [mailBenachrichtigungen, setMailBenachrichtigungen] = useState(true);

  const years = Array.from({ length: 30 }, (_, i) => (new Date().getFullYear() - 4) - i);

  const applyLoginResult = async (data: Record<string, any>) => {
    // Ohne E-Mail vergibt der Server einen Wiederherstellungs-Code und liefert
    // ihn genau EINMAL im Klartext mit. Wurde er bisher nicht angezeigt, hatte
    // niemand ihn je gesehen - und wer ohne E-Mail sein Passwort vergass, war
    // dauerhaft ausgesperrt.
    const code = data.user?.recoveryPin || data.volunteer?.recoveryPin;
    if (code) {
      await modal.alert({
        title: '🔢 Bitte notieren: dein Wiederherstellungs-Code',
        message: `${code}\n\nDu hast keine E-Mail-Adresse hinterlegt. Mit diesem Code kommst du wieder in dein Konto, falls du dein Passwort vergisst - er wird dir kein zweites Mal angezeigt.\n\nAlternativ kannst du in deinem Profil eine E-Mail-Adresse ergänzen.`
      });
    }
    contextLogin(data.token, data.user || data.volunteer);
    navigate('/');
  };

  const register = async () => {
    if (!consentGiven) {
      await modal.alert({ title: 'Zustimmung erforderlich', message: 'Bitte stimme der Datenschutzerklärung zu.' });
      return;
    }
    if (!regName) {
      await modal.alert({ title: 'Fehlende Angabe', message: 'Bitte gib deinen Namen an.' });
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      await modal.alert({ title: 'Fehler', message: 'Passwörter stimmen nicht überein.' });
      return;
    }
    try {
      const payload = {
        name: regName, email: regEmail, phone: regPhone, password: regPassword,
        consentGiven, mailBenachrichtigungen,
        children: regChildren
          .filter(c => c.childName.trim() !== '' || c.childYear !== '')
          .map(c => ({
            childName: c.childName.trim() || null,
            childYear: c.childYear ? parseInt(c.childYear, 10) : null
          }))
      };
      const data = await apiPost('/api/auth/register', payload);
      await applyLoginResult(data);
      // Trigger Web Push Erlaubnis
      import('../../utils/push').then(m => m.subscribeToPushNotifications().catch(() => {}));
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Fehler bei der Registrierung' });
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div className="auth-wrapper" style={{ background: `linear-gradient(135deg, ${shadeColor(clubPrimary, 30)} 0%, ${clubPrimary} 100%)` }}>
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-emoji">📝</div>
            <h2 className="auth-title">Neue Registrierung</h2>
            <p className="auth-subtitle">Erstelle deinen Helfer-Account</p>
          </div>
          
          <div className="auth-form">
            <input type="text" placeholder="Vor- und Nachname" value={regName} onChange={e => setRegName(e.target.value)} className="input-base" />
            <input type="email" placeholder="Email-Adresse (optional)" value={regEmail} onChange={e => setRegEmail(e.target.value)} className="input-base" />
            <input type="tel" placeholder="Handynummer (optional)" value={regPhone} onChange={e => setRegPhone(e.target.value)} onBlur={() => setRegPhone(formatPhoneNumber(regPhone) || regPhone)} className="input-base" />

            <label style={{ display: 'flex', alignItems: 'start', gap: 8, padding: '10px 12px', background: 'var(--bg-surface)', border: '2px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', lineHeight: 1.4 }}>
              <input type="checkbox" checked={mailBenachrichtigungen} onChange={e => setMailBenachrichtigungen(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, width: 18, height: 18, cursor: 'pointer' }} />
              <span>
                Benachrichtige mich per Mail, wenn eine Schicht bestätigt, abgesagt oder verschoben wird.
                {' '}Das lässt sich jederzeit im Profil ändern.
              </span>
            </label>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 2 }}>Kinder (optional)</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>
                Trage hier deine Kinder mit ihrem <strong>Geburtsjahr</strong> ein, damit wir dir automatisch passende Helfer-Dienste für ihre Jugendmannschaften vorschlagen können.
              </div>
              <div style={{ fontSize: 11, color: '#856404', background: '#fff3cd', border: '1px solid #ffeeba', padding: '8px 10px', borderRadius: 6, marginBottom: 10, lineHeight: 1.4 }}>
                ⚠️ <strong>Wichtiger Hinweis:</strong> Ohne die Angabe eines Kindes inklusive Geburtsjahr ist keine Zuordnung zu einer Mannschaft möglich. Eine sinnvolle Teilnahme an der Organisation und Schichtplanung ist dann nicht möglich.
              </div>
              {regChildren.map((child, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="text" placeholder="Name des Kindes" value={child.childName} onChange={e => { const n = [...regChildren]; n[idx].childName = e.target.value; setRegChildren(n); }} className="input-base" style={{ flex: 1, minWidth: 140 }} />
                  <select
                    value={child.childYear}
                    onChange={e => { const n = [...regChildren]; n[idx].childYear = e.target.value; setRegChildren(n); }}
                    className="input-base"
                    style={{ width: 130, flexShrink: 0 }}
                  >
                    <option value="">Geburtsjahr</option>
                    {years.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  {regChildren.length > 1 && (
                    <button type="button" onClick={() => { const n = regChildren.filter((_, i) => i !== idx); setRegChildren(n); }} className="btn" style={{ background: '#ffe3e3', color: '#dc3545', padding: '8px 10px', fontSize: 16, flexShrink: 0, width: 'auto' }}>🗑️</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setRegChildren([...regChildren, { childName: '', childYear: '' }])} className="btn" style={{ background: 'var(--bg-main)', border: '1px dashed var(--border-color-focus)', color: 'var(--text-muted)', padding: '8px 12px', fontSize: 14, marginTop: 4, width: 'auto' }}>👶 Kind hinzufügen</button>
            </div>
            
            <input type="password" placeholder="Passwort" value={regPassword} onChange={e => setRegPassword(e.target.value)} className="input-base" />
            <input type="password" placeholder="Passwort bestaetigen" value={regPasswordConfirm} onChange={e => setRegPasswordConfirm(e.target.value)} className="input-base" />
            
            <label style={{ display: 'flex', alignItems: 'start', gap: 8, padding: '10px 12px', background: consentGiven ? 'var(--bg-main)' : 'var(--bg-surface)', border: consentGiven ? `2px solid ${clubPrimary}` : '2px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', lineHeight: 1.4, transition: 'var(--transition-fast)' }}>
              <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, width: 18, height: 18, cursor: 'pointer' }} />
              <span>
                Ich habe die{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: clubPrimary, textDecoration: 'underline', fontWeight: 'bold' }}>
                  Datenschutzerklärung
                </Link>{' '}
                gelesen und stimme der Verarbeitung meiner Daten zu.{' '}
                <span style={{ color: '#dc3545' }}>*</span>
              </span>
            </label>
            
            <button onClick={register} className="btn btn-primary">Registrieren</button>
            <button onClick={() => navigate('/login')} className="btn btn-text" style={{ border: '2px solid var(--text-muted)' }}>Zurück zum Login</button>
          </div>
        </div>
      </div>
    </div>
  );

}