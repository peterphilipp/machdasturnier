import { useState } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getYearGroups, apiPost, apiPatch, apiDelete } from '../../../api';
import { btnStyleSecondary, YearGroup, useSortableData, confirmWithImpact } from '../shared';
import EditModal from '../EditModal';
import { StammdatenKopf, AnlegenDialog } from '../Stammdatenseite';

export default function Jahrgaenge({ adminPrimary }: { adminPrimary: string }) {
  const queryClient = useQueryClient();
  
  const { data: rawYearGroups, isLoading } = useQuery<YearGroup[]>({
    queryKey: ['yearGroups'],
    queryFn: getYearGroups
  });
  
  const yearGroups: YearGroup[] = (rawYearGroups && typeof rawYearGroups === 'object' && 'length' in rawYearGroups) ? rawYearGroups : [];
  const { items: sortedYearGroups, requestSort, getSortIndicator } = useSortableData(yearGroups, { key: 'order', direction: 'asc' });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', birthYearStart: 0, birthYearEnd: 0, order: 0, isActive: true });
  const [anlegenOffen, setAnlegenOffen] = useState(false);

  const save = async () => {
    if (!form.name || !form.birthYearStart || !form.birthYearEnd) return await modal.alert({ title: 'Hinweis', message: 'Alle Felder ausfüllen!' });
    if (form.birthYearStart < 1990 || form.birthYearStart > 2030) return await modal.alert({ title: 'Hinweis', message: 'Geburtsjahr von muss zwischen 1990 und 2030 liegen!' });
    if (form.birthYearEnd < 1990 || form.birthYearEnd > 2030) return await modal.alert({ title: 'Hinweis', message: 'Geburtsjahr bis muss zwischen 1990 und 2030 liegen!' });
    if (form.birthYearStart > form.birthYearEnd) return await modal.alert({ title: 'Hinweis', message: 'Geburtsjahr von darf nicht größer als Geburtsjahr bis sein!' });
    if (form.order < 0) return await modal.alert({ title: 'Hinweis', message: 'Reihenfolge darf nicht negativ sein!' });
    try {
      if (editingId) { await apiPatch(`/api/year-groups/${editingId}`, form); }
      else { await apiPost('/api/year-groups', form); }
      await queryClient.refetchQueries({ queryKey: ['yearGroups'] });
      setForm({ name: '', birthYearStart: 0, birthYearEnd: 0, order: 0, isActive: true });
      setEditingId(null);
      setAnlegenOffen(false);
    } catch (err: any) { await modal.alert({ title: 'Fehler', message: 'Fehler: ' + (err as Error).message }); }
  };

  const deleteItem = async (yg: YearGroup) => {
    if (!(await confirmWithImpact('yearGroup', yg.id, yg.name))) return;
    await apiDelete(`/api/year-groups/${yg.id}`);
    queryClient.invalidateQueries({ queryKey: ['yearGroups'] });
  };

  const openEdit = (yg: YearGroup) => { setEditingId(yg.id); setForm({ name: yg.name, birthYearStart: yg.birthYearStart, birthYearEnd: yg.birthYearEnd, order: yg.order, isActive: yg.isActive }); };
  const closeEdit = () => { setEditingId(null); setForm({ name: '', birthYearStart: 0, birthYearEnd: 0, order: 0, isActive: true }); };

  return (
    <div className="jahrgaenge-container">
      <StammdatenKopf
        titel="📅 Jahrgänge"
        untertitel="Definiere hier die Jahrgänge mit Geburtsjahr-Bereich."
        neuText="Neuer Jahrgang"
        onNeu={() => setAnlegenOffen(true)}
        farbe={adminPrimary}
      />

      {anlegenOffen && (
        <AnlegenDialog
          titel="📅 Neuen Jahrgang anlegen"
          onAbbrechen={() => setAnlegenOffen(false)}
          onAnlegen={save}
          anlegenText="Jahrgang anlegen"
          breite={520}
          farbe={adminPrimary}
        >
        <div className="jahrgaenge-form-row">
          <div className="jahrgaenge-form-col-2">
            <label className="jahrgaenge-label">📝 Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Jahrgang 2016" className="jahrgaenge-input" />
          </div>
          <div className="jahrgaenge-form-col-small">
            <label className="jahrgaenge-label">📅 Von</label>
            <input type="number" value={form.birthYearStart || ''} onChange={e => setForm({ ...form, birthYearStart: parseInt(e.target.value) || 0 })} placeholder="–" className="jahrgaenge-input-small" />
          </div>
          <div className="jahrgaenge-form-col-small">
            <label className="jahrgaenge-label">📅 Bis</label>
            <input type="number" value={form.birthYearEnd || ''} onChange={e => setForm({ ...form, birthYearEnd: parseInt(e.target.value) || 0 })} placeholder="–" className="jahrgaenge-input-small" />
          </div>
          <div className="jahrgaenge-form-col-tiny">
            <label className="jahrgaenge-label">📊 Aktiv</label>
            <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="jahrgaenge-checkbox-large" />
          </div>
        </div>

        </AnlegenDialog>
      )}

      <div className="admin-table-scroll">
      <table className="jahrgaenge-table admin-cards-mobile">
        <thead><tr className="jahrgaenge-table-header-row"><th className="jahrgaenge-table-th-grip">⋮⋮</th><th onClick={() => requestSort('name')} className="jahrgaenge-table-th">Jahrgang{getSortIndicator('name')}</th><th onClick={() => requestSort('yearGroupRange')} className="jahrgaenge-table-th-right">Geburtsjahr{getSortIndicator('yearGroupRange')}</th><th onClick={() => requestSort('isActive')} className="jahrgaenge-table-th-center">Aktiv{getSortIndicator('isActive')}</th><th className="jahrgaenge-table-th-no-cursor">Aktion</th></tr></thead>
        <tbody>
          {isLoading || sortedYearGroups.length === 0 ? (
            <tr><td colSpan={5} className="jahrgaenge-empty-td">Keine Jahrgänge vorhanden.</td></tr>
          ) : (
            sortedYearGroups.map((yg, idx) => (
              <tr key={yg.id} draggable onDragStart={() => {}} onDragEnter={() => {}} onDragEnd={() => {}} onDragOver={e => e.preventDefault()} className="jahrgaenge-table-tr">
                <td className="jahrgaenge-table-td-grip">⋮⋮</td>
                <td data-label="Jahrgang" className="jahrgaenge-table-td">{yg.name}</td>
                <td data-label="Geburtsjahr" className="jahrgaenge-table-td-right">{yg.birthYearStart} – {yg.birthYearEnd}</td>
                <td data-label="Aktiv" className="jahrgaenge-table-td-center">{yg.isActive ? '✅' : '⏸️'}</td>
                <td className="jahrgaenge-table-td-actions">
                  <div className="jahrgaenge-action-btns">
                    <button onClick={() => openEdit(yg)} className="jahrgaenge-btn-edit">✏️</button>
                    <button onClick={() => deleteItem(yg)} className="jahrgaenge-btn-delete">🗑️</button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>

      {/* Edit Modal */}
      {editingId && (
        <div className="jahrgaenge-modal-overlay">
          <div className="jahrgaenge-modal-content">
            <div className="jahrgaenge-modal-header">
              <h3 className="jahrgaenge-modal-title">✏️ Jahrgang bearbeiten</h3>
              <button onClick={closeEdit} className="jahrgaenge-modal-close">×</button>
            </div>
            {/* Scrollbarer Inhalt */}
            <div className="jahrgaenge-modal-body">
              <div className="jahrgaenge-modal-form">
                <div>
                  <label className="jahrgaenge-label">📝 Name</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Jahrgang 2016" className="jahrgaenge-input" />
                </div>
                <div className="jahrgaenge-grid-2">
              <div><label className="jahrgaenge-label">📅 Von</label><input type="number" value={form.birthYearStart || ''} onChange={e => setForm({ ...form, birthYearStart: parseInt(e.target.value) || 0 })} className="jahrgaenge-input-small" /></div>
              <div><label className="jahrgaenge-label">📅 Bis</label><input type="number" value={form.birthYearEnd || ''} onChange={e => setForm({ ...form, birthYearEnd: parseInt(e.target.value) || 0 })} className="jahrgaenge-input-small" /></div>
            </div>
            <label className="jahrgaenge-checkbox-label">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Aktiv
            </label>
            </div>
            {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
            <div className="jahrgaenge-modal-footer">
              <button onClick={closeEdit} style={btnStyleSecondary} className="jahrgaenge-btn-cancel">Abbrechen</button>
              <button onClick={save} className="jahrgaenge-btn-save" style={{ background: adminPrimary }}>💾 Speichern</button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
