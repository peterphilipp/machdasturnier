import { useState, Fragment } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getVolunteers, getYearGroups, apiPost, apiPatch, apiDelete } from '../../../api';
import { btnStyleSecondary, Volunteer, YearGroup, useSortableData, confirmWithImpact } from '../shared';
import EditModal from '../EditModal';
import PersonenAuswahl from '../PersonenAuswahl';
import { formatPhoneNumber } from '../../../utils/phone';

const ROLES = [
  { value: 'HELPER', label: '🔒 Helfer', colorClass: 'helfer-role-helper' },
  { value: 'TRAINER', label: '⚽ Trainer', colorClass: 'helfer-role-trainer' },
  { value: 'ORGANIZER', label: '🔧 Organisator', colorClass: 'helfer-role-organizer' },
  { value: 'ADMIN', label: '👑 Admin', colorClass: 'helfer-role-admin' }
] as const;

function RoleBadge({ role }: { role: string }) {
  const r = ROLES.find(r => r.value === role) || ROLES[0];
  return (
    <span className={`helfer-role-badge ${r.colorClass}`}>
      {r.label}
    </span>
  );
}

/**
 * Helfer ohne App-Zugang: meist Jugendliche, die mithelfen, aber kein eigenes
 * Konto, Handy oder Internet haben und vom Organisator eingeplant werden.
 *
 * Ohne Kontaktperson erreicht sie keine Meldung - wird ihre Schicht
 * verschoben, erfährt das niemand. Deshalb steht die Auswahl direkt unter dem
 * Ankreuzfeld und nicht in einem Untermenü.
 *
 * Eigene Komponente, weil dieselben Felder im Anlegen-Formular UND im
 * Bearbeiten-Dialog gebraucht werden.
 */
function OhneZugangFeld({ form, setForm, volunteers, editingVol }: {
  form: { ohneZugang: boolean; kontaktpersonId: string };
  setForm: (aendern: (f: any) => any) => void;
  volunteers: Volunteer[];
  editingVol: number | null;
}) {
  return (
    <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '10px 12px' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.ohneZugang}
          onChange={e => setForm((f: any) => ({ ...f, ohneZugang: e.target.checked, kontaktpersonId: e.target.checked ? f.kontaktpersonId : '' }))}
          style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
        />
        <span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#212529' }}>Helfer ohne App-Zugang</span>
          <span style={{ display: 'block', fontSize: 12, color: '#6c757d', lineHeight: 1.5 }}>
            Kein Konto, keine Anmeldung, keine Benachrichtigungen – z.B. Jugendliche, die vom
            Organisator eingeplant werden.
          </span>
        </span>
      </label>

      {form.ohneZugang && (
        <div style={{ marginTop: 10, paddingLeft: 26 }}>
          <label className="helfer-label">📨 Benachrichtigungen gehen an</label>
          <PersonenAuswahl
            wert={form.kontaktpersonId ? Number(form.kontaktpersonId) : ''}
            onWaehlen={id => setForm((f: any) => ({ ...f, kontaktpersonId: id === '' ? '' : String(id) }))}
            leerText="-- niemand (nicht empfohlen) --"
            platzhalter="Elternteil suchen …"
            personen={volunteers
              .filter(v => !v.ohneZugang && v.id !== editingVol)
              .map(v => ({ id: v.id, name: v.name, email: v.email }))}
          />
          <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4, lineHeight: 1.5 }}>
            In der Regel ein Elternteil. Wird die Schicht verschoben, bekommt diese Person die
            Nachricht – mit dem Namen im Text.
          </div>
        </div>
      )}
    </div>
  );
}

