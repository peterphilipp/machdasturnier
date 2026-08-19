import { useState, useRef } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkAreas, getWorkAreaCategories, apiPost, apiPatch, apiDelete, updateWorkAreaOrder } from '../../../api';
import { WorkArea, WorkAreaCategory, useSortableData, confirmWithImpact } from '../shared';
import EditModal from '../EditModal';
import { StammdatenKopf, AnlegenDialog } from '../Stammdatenseite';
import WorkAreaCategories from './WorkAreaCategories';

const emojiList = ['🏪', '🍳', '🔥', '🎪', '🎯', '⚽', '🍰', '☕', '🥤', '🏆', '📦', '🗑️', '💰', '🎁', '🎵', '🎠', '🧸', '🎴', '🎲', '🏅', '🥇', '🎖️', '📋', '✅', '❌', '⏰', '📍', '📞', '🔧', '📢', '📣', '📝'];

export default function WorkAreas({ adminPrimary }: { adminPrimary: string }) {
  const queryClient = useQueryClient();
  const { data: workAreas = [], isLoading: isLoadingWA } = useQuery<WorkArea[]>({ queryKey: ['work-areas'], queryFn: getWorkAreas });
  // Selber Schlüssel wie in WorkAreaCategories.tsx - sonst invalidiert das
  // Anlegen einer Kategorie dort nicht die Liste, aus der hier ausgewählt wird,
  // und eine neue Kategorie taucht im Arbeitsbereich-Editor erst nach Reload auf.
  const { data: categories = [], isLoading: isLoadingCat } = useQuery<WorkAreaCategory[]>({ queryKey: ['work-area-categories'], queryFn: getWorkAreaCategories });
  
  const { items: sortedWorkAreas, requestSort, getSortIndicator } = useSortableData(workAreas, { key: 'order', direction: 'asc' });

  const [abForm, setAbForm] = useState({ name: '', icon: '📍', color: '#3b98f8', minVolunteers: 2, maxVolunteers: 8, isStandard: false, categoryIds: [] as number[] });
  const [editingAb, setEditingAb] = useState<number | null>(null);
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const dragItemIndex = useRef<number | null>(null);
  const dragOverItemIndex = useRef<number | null>(null);

  const handleSort = async () => {
    if (dragItemIndex.current === null || dragOverItemIndex.current === null) return;
    if (dragItemIndex.current === dragOverItemIndex.current) return;

    const _areas = [...sortedWorkAreas];
    const draggedItem = _areas.splice(dragItemIndex.current, 1)[0];
    _areas.splice(dragOverItemIndex.current, 0, draggedItem);

    const newOrder = _areas.map(t => t.id);
    await updateWorkAreaOrder(newOrder);
    queryClient.invalidateQueries({ queryKey: ['work-areas'] });
    queryClient.invalidateQueries({ queryKey: ['t-work-areas'] });

    dragItemIndex.current = null;
    dragOverItemIndex.current = null;
  };

  const saveWorkArea = async () => {
    if (!abForm.name.trim()) return await modal.alert({ title: 'Hinweis', message: 'Name erforderlich!' });
    if (editingAb) { await apiPatch(`/api/work-areas/${editingAb}`, abForm); }
    else { await apiPost('/api/work-areas', abForm); }
    queryClient.invalidateQueries({ queryKey: ['work-areas'] });
    queryClient.invalidateQueries({ queryKey: ['day-templates'] }); // in case template tags change
    setAbForm({ name: '', icon: '📍', color: '#3b98f8', minVolunteers: 2, maxVolunteers: 8, isStandard: false, categoryIds: [] });
    setEditingAb(null);
    setAnlegenOffen(false);
  };

  const deleteWorkArea = async (ab: WorkArea) => {
    if (!(await confirmWithImpact('workArea', ab.id, ab.name))) return;
    await apiDelete(`/api/work-areas/${ab.id}`);
    queryClient.invalidateQueries({ queryKey: ['work-areas'] });
  };

  const openEdit = (ab: WorkArea) => { setEditingAb(ab.id); setAbForm({ name: ab.name, icon: ab.icon, color: ab.color, minVolunteers: ab.minVolunteers, maxVolunteers: ab.maxVolunteers, isStandard: ab.isStandard || false, categoryIds: ab.categories?.map(c => c.id) || [] }); setEmojiPickerOpen(false); };
  const closeEdit = () => { setEditingAb(null); setAbForm({ name: '', icon: '📍', color: '#3b98f8', minVolunteers: 2, maxVolunteers: 8, isStandard: false, categoryIds: [] }); setEmojiPickerOpen(false); };

  return (
    <div className="work-areas-style-1">
    <WorkAreaCategories adminPrimary={adminPrimary} />

    <div style={{ background: '#fff', padding: 24, borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
      <StammdatenKopf
        titel="📍 Arbeitsbereiche"
        untertitel="Die Bereiche, für die Schichten geplant werden – z.B. Küche, Grillstand, Kasse."
        neuText="Neuer Arbeitsbereich"
        onNeu={() => setAnlegenOffen(true)}
        farbe={adminPrimary}
      />

      {anlegenOffen && (
        <AnlegenDialog
          titel="📍 Neuen Arbeitsbereich anlegen"
          onAbbrechen={() => setAnlegenOffen(false)}
          onAnlegen={saveWorkArea}
          anlegenText="Arbeitsbereich anlegen"
          breite={560}
          farbe={adminPrimary}
        >
        {/* Emoji Picker */}
        {emojiPickerOpen && (
          <div className="work-areas-style-3">
            {emojiList.map(e => (<button key={e} onClick={() => { setAbForm({ ...abForm, icon: e }); setEmojiPickerOpen(false); }} style={{ fontSize: 20, padding: '4px 6px', border: abForm.icon === e ? '2px solid #0d6efd' : '1px solid #dee2e6', background: abForm.icon === e ? '#e8f4fd' : '#fff', borderRadius: 6, cursor: 'pointer' }}>{e}</button>))}
          </div>
        )}

        {/* Neue ARB Form */}
        <div className="work-areas-style-4">
          <div className="work-areas-style-5">
            <label className="work-areas-style-6">📝 Name</label>
            <input value={abForm.name} onChange={e => setAbForm({ ...abForm, name: e.target.value })} placeholder="z.B. Kasse" className="work-areas-style-7" />
          </div>
          <div className="work-areas-style-8">
            <label className="work-areas-style-9">😀 Icon</label>
            <button onClick={() => setEmojiPickerOpen(!emojiPickerOpen)} className="work-areas-style-10">{abForm.icon}</button>
          </div>
          <div className="work-areas-style-11">
            <label className="work-areas-style-12">🎨 Farbe</label>
            <input type="color" value={abForm.color} onChange={e => setAbForm({ ...abForm, color: e.target.value })} className="work-areas-style-13" />
          </div>
          <div className="work-areas-style-14">
            <label className="work-areas-style-15">👥 Min</label>
            <input type="number" value={abForm.minVolunteers || ''} onChange={e => setAbForm({ ...abForm, minVolunteers: parseInt(e.target.value) || 0 })} placeholder="–" className="work-areas-style-16" />
          </div>
          <div className="work-areas-style-17">
            <label className="work-areas-style-18">👥 Max</label>
            <input type="number" value={abForm.maxVolunteers || ''} onChange={e => setAbForm({ ...abForm, maxVolunteers: parseInt(e.target.value) || 0 })} placeholder="–" className="work-areas-style-19" />
          </div>
        </div>
        </AnlegenDialog>
      )}


    </div>

      <div className="admin-table-scroll">
      <table className="work-areas-style-21 admin-cards-mobile">
        <thead><tr className="work-areas-style-22"><th className="work-areas-style-23">⋮⋮</th><th className="work-areas-style-24">Icon</th><th onClick={() => requestSort('name')} className="work-areas-style-25">Name{getSortIndicator('name')}</th><th className="work-areas-style-27">Kategorien</th><th className="work-areas-style-28">Farbe</th><th className="work-areas-style-26">Standard</th><th onClick={() => requestSort('minVolunteers')} className="work-areas-style-29">Min{getSortIndicator('minVolunteers')}</th><th onClick={() => requestSort('maxVolunteers')} className="work-areas-style-30">Max{getSortIndicator('maxVolunteers')}</th><th className="work-areas-style-31">Aktion</th></tr></thead>
        <tbody>
          {sortedWorkAreas.map((ab, idx) => (
            <tr 
              key={ab.id} 
              draggable 
              onDragStart={() => (dragItemIndex.current = idx)} 
              onDragEnter={() => (dragOverItemIndex.current = idx)} 
              onDragEnd={handleSort} 
              onDragOver={e => e.preventDefault()}
              className="work-areas-style-32"
            >
              <td className="work-areas-style-33">⋮⋮</td>
              <td data-label="Icon" className="work-areas-style-34">{ab.icon}</td>
              <td data-label="Name" className="work-areas-style-35">{ab.name}</td>
              <td data-label="Kategorien" className="work-areas-style-36">
                <div className="work-areas-style-37">
                  {(ab.categories || []).map(cat => (
                    <span key={cat.id} style={{ fontSize: 11, background: cat.color, border: `1px solid ${cat.color}`, padding: '2px 6px', borderRadius: 10 }}>{cat.name}</span>
                  ))}
                </div>
              </td>
              <td data-label="Farbe" className="work-areas-style-38"><div style={{ background: ab.color, width: 40, height: 20, borderRadius: 4 }} /></td>
              <td data-label="Standard" className="work-areas-style-39">
                {ab.isStandard ? '⭐ Ja' : '—'}
              </td>
              <td data-label="Min. Helfer" className="work-areas-style-40">{ab.minVolunteers}</td>
              <td data-label="Max. Helfer" className="work-areas-style-41">{ab.maxVolunteers}</td>
              <td className="work-areas-style-42">
                <button onClick={() => openEdit(ab)} className="work-areas-style-43">✏️</button>
                <button onClick={() => deleteWorkArea(ab)} className="work-areas-style-44">🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Edit Modal */}
      {editingAb && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '28px 32px 24px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', width: '90%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="work-areas-style-45">
              <h3 className="work-areas-style-46">✏️ Arbeitsbereich bearbeiten</h3>
              <button onClick={closeEdit} className="work-areas-style-47">×</button>
            </div>
            {/* Scrollbarer Inhalt */}
            <div className="work-areas-style-48">
              <div className="work-areas-style-49">
                <div>
                  <label className="work-areas-style-50">📝 Name</label>
                  <input value={abForm.name} onChange={e => setAbForm({ ...abForm, name: e.target.value })} placeholder="z.B. Kasse" className="work-areas-style-51" />
                </div>
            
            {/* Emoji Picker */}
            <div>
              <label className="work-areas-style-52">😀 Icon</label>
              <div className="work-areas-style-53">
                {emojiList.map(e => (
                  <button key={e} onClick={() => setAbForm({ ...abForm, icon: e })} style={{ fontSize: 20, padding: '6px 8px', border: abForm.icon === e ? '2px solid #0d6efd' : '1px solid #dee2e6', background: abForm.icon === e ? '#e8f4fd' : '#fff', borderRadius: 8, cursor: 'pointer' }}>{e}</button>
                ))}
              </div>
            </div>

            {/* Kategorien */}
            <div>
              <label className="work-areas-style-54">📂 Kategorien</label>
              <div className="work-areas-style-55">
                {categories.filter(c => !c.isObsolete).map((cat: WorkAreaCategory) => {
                  const isActive = abForm.categoryIds.includes(cat.id);
                  return (
                    <label key={cat.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, background: isActive ? cat.color : '#fff', border: isActive ? `1px solid ${cat.color}` : '1px solid #dee2e6', color: isActive ? '#000' : '#666', borderRadius: 12, padding: '4px 10px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        className="work-areas-style-56" 
                        checked={isActive}
                        onChange={e => {
                          const nextIds = e.target.checked 
                            ? [...abForm.categoryIds, cat.id] 
                            : abForm.categoryIds.filter(id => id !== cat.id);
                          setAbForm({ ...abForm, categoryIds: nextIds });
                        }}
                      />
                      {cat.name}
                    </label>
                  );
                })}
                {categories.length === 0 && <span className="work-areas-style-57">Keine Kategorien vorhanden. Lege weiter unten auf dieser Seite welche an.</span>}
              </div>
            </div>

            {/* Standard-Checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: abForm.isStandard ? '#fff3cd' : '#f8f9fa', border: abForm.isStandard ? '1px solid #ffc107' : '1px solid #dee2e6', borderRadius: 8, cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={abForm.isStandard}
                onChange={e => setAbForm({ ...abForm, isStandard: e.target.checked })}
                className="work-areas-style-58"
              />
              <span className="work-areas-style-59">⭐ Standard-Bereich (wird automatisch bei neuen Turnieren aktiviert)</span>
            </label>

            {/* Farben & Helfer */}
            <div className="work-areas-style-60">
              <div><label className="work-areas-style-61">🎨 Farbe</label><input type="color" value={abForm.color} onChange={e => setAbForm({ ...abForm, color: e.target.value })} className="work-areas-style-62" /></div>
              <div><label className="work-areas-style-63">👥 Min</label><input type="number" value={abForm.minVolunteers} onChange={e => setAbForm({ ...abForm, minVolunteers: parseInt(e.target.value) || 0 })} className="work-areas-style-64" /></div>
              <div><label className="work-areas-style-65">👥 Max</label><input type="number" value={abForm.maxVolunteers} onChange={e => setAbForm({ ...abForm, maxVolunteers: parseInt(e.target.value) || 0 })} className="work-areas-style-66" /></div>
            </div>

            </div>
            {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
            <div className="work-areas-style-67">
              <button onClick={closeEdit} className="work-areas-style-68">Abbrechen</button>
              <button onClick={saveWorkArea} style={{ padding: '10px 20px', background: adminPrimary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>💾 Speichern</button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
