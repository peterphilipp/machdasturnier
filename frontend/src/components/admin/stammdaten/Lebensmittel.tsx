import { useState } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFoodCategories, getFoodItems, apiPost, apiPatch, apiDelete } from '../../../api';
import { btnStyleSecondary, useSortableData, confirmWithImpact } from '../shared';
import type { FoodCategory, FoodItem } from '../shared';
import EditModal from '../EditModal';
import { StammdatenKopf, AnlegenDialog } from '../Stammdatenseite';

const EMOJI_PICKER = ['🍞', '🥖', '🧀', '🥩', '🐟', '🥚', '🥛', '🍰', '🎂', '🍪', '🍫', '☕', '🍵', '🧃', '🍺', '🥤', '🍎', '🍌', '🥬', '🥕', '🍅', '🧅', '🥔', '🌽', '🍄', '🫒', '🧈', '🍯', '🧂', '🥜'];
const FOOD_UNITS = ['Stk', 'Portion', 'Packung', 'kg', 'Liter', 'Tüte', 'Set'];

interface LebensmittelProps {
  adminPrimary: string;
}

export default function Lebensmittel({ adminPrimary }: LebensmittelProps) {
  const queryClient = useQueryClient();
  
  // Kategorien state
  const [editingFoodCat, setEditingFoodCat] = useState<number | null>(null);
  const [foodCatForm, setFoodCatForm] = useState({ name: '', icon: '🍽️', order: 0 });
  const [katAnlegenOffen, setKatAnlegenOffen] = useState(false);
  const [artikelAnlegenOffen, setArtikelAnlegenOffen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Artikel state
  const [editingFoodItem, setEditingFoodItem] = useState<number | null>(null);
  const [foodItemForm, setFoodItemForm] = useState({ categoryId: 0, name: '', price: '', unit: 'Stk' });

  const { data: foodCategories = [] } = useQuery<FoodCategory[]>({ queryKey: ['foodCategories'], queryFn: getFoodCategories });
  const { data: foodItems = [] } = useQuery<FoodItem[]>({ queryKey: ['foodItems'], queryFn: getFoodItems });

  const { items: sortedCategories, requestSort: sortCat, getSortIndicator: getCatInd } = useSortableData(foodCategories, { key: 'order', direction: 'asc' });
  const { items: sortedItems, requestSort: sortItem, getSortIndicator: getItemInd } = useSortableData(foodItems, { key: 'name', direction: 'asc' });

  // Kategorien actions
  //
  // Verpflegungs-Slots (FoodDonationSlots.tsx) laden Kategorie/Artikel nicht
  // separat, sondern eingebettet in ihre eigene foodDonationSlots-Abfrage
  // (include: { foodItem: { include: { category: true } } }) - ein reines
  // invalidateQueries(['foodItems']/['foodCategories']) aktualisiert nur die
  // Listen hier auf dieser Seite. Ohne die zusätzliche Invalidierung unten
  // blieb ein umbenannter Artikel/eine umbenannte Kategorie dort so lange
  // beim alten Namen, bis die Seite neu geladen wurde.
  const saveFoodCategory = async () => {
    if (!foodCatForm.name.trim()) return await modal.alert({ title: 'Hinweis', message: 'Name erforderlich!' });
    if (editingFoodCat) { await apiPatch(`/api/food/categories/${editingFoodCat}`, foodCatForm); }
    else { await apiPost('/api/food/categories', foodCatForm); }
    queryClient.invalidateQueries({ queryKey: ['foodCategories'] });
    queryClient.invalidateQueries({ queryKey: ['foodDonationSlots'] });
    setFoodCatForm({ name: '', icon: '🍽️', order: 0 });
    setEditingFoodCat(null);
    setKatAnlegenOffen(false);
  };

  const deleteFoodCategory = async (cat: FoodCategory) => {
    if (!(await confirmWithImpact('foodCategory', cat.id, cat.name))) return;
    await apiDelete(`/api/food/categories/${cat.id}`);
    queryClient.invalidateQueries({ queryKey: ['foodCategories'] });
    queryClient.invalidateQueries({ queryKey: ['foodItems'] });
    queryClient.invalidateQueries({ queryKey: ['foodDonationSlots'] });
  };

  // Artikel actions
  const saveFoodItem = async () => {
    if (!foodItemForm.name.trim()) return await modal.alert({ title: 'Hinweis', message: 'Name erforderlich!' });
    if (foodItemForm.categoryId === 0) return await modal.alert({ title: 'Hinweis', message: 'Kategorie wählen!' });
    try {
      if (editingFoodItem) { await apiPatch(`/api/food/items/${editingFoodItem}`, foodItemForm); }
      else { await apiPost('/api/food/items', foodItemForm); }
      queryClient.invalidateQueries({ queryKey: ['foodItems'] });
      queryClient.invalidateQueries({ queryKey: ['foodDonationSlots'] });
      setFoodItemForm({ categoryId: 0, name: '', price: '', unit: 'Stk' });
      setEditingFoodItem(null);
      setArtikelAnlegenOffen(false);
    } catch (err) { await modal.alert({ title: 'Fehler', message: `Speichern fehlgeschlagen: ${(err as Error).message}` }); }
  };

  const deleteFoodItem = async (item: FoodItem) => {
    if (!(await confirmWithImpact('foodItem', item.id, item.name))) return;
    await apiDelete(`/api/food/items/${item.id}`);
    queryClient.invalidateQueries({ queryKey: ['foodItems'] });
    queryClient.invalidateQueries({ queryKey: ['foodDonationSlots'] });
  };

  const selectEmoji = (emoji: string) => { setFoodCatForm(f => ({ ...f, icon: emoji })); setShowEmojiPicker(false); };

  // Open/close handlers
  const openEditCat = (cat: FoodCategory) => { setEditingFoodCat(cat.id); setFoodCatForm({ name: cat.name, icon: cat.icon, order: cat.order }); setShowEmojiPicker(false); };
  const closeEditCat = () => { setEditingFoodCat(null); setFoodCatForm({ name: '', icon: '🍽️', order: 0 }); setShowEmojiPicker(false); };

  const openEditItem = (item: FoodItem) => { setEditingFoodItem(item.id); setFoodItemForm({ categoryId: item.categoryId, name: item.name, price: item.price || '', unit: item.unit }); };
  const closeEditItem = () => { setEditingFoodItem(null); setFoodItemForm({ categoryId: 0, name: '', price: '', unit: 'Stk' }); };

  return (
    <div className="lebensmittel-container">
      {/* Kategorien */}
      <div className="lebensmittel-card">
        <StammdatenKopf
          titel="📂 Kategorien"
          untertitel="Gruppieren die Artikel – z.B. Getränke, Kuchen, Grillgut."
          neuText="Neue Kategorie"
          onNeu={() => setKatAnlegenOffen(true)}
          farbe={adminPrimary}
        />
        
        {katAnlegenOffen && (
          <AnlegenDialog
            titel="📂 Neue Kategorie anlegen"
            onAbbrechen={() => setKatAnlegenOffen(false)}
            onAnlegen={saveFoodCategory}
            anlegenText="Kategorie anlegen"
            breite={460}
            farbe={adminPrimary}
          >
          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div className="lebensmittel-emoji-picker-container">
              {EMOJI_PICKER.map(emoji => (<button key={emoji} onClick={() => selectEmoji(emoji)} className={`lebensmittel-emoji-btn ${foodCatForm.icon === emoji ? 'lebensmittel-emoji-btn-active' : ''}`}>{emoji}</button>))}
            </div>
          )}

          {/* Kategorie Neu hinzufügen */}
          <div className="lebensmittel-form-row">
            <div className="lebensmittel-form-group-flex2">
              <label className="lebensmittel-form-label">📝 Name</label>
              <input value={foodCatForm.name} onChange={e => setFoodCatForm(f => ({ ...f, name: e.target.value }))} placeholder="z.B. Getränke" className="lebensmittel-form-input" />
            </div>
            <div className="lebensmittel-form-group-w70">
              <label className="lebensmittel-form-label">😀 Icon</label>
              <div onClick={() => setShowEmojiPicker(!showEmojiPicker)} className={`lebensmittel-emoji-toggle ${showEmojiPicker ? 'lebensmittel-emoji-toggle-active' : ''}`} title="Emoji auswählen">{foodCatForm.icon}</div>
            </div>
          </div>

          </AnlegenDialog>
        )}

        <div className="admin-table-scroll">
        <table className="lebensmittel-table admin-cards-mobile">
          <thead><tr className="lebensmittel-table-header-row"><th className="lebensmittel-th-left">Icon</th><th onClick={() => sortCat('name')} className="lebensmittel-th-left-pointer">Name{getCatInd('name')}</th><th className="lebensmittel-th-right">Artikel</th><th className="lebensmittel-th-left">Aktion</th></tr></thead>
          <tbody>
            {sortedCategories.map(cat => (
              <tr key={cat.id} className="lebensmittel-tr">
                <td data-label="Icon" className="lebensmittel-td-icon">{cat.icon}</td>
                <td data-label="Name" className="lebensmittel-td-bold">{cat.name}</td>
                <td data-label="Artikel" className="lebensmittel-td-right-gray">{cat.items?.length || 0}</td>
                <td className="lebensmittel-td-actions">
                  <div className="lebensmittel-actions-container">
                    <button onClick={() => openEditCat(cat)} className="lebensmittel-btn-edit">✏️</button>
                    <button onClick={() => deleteFoodCategory(cat)} className="lebensmittel-btn-delete">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* Kategorie Edit Modal */}
        {editingFoodCat && (
          <div className="lebensmittel-modal-overlay">
            <div className="lebensmittel-modal-content">
              <div className="lebensmittel-modal-header">
                <h3 className="lebensmittel-modal-title">✏️ Kategorie bearbeiten</h3>
                <button onClick={closeEditCat} className="lebensmittel-modal-close">×</button>
              </div>
              {/* Scrollbarer Inhalt */}
              <div className="lebensmittel-modal-body">
                <div className="lebensmittel-modal-form">
                  <div>
                    <label className="lebensmittel-form-label">📝 Name</label>
                    <input value={foodCatForm.name} onChange={e => setFoodCatForm(f => ({ ...f, name: e.target.value }))} placeholder="z.B. Getränke" className="lebensmittel-modal-input" />
                  </div>
              <div>
                <label className="lebensmittel-form-label">😀 Icon</label>
                <div className="lebensmittel-modal-emoji-container">
                  {EMOJI_PICKER.map(emoji => (<button key={emoji} onClick={() => setFoodCatForm(f => ({ ...f, icon: emoji }))} className={`lebensmittel-modal-emoji-btn ${foodCatForm.icon === emoji ? 'lebensmittel-modal-emoji-btn-active' : ''}`}>{emoji}</button>))}
                </div>
              </div>
              {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
              <div className="lebensmittel-modal-footer">
                <button onClick={closeEditCat} style={btnStyleSecondary} className="lebensmittel-btn-cancel">Abbrechen</button>
                <button onClick={saveFoodCategory} className="lebensmittel-btn-save" style={{ background: adminPrimary }}>💾 Speichern</button>
              </div>
            </div>
          </div>
        </div>
      </div>
        )}
      </div>

      {/* Artikel */}
      <div className="lebensmittel-card">
        <StammdatenKopf
          titel="📦 Artikel"
          untertitel="Die einzelnen Spenden-Artikel mit Preis und Einheit."
          neuText="Neuer Artikel"
          onNeu={() => setArtikelAnlegenOffen(true)}
          farbe={adminPrimary}
        />
        
        {artikelAnlegenOffen && (
          <AnlegenDialog
            titel="📦 Neuen Artikel anlegen"
            onAbbrechen={() => setArtikelAnlegenOffen(false)}
            onAnlegen={saveFoodItem}
            anlegenText="Artikel anlegen"
            breite={520}
            farbe={adminPrimary}
          >
          <div className="lebensmittel-form-row">
            <div className="lebensmittel-form-group-flex2">
              <label className="lebensmittel-form-label">📝 Name</label>
              <input value={foodItemForm.name} onChange={e => setFoodItemForm(f => ({ ...f, name: e.target.value }))} placeholder="z.B. Wasser" className="lebensmittel-form-input-p12" />
            </div>
            <div className="lebensmittel-form-group-flex1">
              <label className="lebensmittel-form-label">📂 Kategorie</label>
              <select value={foodItemForm.categoryId} onChange={e => setFoodItemForm(f => ({ ...f, categoryId: parseInt(e.target.value) }))} className="lebensmittel-form-input-p12">
                <option value={0}>-- Kategorie --</option>
                {foodCategories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div className="lebensmittel-form-group-w90">
              <label className="lebensmittel-form-label">💰 Preis</label>
              <input value={foodItemForm.price} onChange={e => setFoodItemForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" type="number" step="0.01" className="lebensmittel-form-input-p8" />
            </div>
            <div className="lebensmittel-form-group-w100">
              <label className="lebensmittel-form-label">📏 Einheit</label>
              <select value={foodItemForm.unit} onChange={e => setFoodItemForm(f => ({ ...f, unit: e.target.value }))} className="lebensmittel-form-input-p8">
                {FOOD_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>


          </AnlegenDialog>
        )}

        <div className="admin-table-scroll">
        <table className="lebensmittel-table admin-cards-mobile">
          <thead><tr className="lebensmittel-table-header-row"><th onClick={() => sortItem('name')} className="lebensmittel-th-left-pointer">Name{getItemInd('name')}</th><th onClick={() => sortItem('categoryName')} className="lebensmittel-th-left-pointer">Kategorie{getItemInd('categoryName')}</th><th onClick={() => sortItem('price')} className="lebensmittel-th-right-pointer">Preis{getItemInd('price')}</th><th onClick={() => sortItem('unit')} className="lebensmittel-th-left-pointer">Einheit{getItemInd('unit')}</th><th className="lebensmittel-th-left">Aktion</th></tr></thead>
          <tbody>
            {sortedItems.map(item => (
              <tr key={item.id} className="lebensmittel-tr">
                <td data-label="Name" className="lebensmittel-td-bold">{item.name}</td>
                <td data-label="Kategorie" className="lebensmittel-td-gray">{item.category?.icon} {item.category?.name || '–'}</td>
                <td data-label="Preis" className="lebensmittel-td-right" style={{ color: item.price ? '#2e7d32' : '#adb5bd' }}>{item.price ? `${item.price} €` : '–'}</td>
                <td data-label="Einheit" className="lebensmittel-th-left" style={{ fontWeight: 'normal' }}>{item.unit}</td>
                <td className="lebensmittel-td-actions">
                  <div className="lebensmittel-actions-container">
                    <button onClick={() => openEditItem(item)} className="lebensmittel-btn-edit">✏️</button>
                    <button onClick={() => deleteFoodItem(item)} className="lebensmittel-btn-delete">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* Artikel Edit Modal */}
        {editingFoodItem && (
          <div className="lebensmittel-modal-overlay">
            <div className="lebensmittel-modal-content">
              <div className="lebensmittel-modal-header">
                <h3 className="lebensmittel-modal-title">✏️ Artikel bearbeiten</h3>
                <button onClick={closeEditItem} className="lebensmittel-modal-close">×</button>
              </div>
              {/* Scrollbarer Inhalt */}
              <div className="lebensmittel-modal-body">
                <div className="lebensmittel-modal-form">
                  <div>
                    <label className="lebensmittel-form-label">📂 Kategorie</label>
                    <select value={foodItemForm.categoryId} onChange={e => setFoodItemForm(f => ({ ...f, categoryId: parseInt(e.target.value) }))} className="lebensmittel-modal-input-p12">
                      <option value={0}>-- Kategorie --</option>
                      {foodCategories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="lebensmittel-form-label">📝 Name</label>
                    <input value={foodItemForm.name} onChange={e => setFoodItemForm(f => ({ ...f, name: e.target.value }))} placeholder="z.B. Wasser" className="lebensmittel-modal-input-p12" />
                  </div>
              <div>
                <label className="lebensmittel-form-label">💰 Preis & 📏 Einheit</label>
                <div className="lebensmittel-grid-2">
                  <input value={foodItemForm.price} onChange={e => setFoodItemForm(f => ({ ...f, price: e.target.value }))} placeholder="Preis" type="number" step="0.01" className="lebensmittel-modal-input-grid" />
                  <select value={foodItemForm.unit} onChange={e => setFoodItemForm(f => ({ ...f, unit: e.target.value }))} className="lebensmittel-modal-input-grid">
                    {FOOD_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
            <div className="lebensmittel-modal-footer">
              <button onClick={closeEditItem} style={btnStyleSecondary} className="lebensmittel-btn-cancel">Abbrechen</button>
              <button onClick={saveFoodItem} className="lebensmittel-btn-save" style={{ background: adminPrimary }}>💾 Speichern</button>
            </div>
          </div>
        </div>
      </div>
        )}
      </div>
    </div>
  );
}