export default function Helfer({ adminPrimary, tournamentId }: { adminPrimary: string, tournamentId: number | null }) {
  const queryClient = useQueryClient();
  /**
   * Filter je Spalte. Bei inzwischen über fünfzig Benutzern reicht eine
   * einzelne Suche über Name und E-Mail nicht mehr - gesucht wird gezielt,
   * etwa "alle Organisatoren ohne Telefonnummer".
   *
   * Freitext dort, wo die Daten frei sind; feste Auswahl dort, wo sie es nicht
   * sind. Ein Freitextfeld für die Rolle wäre nur eine Einladung zum Vertippen.
   */
  const LEERER_FILTER = { name: '', email: '', phone: '', rolle: '', zugang: '', aktivitaet: '' };
  const [filter, setFilter] = useState(LEERER_FILTER);
  const setzeFilter = (feld: keyof typeof LEERER_FILTER, wert: string) =>
    setFilter(f => ({ ...f, [feld]: wert }));
  const filterAktiv = Object.values(filter).some(v => v !== '');
  // Fetch ALL users unconditionally for the user management view
  const { data: volunteers = [] } = useQuery<Volunteer[]>({ queryKey: ['volunteers'], queryFn: () => getVolunteers() });
  const { data: yearGroups = [] } = useQuery<YearGroup[]>({ queryKey: ['yearGroups'], queryFn: getYearGroups });

  const [volForm, setVolForm] = useState<{ name: string; email: string; phone: string; roles: string[]; children: { childName: string; childYear: string }[]; trainedYearGroupIds: number[]; ohneZugang: boolean; kontaktpersonId: string }>({ name: '', email: '', phone: '', roles: ['HELPER'], children: [], trainedYearGroupIds: [], ohneZugang: false, kontaktpersonId: '' });
  const [editingVol, setEditingVol] = useState<number | null>(null);
  // Aufklappbare Geräte-Detailansicht pro User (welche Geräte haben Push
  // aktiviert) - hilft bei der Fehlersuche, wenn ein Helfer mehrere Geräte
  // nutzt und nur auf einem Nachrichten ankommen.
  const [expandedPushId, setExpandedPushId] = useState<number | null>(null);

  /** Jahrgang, dem ein Geburtsjahr zugeordnet würde - rein über den Bereichs-Abgleich, es gibt kein eigenes Zuordnungsfeld. */
  const matchingYearGroup = (childYear: string) => {
    const y = parseInt(childYear);
    if (!y) return null;
    return yearGroups.find(yg => y >= yg.birthYearStart && y <= yg.birthYearEnd) || null;
  };

  const enthaelt = (wert: string | null | undefined, suche: string) =>
    !suche || (wert || '').toLowerCase().includes(suche.toLowerCase().trim());

  const filtered = volunteers.filter(v => {
    if (!enthaelt(v.name, filter.name)) return false;
    if (!enthaelt(v.email, filter.email)) return false;
    if (!enthaelt(v.phone, filter.phone)) return false;

    if (filter.rolle) {
      const rollen = (v.roles && v.roles.length > 0) ? v.roles : [v.role || 'HELPER'];
      if (!rollen.includes(filter.rolle as any)) return false;
    }

    if (filter.zugang === 'ohne' && !v.ohneZugang) return false;
    if (filter.zugang === 'mit' && v.ohneZugang) return false;
    // Ohne Kontaktperson erreicht diesen Helfer keine Meldung - dafuer gibt es
    // einen eigenen Filter, damit die Luecken auffindbar bleiben.
    if (filter.zugang === 'ohneKontakt' && !(v.ohneZugang && !v.kontaktpersonId)) return false;

    if (filter.aktivitaet === 'nie' && v.lastActivityAt) return false;
    if (filter.aktivitaet === 'aktiv' && !v.lastActivityAt) return false;
    if (filter.aktivitaet === 'alt' && v.lastActivityAt) {
      const tage = (Date.now() - new Date(v.lastActivityAt).getTime()) / 86400000;
      if (tage < 90) return false;
    }
    if (filter.aktivitaet === 'alt' && !v.lastActivityAt) return false;

    return true;
  });
  
  const { items: sortedVolunteers, requestSort, getSortIndicator } = useSortableData(filtered, { key: 'name', direction: 'asc' });

  const EMPTY_FORM = { name: '', email: '', phone: '', roles: ['HELPER'] as string[], children: [] as { childName: string; childYear: string }[], trainedYearGroupIds: [] as number[], ohneZugang: false, kontaktpersonId: '' as string };

  /** Rolle an-/abwählen; ohne Auswahl bleibt HELPER als Grundstufe. */
  const toggleRole = (wert: string) => setVolForm(f => {
    const naechste = f.roles.includes(wert) ? f.roles.filter(r => r !== wert) : [...f.roles, wert];
    return { ...f, roles: naechste.length > 0 ? naechste : ['HELPER'] };
  });

  const saveVolunteer = async () => {
    if (!volForm.name.trim()) return await modal.alert({ title: 'Hinweis', message: 'Name erforderlich!' });
    if (volForm.name.trim().length > 100) return await modal.alert({ title: 'Hinweis', message: 'Name darf maximal 100 Zeichen lang sein!' });
    if (volForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(volForm.email.trim())) return await modal.alert({ title: 'Hinweis', message: 'Bitte eine gültige E-Mail-Adresse eingeben!' });
    for (const c of volForm.children) {
      if (!c.childName.trim() && !c.childYear.trim()) continue; // komplett leere Zeile wird beim Speichern ignoriert
      if (!c.childName.trim() || !c.childYear.trim()) return await modal.alert({ title: 'Hinweis', message: 'Bei einem Kind fehlt der Name oder das Geburtsjahr - bitte beides ausfüllen oder die Zeile entfernen.' });
      const y = parseInt(c.childYear);
      if (isNaN(y) || y < 1990 || y > 2030) return await modal.alert({ title: 'Hinweis', message: 'Geburtsjahr eines Kindes muss zwischen 1990 und 2030 liegen.' });
    }
    if (volForm.ohneZugang && !volForm.kontaktpersonId) {
      const trotzdem = await modal.confirm({
        title: 'Ohne Kontaktperson speichern?',
        message: 'Dieser Helfer hat keinen App-Zugang. Ohne Kontaktperson erreicht ihn keine '
          + 'Benachrichtigung – wird seine Schicht verschoben, erfährt das niemand. '
          + 'Trotzdem so speichern?',
        confirmText: 'Trotzdem speichern',
        variant: 'warning'
      });
      if (!trotzdem) return;
    }

    const payload = {
      ...volForm,
      kontaktpersonId: volForm.ohneZugang && volForm.kontaktpersonId ? Number(volForm.kontaktpersonId) : null,
      children: volForm.children
        .filter(c => c.childName.trim() && c.childYear.trim())
        .map(c => ({ childName: c.childName.trim(), childYear: parseInt(c.childYear) }))
    };
    if (editingVol) {
      await apiPatch(`/api/volunteers/${editingVol}`, payload);
    } else {
      await apiPost('/api/volunteers', payload);
    }
    queryClient.invalidateQueries({ queryKey: ['volunteers'] });
    setVolForm(EMPTY_FORM);
    setEditingVol(null);
  };

  const deleteVolunteer = async (v: Volunteer) => {
    if (!(await confirmWithImpact('volunteer', v.id, v.name))) return;
    await apiDelete(`/api/volunteers/${v.id}`);
    queryClient.invalidateQueries({ queryKey: ['volunteers'] });
  };

  const openEdit = (v: Volunteer) => {
    setEditingVol(v.id);
    setVolForm({
      name: v.name, email: v.email || '', phone: v.phone || '', roles: (v.roles && v.roles.length > 0) ? [...v.roles] : [v.role || 'HELPER'],
      children: (v.children || []).map(c => ({ childName: c.childName, childYear: String(c.childYear) })),
      trainedYearGroupIds: (v.trainedYearGroups || []).map(yg => yg.id),
      ohneZugang: !!v.ohneZugang,
      kontaktpersonId: v.kontaktpersonId ? String(v.kontaktpersonId) : ''
    });
  };
  const closeEdit = () => { setEditingVol(null); setVolForm(EMPTY_FORM); };

  return (
    <div className="helfer-container">
      <h2 className="helfer-title">👤 Benutzer & Personal</h2>
      <p className="helfer-subtitle">Alle registrierten Benutzer und zugewiesene Helfer</p>
      
      {/* Filter je Spalte. Bewusst als eigener Block über der Tabelle und nicht
          als Zeile im Tabellenkopf: Auf schmalen Geräten wird die Tabelle zu
          Karten, eine Kopfzeile gäbe es dort gar nicht mehr. */}
      <div className="helfer-filter">
        <div className="helfer-filter-feld">
          <label className="helfer-label">📝 Name</label>
          <input value={filter.name} onChange={e => setzeFilter('name', e.target.value)}
                 placeholder="enthält …" className="helfer-input" />
        </div>
        <div className="helfer-filter-feld">
          <label className="helfer-label">📧 E-Mail</label>
          <input value={filter.email} onChange={e => setzeFilter('email', e.target.value)}
                 placeholder="enthält …" className="helfer-input" />
        </div>
        <div className="helfer-filter-feld">
          <label className="helfer-label">📞 Telefon</label>
          <input value={filter.phone} onChange={e => setzeFilter('phone', e.target.value)}
                 placeholder="enthält …" className="helfer-input" />
        </div>
        <div className="helfer-filter-feld">
          <label className="helfer-label">🎭 Rolle</label>
          <select value={filter.rolle} onChange={e => setzeFilter('rolle', e.target.value)} className="helfer-input">
            <option value="">alle</option>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="helfer-filter-feld">
          <label className="helfer-label">🔑 Zugang</label>
          <select value={filter.zugang} onChange={e => setzeFilter('zugang', e.target.value)} className="helfer-input">
            <option value="">alle</option>
            <option value="mit">mit App-Zugang</option>
            <option value="ohne">ohne App-Zugang</option>
            <option value="ohneKontakt">⚠️ ohne Zugang und ohne Kontaktperson</option>
          </select>
        </div>
        <div className="helfer-filter-feld">
          <label className="helfer-label">🕓 Aktivität</label>
          <select value={filter.aktivitaet} onChange={e => setzeFilter('aktivitaet', e.target.value)} className="helfer-input">
            <option value="">alle</option>
            <option value="aktiv">schon einmal angemeldet</option>
            <option value="nie">noch nie angemeldet</option>
            <option value="alt">seit über 90 Tagen nicht</option>
          </select>
        </div>
      </div>

      <div className="helfer-filter-fuss">
        <span>
          {filtered.length === volunteers.length
            ? `${volunteers.length} Benutzer`
            : `${filtered.length} von ${volunteers.length} Benutzern`}
        </span>
        {filterAktiv && (
          <button onClick={() => setFilter(LEERER_FILTER)} className="helfer-filter-reset">
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Neue Helfer Form */}
      <div className="helfer-form-row">
        <div className="helfer-form-col-2">
          <label className="helfer-label">📝 Name</label>
          <input value={volForm.name} onChange={e => setVolForm({ ...volForm, name: e.target.value })} placeholder="Vor- und Nachname" className="helfer-input" />
        </div>
        <div className="helfer-form-col-1">
          <label className="helfer-label">📧 E-Mail</label>
          <input
            value={volForm.email}
            onChange={e => setVolForm({ ...volForm, email: e.target.value })}
            placeholder={volForm.ohneZugang ? 'nicht nötig' : 'email@beispiel.de'}
            disabled={volForm.ohneZugang}
            className="helfer-input"
          />
        </div>
      </div>

      <div className="helfer-form-row">
        <div style={{ flex: 1 }}>
          <OhneZugangFeld form={volForm} setForm={setVolForm} volunteers={volunteers} editingVol={editingVol} />
        </div>
      </div>
      <div className="helfer-form-row">
        <div className="helfer-form-col-fixed">
          <label className="helfer-label">📞 Telefon</label>
          <input value={volForm.phone} onChange={e => setVolForm({ ...volForm, phone: e.target.value })} onBlur={() => setVolForm({ ...volForm, phone: formatPhoneNumber(volForm.phone) || volForm.phone })} placeholder="+49 123 456789" className="helfer-input" />
        </div>
        <div className="helfer-form-col-2">
          <label className="helfer-label">🎭 Rolle</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ROLES.map(r => (
              <label key={r.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, border: '1px solid #dee2e6', borderRadius: 8, padding: '8px 10px', minHeight: 40, cursor: 'pointer', background: volForm.roles.includes(r.value) ? '#e7f1ff' : '#fff' }}>
                <input type="checkbox" checked={volForm.roles.includes(r.value)} onChange={() => toggleRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
        <button onClick={saveVolunteer} className="helfer-btn-primary" style={{ background: adminPrimary }}>
          <span className="helfer-btn-primary-icon" aria-hidden="true">+</span><span>Hinzufügen</span>
        </button>
      </div>
      {volForm.roles.includes('TRAINER') && (
        <div className="helfer-form-row" style={{ marginTop: '-12px' }}>
          <div className="helfer-form-col-2">
            <label className="helfer-label">Zuständige Jahrgänge (Trainer)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '12px', background: '#f8f9fa', borderRadius: '10px', border: '1px solid #dee2e6' }}>
              {yearGroups.map(yg => (
                <label key={yg.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px', color: '#495057' }}>
                  <input
                    type="checkbox"
                    checked={volForm.trainedYearGroupIds.includes(yg.id)}
                    onChange={(e) => {
                      const newIds = e.target.checked
                        ? [...volForm.trainedYearGroupIds, yg.id]
                        : volForm.trainedYearGroupIds.filter(id => id !== yg.id);
                      setVolForm({ ...volForm, trainedYearGroupIds: newIds });
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  {yg.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="admin-table-scroll">
      <table className="helfer-table admin-cards-mobile">
        <thead>
          <tr className="helfer-table-header-row">
            <th onClick={() => requestSort('name')} className="helfer-table-th">Name{getSortIndicator('name')}</th>
            <th onClick={() => requestSort('email')} className="helfer-table-th">E-Mail{getSortIndicator('email')}</th>
            <th onClick={() => requestSort('phone')} className="helfer-table-th">Telefon{getSortIndicator('phone')}</th>
            <th onClick={() => requestSort('role')} className="helfer-table-th">Rolle{getSortIndicator('role')}</th>
            <th onClick={() => requestSort('lastActivityAt')} className="helfer-table-th">Letzte Aktivität{getSortIndicator('lastActivityAt')}</th>
            <th className="helfer-table-th-no-cursor">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {sortedVolunteers.map(v => {
            const devices = v.pushSubscriptions || [];
            const isExpanded = expandedPushId === v.id;
            return (
            <Fragment key={v.id}>
            <tr className={`helfer-table-tr ${isExpanded ? 'helfer-table-tr-expanded' : ''}`}>
              <td data-label="Name" className="helfer-table-td">
                {v.name}
                {(v.children || []).some(c => !matchingYearGroup(String(c.childYear))) && (
                  <span title="Mindestens ein Kind passt zu keinem Jahrgang - bitte prüfen" className="helfer-warning-icon">⚠️</span>
                )}
                {devices.length > 0 && (
                  <button
                    onClick={() => setExpandedPushId(isExpanded ? null : v.id)}
                    title={`Push-Benachrichtigungen aktiviert (${devices.length} Gerät${devices.length === 1 ? '' : 'e'}) - Details anzeigen`}
                    className="helfer-push-btn"
                  >
                    🔔 <span className="helfer-push-indicator">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                )}
              </td>
              <td data-label="E-Mail" className="helfer-table-td-normal">{v.email || '–'}</td>
              <td data-label="Telefon" className="helfer-table-td-normal">{v.phone || '–'}</td>
              <td data-label="Rolle" className="helfer-table-td-normal">
                <div className="helfer-flex-row">
                  {((v.roles && v.roles.length > 0) ? v.roles : [v.role || 'HELPER']).map(r => <RoleBadge key={r} role={r} />)}
                  {v.ohneZugang && (
                    <span
                      style={{ fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '2px 8px', background: '#F1EFE8', color: '#5F5E5A', border: '1px solid #D3D1C7', whiteSpace: 'nowrap' }}
                      title={v.kontaktperson?.name
                        ? `Kein App-Zugang. Benachrichtigungen gehen an ${(v as any).kontaktperson.name}.`
                        : 'Kein App-Zugang und keine Kontaktperson - Benachrichtigungen erreichen niemanden.'}
                    >
                      {v.kontaktperson?.name ? 'Ohne Zugang' : '⚠️ Ohne Zugang'}
                    </span>
                  )}
                </div>
              </td>
              <td data-label="Letzte Aktivität" title={v.lastActivityAt ? new Date(v.lastActivityAt).toLocaleString('de-DE') : 'Nie'} className={`helfer-table-td-normal helfer-date-text ${v.lastActivityAt ? 'helfer-date-active' : 'helfer-date-inactive'}`}>
                {v.lastActivityAt ? new Date(v.lastActivityAt).toLocaleDateString('de-DE') : 'Nie'}
              </td>
              <td className="helfer-table-td-actions">
                <div className="helfer-action-btns">
                  <button onClick={() => openEdit(v)} className="helfer-btn-edit">✏️</button>
                  {/* Ohne App-Zugang gibt es kein Konto, an dem ein Passwort haengen koennte. */}
                  {!v.ohneZugang && (
                  <button onClick={async () => {
                    const result = await modal.form({
                      title: 'Passwort ändern',
                      message: `Neues Passwort für „${v.name}". Damit meldet sich die Person danach an.`,
                      fields: [{ key: 'password', label: 'Neues Passwort', type: 'password' }]
                    });
                    // modal.form liefert beim Abbrechen ein LEERES OBJEKT, nicht null.
                    // Die alte Prüfung "if (!result)" griff deshalb nie: Abbrechen
                    // schickte ein PATCH ohne Passwort los, der Server lehnte es mit
                    // 400 ab, und weil der Fehler niemand auffing, passierte sichtbar
                    // gar nichts - der Eindruck, das Passwort sei gesetzt, täuschte.
                    const passwort = String(result?.password ?? '').trim();
                    if (!passwort) return;
                    try {
                      await apiPatch(`/api/volunteers/${v.id}/password`, { password: passwort });
                      await modal.alert({ title: 'Erfolg', message: `Passwort für „${v.name}" gesetzt.` });
                    } catch (err: unknown) {
                      await modal.alert({
                        title: 'Nicht gesetzt',
                        message: (err as Error).message || 'Das Passwort konnte nicht gesetzt werden.'
                      });
                    }
                  }} className="helfer-btn-password" title="Passwort setzen">🔑</button>
                  )}
                  <button onClick={() => deleteVolunteer(v)} className="helfer-btn-delete">🗑️</button>
                </div>
              </td>
            </tr>
            {isExpanded && (
              <tr className="helfer-table-tr helfer-expanded-row">
                <td colSpan={6} className="helfer-expanded-td">
                  <div className="helfer-expanded-title">Geräte mit aktivierten Push-Benachrichtigungen:</div>
                  <div className="helfer-expanded-list">
                    {devices.map(d => (
                      <div key={d.id} className="helfer-expanded-item">
                        <span>📱</span>
                        <span className="helfer-device-label">{d.deviceLabel || 'Unbekanntes Gerät'}</span>
                        {d.createdAt && <span className="helfer-device-date">· seit {new Date(d.createdAt).toLocaleDateString('de-DE')}</span>}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
          {volunteers.length === 0 ? (
            <tr><td colSpan={6} className="helfer-empty-td">Keine Benutzer vorhanden.</td></tr>
          ) : (filtered.length === 0 ? (
            <tr><td colSpan={6} className="helfer-empty-td">
              Keine Benutzer passen zu den gesetzten Filtern.
            </td></tr>
          ) : null)}
        </tbody>
      </table>
      </div>

      {/* Edit Modal */}
      {editingVol && (
        <div className="helfer-modal-overlay">
          <div className="helfer-modal-content">
            <div className="helfer-modal-header">
              <h3 className="helfer-modal-title">✏️ Helfer bearbeiten</h3>
              <button onClick={closeEdit} className="helfer-modal-close">×</button>
            </div>
            {/* Scrollbarer Inhalt */}
            <div className="helfer-modal-body">
              <div className="helfer-modal-form">
                <div>
                  <label className="helfer-label">📝 Name</label>
                  <input value={volForm.name} onChange={e => setVolForm({ ...volForm, name: e.target.value })} placeholder="Vor- und Nachname" className="helfer-modal-input" />
                </div>
                <div>
                  <label className="helfer-label">📧 E-Mail</label>
                  <input
                    value={volForm.email}
                    onChange={e => setVolForm({ ...volForm, email: e.target.value })}
                    placeholder={volForm.ohneZugang ? 'nicht nötig' : 'email@beispiel.de'}
                    disabled={volForm.ohneZugang}
                    className="helfer-modal-input"
                  />
                </div>
                <div>
                  <label className="helfer-label">📞 Telefon</label>
                  <input value={volForm.phone} onChange={e => setVolForm({ ...volForm, phone: e.target.value })} onBlur={() => setVolForm({ ...volForm, phone: formatPhoneNumber(volForm.phone) || volForm.phone })} placeholder="+49 123 456789" className="helfer-modal-input" />
                </div>

                <OhneZugangFeld form={volForm} setForm={setVolForm} volunteers={volunteers} editingVol={editingVol} />
            
            <div><label className="helfer-label">🎭 Rolle</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ROLES.map(r => (
                  <label key={r.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, border: '1px solid #dee2e6', borderRadius: 8, padding: '8px 10px', minHeight: 40, cursor: 'pointer', background: volForm.roles.includes(r.value) ? '#e7f1ff' : '#fff' }}>
                    <input type="checkbox" checked={volForm.roles.includes(r.value)} onChange={() => toggleRole(r.value)} />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            
            {volForm.roles.includes('TRAINER') && (
              <div>
                <label className="helfer-label">Zuständige Jahrgänge (Trainer)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
                  {yearGroups.map(yg => (
                    <label key={yg.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                      <input
                        type="checkbox"
                        checked={volForm.trainedYearGroupIds.includes(yg.id)}
                        onChange={(e) => {
                          const newIds = e.target.checked
                            ? [...volForm.trainedYearGroupIds, yg.id]
                            : volForm.trainedYearGroupIds.filter(id => id !== yg.id);
                          setVolForm({ ...volForm, trainedYearGroupIds: newIds });
                        }}
                      />
                      {yg.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Kinder: bei der Registrierung vom Nutzer selbst eingetragen, hier
                korrigierbar - der Jahrgang ergibt sich rein aus dem Geburtsjahr
                (kein eigenes Zuordnungsfeld), ein Zahlendreher landet den
                Helfer sonst beim falschen Jahrgang oder bei gar keinem. */}
            <div>
              <label className="helfer-label">👶 Kinder</label>
              <div className="helfer-children-container">
                {volForm.children.map((c, idx) => {
                  const yg = matchingYearGroup(c.childYear);
                  return (
                    <div key={idx}>
                      <div className="helfer-child-row">
                        <input
                          value={c.childName}
                          onChange={e => setVolForm({ ...volForm, children: volForm.children.map((x, i) => i === idx ? { ...x, childName: e.target.value } : x) })}
                          placeholder="Name des Kindes"
                          className="helfer-child-name"
                        />
                        <input
                          value={c.childYear}
                          onChange={e => setVolForm({ ...volForm, children: volForm.children.map((x, i) => i === idx ? { ...x, childYear: e.target.value } : x) })}
                          placeholder="Jg."
                          type="number"
                          className="helfer-child-year"
                        />
                        <button
                          type="button"
                          onClick={() => setVolForm({ ...volForm, children: volForm.children.filter((_, i) => i !== idx) })}
                          className="helfer-child-remove"
                        >×</button>
                      </div>
                      {c.childYear.trim() && (
                        <div className={`helfer-child-status ${yg ? 'helfer-child-status-ok' : 'helfer-child-status-err'}`}>
                          {yg ? `✓ Jahrgang: ${yg.name}` : '⚠️ Kein Jahrgang gefunden für dieses Geburtsjahr'}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setVolForm({ ...volForm, children: [...volForm.children, { childName: '', childYear: '' }] })}
                  className="helfer-child-add"
                >➕ Kind hinzufügen</button>
              </div>
            </div>

            </div>
            {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
            <div className="helfer-modal-footer">
              <button onClick={closeEdit} style={btnStyleSecondary} className="helfer-btn-cancel">Abbrechen</button>
              <button onClick={saveVolunteer} className="helfer-btn-save" style={{ background: adminPrimary }}>💾 Speichern</button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
