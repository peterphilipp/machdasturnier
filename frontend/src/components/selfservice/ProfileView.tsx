import { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiFetch, apiPatch, apiDelete } from '../../api';
import { modal } from '../admin/Modal';
import { inputStyle, btnStyle } from '../admin/shared';
import { formatPhoneNumber } from '../../utils/phone';

interface LayoutContext {
  clubPrimary: string;
}

export default function ProfileView() {
  const { volunteer, token, logout, login } = useUser();
  const navigate = useNavigate();
  const { clubPrimary } = useOutletContext<LayoutContext>();

  const [editName, setEditName] = useState(volunteer?.name || '');
  const [editEmail, setEditEmail] = useState(volunteer?.email || '');
  const [editPhone, setEditPhone] = useState(volunteer?.phone || '');
  const [editChildren, setEditChildren] = useState<{ childName: string; childYear: string }[]>([{ childName: '', childYear: '' }]);
  const [editMailBenachrichtigungen, setEditMailBenachrichtigungen] = useState(volunteer?.mailBenachrichtigungen ?? true);
  const years = Array.from({ length: 30 }, (_, i) => (new Date().getFullYear() - 4) - i);
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Lade aktuelle Profildaten beim Rendern
  useEffect(() => {
    if (volunteer) {
      setEditName(volunteer.name || '');
      setEditEmail(volunteer.email || '');
      setEditPhone(volunteer.phone || '');
      setEditMailBenachrichtigungen(volunteer.mailBenachrichtigungen ?? true);
      if (volunteer.children && volunteer.children.length > 0) {
        setEditChildren(volunteer.children.map(c => ({ childName: c.childName || '', childYear: String(c.childYear) })));
      } else {
        setEditChildren([{ childName: '', childYear: '' }]);
      }
    }
  }, [volunteer]);

  const saveProfile = async () => {
    if (!editName) {
      await modal.alert({ title: 'Fehler', message: 'Name darf nicht leer sein.' });
      return;
    }
    try {
      const payload = {
        name: editName,
        email: editEmail,
        phone: editPhone,
        mailBenachrichtigungen: editMailBenachrichtigungen,
        children: editChildren
          .filter(c => c.childName.trim() !== '' || c.childYear !== '')
          .map(c => ({
            childName: c.childName.trim() || null,
            childYear: c.childYear ? parseInt(c.childYear, 10) : null
          }))
      };
      
      const res = await apiPatch('/api/auth/profile', payload);
      // Update Context
      if (res.user) {
        login(token!, res.user);
      }
      await modal.alert({ title: 'Erfolg', message: 'Profil wurde aktualisiert.' });
      navigate('/');
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Profil konnte nicht aktualisiert werden.' });
    }
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword) {
      await modal.alert({ title: 'Fehler', message: 'Bitte aktuelles und neues Passwort eingeben.' });
      return;
    }
    try {
      await apiPatch('/api/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      await modal.alert({ title: 'Erfolg', message: 'Passwort erfolgreich geändert.' });
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Passwort konnte nicht geändert werden.' });
    }
  };

  const deleteAccount = async () => {
    const confirm = await modal.confirm({ title: 'Konto löschen', message: 'Möchtest du dein Konto und alle deine eingetragenen Schichten wirklich löschen? Dies kann nicht rückgängig gemacht werden!', confirmText: 'Löschen', variant: 'danger' });
    if (!confirm) return;
    try {
      await apiDelete('/api/auth/account');
      logout();
      navigate('/login');
    } catch (err: unknown) {
      const e = err as Error;
      await modal.alert({ title: 'Fehler', message: e.message || 'Konto konnte nicht gelöscht werden.' });
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto', background: '#fff', minHeight: 'calc(100vh - 72px)', borderRadius: isMobile ? 0 : 12, boxShadow: isMobile ? 'none' : '0 10px 30px rgba(0,0,0,0.05)', marginTop: isMobile ? 0 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={() => navigate('/')} style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', padding: '0 8px 0 0' }}>←</button>
        <h2 style={{ margin: 0, fontSize: 22, color: '#333' }}>Profil bearbeiten</h2>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 13, color: '#666' }}>Name</label>
          <input type="text" value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 13, color: '#666' }}>Email (optional)</label>
          <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 13, color: '#666' }}>Handy (optional)</label>
          <input type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} onBlur={() => setEditPhone(formatPhoneNumber(editPhone) || editPhone)} style={inputStyle} />
        </div>

        <label style={{ display: 'flex', alignItems: 'start', gap: 8, padding: '10px 12px', background: '#f8f9fa', border: '2px solid #e9ecef', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#333', lineHeight: 1.4 }}>
          <input type="checkbox" checked={editMailBenachrichtigungen} onChange={e => setEditMailBenachrichtigungen(e.target.checked)} style={{ marginTop: 2, flexShrink: 0, width: 18, height: 18, cursor: 'pointer' }} />
          <span>
            Benachrichtige mich per Mail, wenn eine Schicht bestätigt, abgesagt oder verschoben wird.
          </span>
        </label>

        <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 10, marginTop: 8 }}>
          <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 4, color: '#444' }}>Kinder für Turnierschichten</div>
          <div style={{ fontSize: 11, color: '#856404', background: '#fff3cd', border: '1px solid #ffeeba', padding: '8px 10px', borderRadius: 6, marginBottom: 12, lineHeight: 1.4 }}>
            ⚠️ <strong>Wichtiger Hinweis:</strong> Ohne die Angabe eines Kindes inklusive Geburtsjahr ist keine Zuordnung zu einer Mannschaft möglich. Eine sinnvolle Teilnahme an der Organisation und Schichtplanung ist dann nicht möglich.
          </div>
          {editChildren.map((child, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="text" placeholder="Name des Kindes" value={child.childName} onChange={e => { const n = [...editChildren]; n[idx].childName = e.target.value; setEditChildren(n); }} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
              <select
                value={child.childYear}
                onChange={e => { const n = [...editChildren]; n[idx].childYear = e.target.value; setEditChildren(n); }}
                style={{ ...inputStyle, width: 130, flexShrink: 0 }}
              >
                <option value="">Geburtsjahr</option>
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {editChildren.length > 1 && (
                <button type="button" onClick={() => { const n = editChildren.filter((_, i) => i !== idx); setEditChildren(n); }} style={{ ...btnStyle, background: '#ffe3e3', color: '#dc3545', border: 'none', padding: '8px 10px', fontSize: 16, flexShrink: 0 }}>🗑️</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setEditChildren([...editChildren, { childName: '', childYear: '' }])} style={{ ...btnStyle, background: '#fff', border: '1px dashed #adb5bd', color: '#495057', padding: '8px 12px', fontSize: 14 }}>👶 Weiteres Kind hinzufügen</button>
        </div>

        <button onClick={saveProfile} style={{ ...btnStyle, background: clubPrimary, color: '#fff', fontSize: 16, padding: '14px', marginTop: 12, boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>Profil speichern</button>

        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #eee' }} />
        
        <h3 style={{ margin: '0 0 16px 0', fontSize: 18, color: '#333' }}>Passwort ändern</h3>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 13, color: '#666' }}>Aktuelles Passwort</label>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 13, color: '#666' }}>Neues Passwort</label>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} />
        </div>
        <button onClick={changePassword} style={{ ...btnStyle, background: '#6c757d', color: '#fff', fontSize: 15, padding: '12px', marginTop: 8 }}>Passwort ändern</button>

        <hr style={{ margin: '32px 0 24px 0', border: 'none', borderTop: '1px solid #eee' }} />
        
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <button onClick={deleteAccount} style={{ background: 'transparent', border: 'none', color: '#dc3545', textDecoration: 'underline', cursor: 'pointer', fontSize: 14 }}>Konto unwiderruflich löschen</button>
        </div>
      </div>
    </div>
  );
}
