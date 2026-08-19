import { useState, useRef } from 'react';
import { StammdatenKopf, AnlegenDialog } from '../Stammdatenseite';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkAreaCategories, createWorkAreaCategory, updateWorkAreaCategory, deleteWorkAreaCategory, updateWorkAreaCategoryOrder } from '../../../api';
import { modal } from '../Modal';
import { btnStyle, inputStyle, confirmWithImpact } from '../shared';
import type { WorkAreaCategory } from '../shared';

export default function WorkAreaCategories({ adminPrimary = '#6c757d' }: { adminPrimary?: string }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery<WorkAreaCategory[]>({ queryKey: ['work-area-categories'], queryFn: getWorkAreaCategories });

  const [newName, setNewName] = useState('');
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const dragItemIndex = useRef<number | null>(null);
  const dragOverItemIndex = useRef<number | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['work-area-categories'] });
    // GlobalDayTemplates.tsx als ['work-areas'] - invalidieren.
    qc.invalidateQueries({ queryKey: ['work-areas'] });
    qc.invalidateQueries({ queryKey: ['day-templates'] });
  };

  /** Einheitliche Fehlerbehandlung: 401/403 sichtbar machen statt still zu scheitern. */
  const guard = async (fn: () => Promise<void>) => {
    try { await fn(); }
    catch (e: any) {
      await modal.alert({
        title: e?.status === 401 ? 'Sitzung abgelaufen' : 'Fehler',
        message: e?.status === 401
          ? 'Bitte melde dich neu an – dein Token ist ungültig oder abgelaufen.'
          : (e?.message || 'Aktion fehlgeschlagen')
      });
    }
  };

  const addCategory = () => guard(async () => {
    if (!newName.trim()) return;
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    await createWorkAreaCategory({ name: newName.trim(), color: randomColor });
    setNewName('');
    setAnlegenOffen(false);
    refresh();
  });

  const removeCategory = (cat: WorkAreaCategory) => guard(async () => {
    if (!(await confirmWithImpact('workAreaCategory', cat.id, cat.name))) return;
    await deleteWorkAreaCategory(cat.id);
    refresh();
  });

  const toggleObsolete = (cat: WorkAreaCategory) => guard(async () => {
    await updateWorkAreaCategory(cat.id, { isObsolete: !cat.isObsolete });
    refresh();
  });

  const updateColor = (id: number, color: string) => guard(async () => {
    await updateWorkAreaCategory(id, { color });
    refresh();
  });

  const updateName = (id: number, name: string) => guard(async () => {
    if (!name.trim()) return; // leerer Name wird serverseitig abgelehnt
    await updateWorkAreaCategory(id, { name: name.trim() });
    refresh();
  });

  const handleSort = () => guard(async () => {
    if (dragItemIndex.current === null || dragOverItemIndex.current === null) return;
    if (dragItemIndex.current === dragOverItemIndex.current) return;

    const _cats = [...categories];
    const draggedItem = _cats.splice(dragItemIndex.current, 1)[0];
    _cats.splice(dragOverItemIndex.current, 0, draggedItem);

    const newOrder = _cats.map(t => t.id);
    await updateWorkAreaCategoryOrder(newOrder);
    refresh();

    dragItemIndex.current = null;
    dragOverItemIndex.current = null;
  });

  return (
    <div style={{ background: '#fff', padding: 24, borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
      <StammdatenKopf
        titel="🏷️ Arbeitsbereich-Kategorien"
        untertitel="Kategorien (z.B. Aufbau, Spielbetrieb) für Arbeitsbereiche. Tagesvorlagen bilden ihren Namen daraus."
        neuText="Neue Kategorie"
        onNeu={() => setAnlegenOffen(true)}
        farbe={adminPrimary}
      />

      {anlegenOffen && (
        <AnlegenDialog
          titel="🏷️ Neue Kategorie anlegen"
          onAbbrechen={() => setAnlegenOffen(false)}
          onAnlegen={addCategory}
          anlegenText="Kategorie anlegen"
          breite={440}
          farbe={adminPrimary}
        >
        <div className="wa-categories-style-3">
          <label className="wa-categories-style-4">📝 Name</label>
          <div className="wa-categories-style-5">
            <input 
              style={{ ...inputStyle, flex: 1, minWidth: 200 }} 
              placeholder="z. B. Siegerehrung" 
              value={newName}
              onChange={e => setNewName(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && addCategory()} 
            />
          </div>
        </div>

        </AnlegenDialog>
      )}

      {categories.length === 0 && <p className="wa-categories-style-7">Keine Kategorien vorhanden.</p>}

      <div className="wa-categories-style-8">
        {categories.map((c, idx) => (
          <div 
            key={c.id} 
            draggable 
            onDragStart={() => (dragItemIndex.current = idx)} 
            onDragEnter={() => (dragOverItemIndex.current = idx)} 
            onDragEnd={handleSort} 
            onDragOver={e => e.preventDefault()}
            style={{ 
              display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e9ecef', 
              borderRadius: 8, padding: 12, background: c.isObsolete ? '#f8f9fa' : '#fff',
              opacity: c.isObsolete ? 0.6 : 1, cursor: 'grab' 
            }}
          >
            <div className="wa-categories-style-9">⋮⋮</div>
            
            {/* onBlur statt onChange: onChange feuert bei einem Color-Picker pro
                Farbschritt und würde dutzende PATCH-Requests auslösen. Der key
                enthält die Farbe, damit der Server-Wert nach dem Refresh greift. */}
            <input
              type="color"
              key={`color-${c.id}-${c.color}`}
              defaultValue={c.color}
              onBlur={e => updateColor(c.id, e.target.value)}
              className="wa-categories-style-10"
              title="Farbe ändern"
            />

            {editingId === c.id ? (
              <input 
                autoFocus 
                style={{ ...inputStyle, flex: 1 }} 
                defaultValue={c.name}
                onBlur={e => { updateName(c.id, e.target.value); setEditingId(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { updateName(c.id, e.currentTarget.value); setEditingId(null); } }}
              />
            ) : (
              <strong className="wa-categories-style-11">{c.name}</strong>
            )}

            <button onClick={() => setEditingId(editingId === c.id ? null : c.id)} style={{ ...btnStyle, background: editingId === c.id ? '#d1e7dd' : '#fff3cd', color: editingId === c.id ? '#0f5132' : '#856404', padding: '4px 8px', minHeight: 32 }} title={editingId === c.id ? "Fertig" : "Bearbeiten"}>{editingId === c.id ? '✓' : '✏️'}</button>

            <label className="wa-categories-style-12">
              <input type="checkbox" checked={c.isObsolete} onChange={() => toggleObsolete(c)} />
              obsolet
            </label>

            <button style={{ ...btnStyle, background: 'transparent', color: '#dc3545', padding: '4px 8px', minHeight: 32 }} onClick={() => removeCategory(c)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
