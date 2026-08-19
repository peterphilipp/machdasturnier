import { useState } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTournaments, getClubs, getYearGroups, apiPost, apiPatch, apiDelete } from '../../../api';
import { btnStyleSecondary, Tournament, Club, YearGroup, useSortableData, confirmWithImpact } from '../shared';
import EditModal from '../EditModal';
import { StammdatenKopf, AnlegenDialog } from '../Stammdatenseite';

export default function Turniere({ adminPrimary, adminSecondary }: { adminPrimary: string, adminSecondary: string }) {
  const queryClient = useQueryClient();
  const { data: tournaments = [] } = useQuery<Tournament[]>({ queryKey: ['tournaments'], queryFn: getTournaments });
  const { data: clubs = [] } = useQuery<Club[]>({ queryKey: ['clubs'], queryFn: getClubs });
  const { data: yearGroups = [] } = useQuery<YearGroup[]>({ queryKey: ['yearGroups'], queryFn: getYearGroups });
  
  const { items: sortedTournaments, requestSort, getSortIndicator } = useSortableData(tournaments, { key: 'startDate', direction: 'desc' });

  const [statusDialog, setStatusDialog] = useState({ open: false, tournament: null as Tournament | null, editName: '', editClubId: '', editStart: '', editEnd: '', editStatus: '', yearGroupIds: [] as number[], logoFile: null as File | null, editHasSponsor: false, editSponsorName: '', editSponsorUrl: '', editShiftDates: true });

  const [newTourn, setNewTourn] = useState({ name: '', start: '', end: '', clubId: '', isActive: true });
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [isEndTouched, setIsEndTouched] = useState(false);

  // Keine Datumswerte in der Vergangenheit anbieten (Von/Bis).
  const todayStr = new Date().toISOString().split('T')[0];

  const closeStatusDialog = () => setStatusDialog({ open: false, tournament: null, editName: '', editClubId: '', editStart: '', editEnd: '', editStatus: '', yearGroupIds: [], logoFile: null, editHasSponsor: false, editSponsorName: '', editSponsorUrl: '', editShiftDates: true });

  const saveTournamentEdit = async () => {
    if (!statusDialog.tournament) return;
    if (!statusDialog.editName.trim()) return await modal.alert({ title: 'Hinweis', message: 'Name erforderlich!' });
    if (statusDialog.editStart && statusDialog.editEnd && statusDialog.editStart > statusDialog.editEnd) return await modal.alert({ title: 'Hinweis', message: 'Startdatum darf nicht nach dem Enddatum liegen!' });
    if (statusDialog.editHasSponsor && !statusDialog.editSponsorName.trim()) return await modal.alert({ title: 'Hinweis', message: 'Sponsor-Name erforderlich!' });
    const patchData: any = {
      name: statusDialog.editName, startDate: statusDialog.editStart, endDate: statusDialog.editEnd,
      status: statusDialog.editStatus,
      clubId: statusDialog.editClubId && statusDialog.editClubId !== '' ? parseInt(statusDialog.editClubId) : null,
      yearGroupIds: statusDialog.yearGroupIds,
      hasSponsor: statusDialog.editHasSponsor,
      sponsorName: statusDialog.editSponsorName || null,
      sponsorUrl: statusDialog.editSponsorUrl || null,
      shiftDates: statusDialog.tournament?.startDate.split('T')[0] !== statusDialog.editStart ? statusDialog.editShiftDates : false
    };

    // Logo-Upload wenn vorhanden (als Base64)
    if (statusDialog.logoFile) {
      patchData.logo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(statusDialog.logoFile!);
      });
    }

    await apiPatch(`/api/tournaments/${statusDialog.tournament.id}`, patchData);
    queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    closeStatusDialog();
  };

  const handleNewStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const start = e.target.value;
    setNewTourn(prev => ({
      ...prev,
      start,
      end: !isEndTouched ? start : prev.end
    }));
  };

  const handleNewEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsEndTouched(true);
    setNewTourn(prev => ({ ...prev, end: e.target.value }));
  };

  const createTournament = async () => {
    const { name, start, end, clubId } = newTourn;
    if (!name || !start || !end) return await modal.alert({ title: 'Hinweis', message: 'Name, Start- und Enddatum erforderlich!' });
    if (start > end) return await modal.alert({ title: 'Hinweis', message: 'Startdatum darf nicht nach dem Enddatum liegen!' });
    await apiPost('/api/tournaments', {
      name,
      startDate: start,
      endDate: end,
      status: newTourn.isActive ? 'aktiv' : 'entwurf',
      clubId: clubId ? parseInt(clubId) : null,
      // turnierModus bewusst nicht gesetzt (Backend-Default GRUPPEN_KO greift) -
      // der Modus wird jetzt ausschließlich über den "Modus"-Tab im
      // Spielplanmanagement gepflegt, nicht mehr bei der Turnier-Anlage.
      yearGroupIds: []
    });
    queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    setNewTourn({ name: '', start: '', end: '', clubId: '', isActive: true });
    setIsEndTouched(false);
    setAnlegenOffen(false);
  };

  const deleteTournament = async (t: Tournament) => {
    if (!(await confirmWithImpact('tournament', t.id, t.name))) return;
    await apiDelete(`/api/tournaments/${t.id}`);
    queryClient.invalidateQueries({ queryKey: ['tournaments'] });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; color: string }> = { aktiv: { bg: '#d1e7dd', color: '#0f5132' }, entwurf: { bg: '#e9ecef', color: '#495057' }, archiviert: { bg: '#f8f9fa', color: '#495057' } };
    const c = colors[status] || colors.aktiv;
    return <span className="turniere-status-badge" style={{ background: c.bg, color: c.color }}>{status}</span>;
  };

  return (
    <div className="turniere-card">
      <StammdatenKopf
        titel="🏆 Turnier-Verwaltung"
        untertitel="Alle Turniere mit Zeitraum, Verein und Status."
        neuText="Neues Turnier"
        onNeu={() => setAnlegenOffen(true)}
        farbe={adminPrimary}
      />
      
      {anlegenOffen && (
        <AnlegenDialog
          titel="🏆 Neues Turnier anlegen"
          onAbbrechen={() => setAnlegenOffen(false)}
          onAnlegen={createTournament}
          anlegenText="Turnier anlegen"
          breite={620}
          farbe={adminPrimary}
        >
        <div className="turniere-form-row">
          <div className="turniere-form-group-flex2">
            <label className="turniere-form-label">📝 Name</label>
            <input value={newTourn.name} onChange={e => setNewTourn(prev => ({...prev, name: e.target.value}))} placeholder="z.B. Sommerturnier" className="turniere-form-input" />
          </div>
          <div className="turniere-form-group-w150">
            <label className="turniere-form-label">📅 Von</label>
            <input type="date" value={newTourn.start} min={todayStr} max={newTourn.end || undefined} onChange={handleNewStartChange} className="turniere-form-input" />
          </div>
          <div className="turniere-form-group-w150">
            <label className="turniere-form-label">📅 Bis</label>
            <input type="date" value={newTourn.end} min={newTourn.start || todayStr} onChange={handleNewEndChange} className="turniere-form-input" />
          </div>
          <div className="turniere-form-group-flex1">
            <label className="turniere-form-label">🏅 Verein</label>
            <select value={newTourn.clubId} onChange={e => setNewTourn(prev => ({...prev, clubId: e.target.value}))} className="turniere-form-select">
              <option value="">-- Kein Verein --</option>
              {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="turniere-form-group-w70">
            <label className="turniere-form-label">📊 Aktiv</label>
            <input type="checkbox" id="newTournActive" checked={newTourn.isActive} onChange={e => setNewTourn(prev => ({...prev, isActive: e.target.checked}))} className="turniere-form-checkbox" />
          </div>
        </div>

        </AnlegenDialog>
      )}

      <div className="admin-table-scroll">
      <table className="turniere-table admin-cards-mobile">
        <thead><tr className="turniere-table-header-row"><th onClick={() => requestSort('clubName')} className="turniere-th-left-pointer">Verein{getSortIndicator('clubName')}</th><th onClick={() => requestSort('name')} className="turniere-th-left-pointer">Name{getSortIndicator('name')}</th><th className="turniere-th-center">Sponsor-Logo</th><th onClick={() => requestSort('startDate')} className="turniere-th-right-pointer">Von{getSortIndicator('startDate')}</th><th onClick={() => requestSort('endDate')} className="turniere-th-right-pointer">Bis{getSortIndicator('endDate')}</th><th onClick={() => requestSort('statusBadge')} className="turniere-th-center-pointer">Status{getSortIndicator('statusBadge')}</th><th className="turniere-th-left">Jahrgänge</th><th className="turniere-th-left">Aktion</th></tr></thead>
        <tbody>
          {sortedTournaments.map(t => (
            <tr key={t.id} className="turniere-tr">
              <td data-label="Verein" className="turniere-td">
                {t.club ? (<span className="turniere-club-info">
                  {t.club.logo ? <img src={t.club.logo} alt={t.club.name} className="turniere-club-logo" /> : <span className="turniere-club-logo-placeholder" style={{ background: t.club.primaryColor }}>{t.club.name.charAt(0)}</span>}
                  <span className="turniere-club-name">{t.club.name}</span>
                </span>) : <span className="turniere-gray-text">–</span>}
              </td>
              <td data-label="Name" className="turniere-td-bold">{t.name}</td>
              <td data-label="Sponsor-Logo" className="turniere-td-center">
                {t.logo ? (
                  <img src={t.logo} alt="Sponsor" className="turniere-sponsor-logo" />
                ) : (
                  <span className="turniere-gray-text-small">–</span>
                )}
              </td>
              <td data-label="Von" className="turniere-td-right">{new Date(t.startDate).toLocaleDateString('de-DE')}</td>
              <td data-label="Bis" className="turniere-td-right">{new Date(t.endDate).toLocaleDateString('de-DE')}</td>
              <td data-label="Status" className="turniere-td-center">{statusBadge(t.status)}</td>
              <td data-label="Jahrgänge" className="turniere-td">
                {t.yearGroups && t.yearGroups.length > 0 ? (<div className="turniere-year-group-container">{t.yearGroups.map(yg => (<span key={yg.id} className="turniere-year-group-badge">{yg.name}</span>))}</div>) : <span className="turniere-gray-text">–</span>}
              </td>
              <td className="turniere-td-actions">
                <div className="turniere-actions-container">
                  <button onClick={() => setStatusDialog({ open: true, tournament: t, editName: t.name, editClubId: String(t.clubId || ''), editStart: t.startDate.split('T')[0], editEnd: t.endDate.split('T')[0], editStatus: (t.status || 'aktiv').toLowerCase(), yearGroupIds: t.yearGroups?.map(yg => yg.id) || [], logoFile: null, editHasSponsor: t.hasSponsor || false, editSponsorName: t.sponsorName || '', editSponsorUrl: t.sponsorUrl || '', editShiftDates: true })} className="turniere-btn-edit">✏️</button>
                  <button onClick={() => deleteTournament(t)} className="turniere-btn-delete">🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Edit Modal */}
      {statusDialog.open && statusDialog.tournament && (
        <div className="turniere-modal-overlay">
          <div className="turniere-modal-content">
            <div className="turniere-modal-header">
              <h3 className="turniere-modal-title">✏️ Turnier bearbeiten</h3>
              <button onClick={closeStatusDialog} className="turniere-modal-close">×</button>
            </div>
            {/* Scrollbarer Inhalt */}
            <div className="turniere-modal-body">
              <div className="turniere-modal-form">
            <div>
              <label className="turniere-form-label">📝 Name</label>
              <input value={statusDialog.editName} onChange={e => setStatusDialog({ ...statusDialog, editName: e.target.value })} placeholder="z.B. Sommerturnier 2025" className="turniere-modal-input" />
            </div>
            <div>
              <label className="turniere-form-label">📅 Zeitraum</label>
              <div className="turniere-modal-grid">
                <input type="date" value={statusDialog.editStart} min={todayStr} max={statusDialog.editEnd || undefined} onChange={e => setStatusDialog({ ...statusDialog, editStart: e.target.value })} className="turniere-modal-date-input" />
                <input type="date" value={statusDialog.editEnd} min={statusDialog.editStart || todayStr} onChange={e => setStatusDialog({ ...statusDialog, editEnd: e.target.value })} className="turniere-modal-date-input" />
              </div>
              {statusDialog.tournament && statusDialog.editStart !== statusDialog.tournament.startDate.split('T')[0] && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: '#0d6efd', background: '#e8f4fd', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={statusDialog.editShiftDates} onChange={e => setStatusDialog({ ...statusDialog, editShiftDates: e.target.checked })} style={{ cursor: 'pointer' }} />
                  Geplante Tage, Spiele und Schichten um die Datumsdifferenz verschieben
                </label>
              )}
            </div>
            <div><label className="turniere-form-label">🏅 Verein</label>
              <select value={statusDialog.editClubId} onChange={e => setStatusDialog({ ...statusDialog, editClubId: e.target.value })} className="turniere-modal-select">
                <option value="">-- Kein Verein --</option>
                {clubs.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>

              {/* Sponsor Section */}
              <div className="turniere-sponsor-section">
                <label className="turniere-sponsor-label" style={{ marginBottom: statusDialog.editHasSponsor ? 12 : 0 }}>
                  <input type="checkbox" checked={statusDialog.editHasSponsor} onChange={e => setStatusDialog({ ...statusDialog, editHasSponsor: e.target.checked })} className="turniere-sponsor-checkbox" />
                  🤝 Hat Sponsor?
                </label>
                {statusDialog.editHasSponsor && (
                  <div className="turniere-sponsor-fields">
                    <div>
                      <label className="turniere-form-label">🤝 Sponsor Name</label>
                      <input value={statusDialog.editSponsorName} onChange={e => setStatusDialog({ ...statusDialog, editSponsorName: e.target.value })} placeholder="Name des Sponsors" className="turniere-sponsor-input" />
                    </div>
                    <div>
                      <label className="turniere-form-label">🔗 Sponsor URL</label>
                      <input value={statusDialog.editSponsorUrl} onChange={e => setStatusDialog({ ...statusDialog, editSponsorUrl: e.target.value })} placeholder="https://www.sponsor.de" className="turniere-sponsor-input" />
                    </div>
                    <div>
                      <label className="turniere-form-label">🖼️ Sponsor-Logo</label>
                      {statusDialog.tournament?.logo && (
                        <div><img src={statusDialog.tournament.logo} alt="Aktuelles Logo" className="turniere-sponsor-logo-preview" /></div>
                      )}
                      <input type="file" accept="image/*" onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) setStatusDialog({ ...statusDialog, logoFile: file });
                      }} className="turniere-sponsor-file-input" />
                    </div>
                  </div>
                )}
              </div>
            <div>
              <div className="turniere-year-group-header">
                <label className="turniere-form-label">📅 Jahrgänge</label>
                <div className="turniere-year-group-actions">
                  <button onClick={() => setStatusDialog({ ...statusDialog, yearGroupIds: yearGroups.filter(yg => yg.isActive).map(yg => yg.id) })} className="turniere-year-group-btn">Alle</button>
                  <button onClick={() => setStatusDialog({ ...statusDialog, yearGroupIds: [] })} className="turniere-year-group-btn">Keine</button>
                </div>
              </div>
              <div className="turniere-year-group-list">
                {yearGroups.filter(yg => yg.isActive).map(yg => (
                  <label key={yg.id} className="turniere-year-group-item" style={{ background: statusDialog.yearGroupIds.includes(yg.id) ? '#e8f4fd' : 'transparent' }}>
                    <input type="checkbox" checked={statusDialog.yearGroupIds.includes(yg.id)} onChange={() => {
                      const ids = statusDialog.yearGroupIds.includes(yg.id)
                        ? statusDialog.yearGroupIds.filter(id => id !== yg.id)
                        : [...statusDialog.yearGroupIds, yg.id];
                      setStatusDialog({ ...statusDialog, yearGroupIds: ids });
                    }} className="turniere-year-group-checkbox" />
                    <span className="turniere-year-group-name">{yg.name} ({yg.birthYearStart}-{yg.birthYearEnd})</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Status: nur lokale Auswahl - wird wie alle anderen Felder erst mit
                "Speichern" persistiert, statt sofort zu speichern UND den Editor
                zu schließen (das hätte bisher alle anderen offenen Änderungen im
                selben Editor verworfen). */}
            <div>
              <label className="turniere-form-label">📊 Status</label>
              <div className="turniere-status-container">
                {([
                  { value: 'aktiv', label: '🟢 Aktiv', bg: '#d1e7dd', color: '#0f5132' },
                  { value: 'entwurf', label: '⚪ Entwurf', bg: '#e9ecef', color: '#495057' },
                  { value: 'archiviert', label: '⚫ Archiviert', bg: '#f8f9fa', color: '#495057' }
                ] as const).map(s => {
                  const active = statusDialog.editStatus === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStatusDialog({ ...statusDialog, editStatus: s.value })}
                      className="turniere-status-btn"
                      style={{
                        background: active ? s.bg : '#fff',
                        color: active ? s.color : '#adb5bd',
                        border: active ? '2px solid ' + s.color : '2px solid #dee2e6'
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            </div>
            {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
            <div className="turniere-modal-footer">
              <button onClick={closeStatusDialog} style={btnStyleSecondary} className="turniere-btn-cancel">Abbrechen</button>
              <button onClick={saveTournamentEdit} className="turniere-btn-save" style={{ background: adminPrimary }}>💾 Speichern</button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
