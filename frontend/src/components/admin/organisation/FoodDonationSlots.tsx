import { useState, useMemo } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFoodDonationSlots, getAllFoodDonations, getYearGroups, getFoodCategories, getFoodItems, apiPost, apiPatch, apiDelete } from '../../../api';
import { btnStyleSecondary, btnStyle, inputStyle, FoodDonationSlot, FoodDonation, YearGroup, FoodItem, FoodCategory, Tournament } from '../shared';
import { useIsMobile } from '../../../hooks/useIsMobile';

export default function FoodDonationSlots({ selectedTournament, tournament, adminPrimary }: { selectedTournament: number | null, tournament: Tournament | null, adminPrimary: string }) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: slots = [] } = useQuery<FoodDonationSlot[]>({
    queryKey: ['foodDonationSlots', selectedTournament],
    queryFn: () => getFoodDonationSlots(selectedTournament),
    enabled: !!selectedTournament
  });

  // Für die Detailansicht "Wer hat gespendet?" je Ziel, sowie für die
  // Sichtbarkeit spontaner Spenden ohne Ziel (freie "Zusätzliche
  // Verpflegung" aus dem Self-Service, die sonst nirgends sichtbar wären).
  const { data: foodDonationsResp } = useQuery<{ donations: FoodDonation[] }>({
    queryKey: ['allFoodDonations', selectedTournament],
    queryFn: () => getAllFoodDonations(selectedTournament),
    enabled: !!selectedTournament
  });
  const foodDonations = foodDonationsResp?.donations || [];
  const unassignedDonations = foodDonations.filter(d => !d.foodDonationSlotId);

  const { data: allYearGroups = [] } = useQuery<YearGroup[]>({ queryKey: ['yearGroups'], queryFn: getYearGroups });

  // Nur Jahrgänge des ausgewählten Turniers anzeigen
  const tournamentYearGroupIds = useMemo(() => {
    if (!tournament?.yearGroups) return new Set<number>();
    return new Set(tournament.yearGroups.map(yg => yg.id));
  }, [tournament]);

  const yearGroups = useMemo(() =>
    allYearGroups.filter(yg => tournamentYearGroupIds.has(yg.id)),
    [allYearGroups, tournamentYearGroupIds]
  );
  const { data: foodCategories = [] } = useQuery<FoodCategory[]>({ queryKey: ['foodCategories'], queryFn: getFoodCategories });
  const { data: foodItems = [] } = useQuery<FoodItem[]>({ queryKey: ['foodItems'], queryFn: getFoodItems });

  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [slotForm, setSlotForm] = useState({ yearGroupIds: [] as number[], categoryId: 0, foodItemId: 0, targetQuantity: 0, description: '' });

  // Ziel-Erstellung: eingeklappt, sobald schon Ziele existieren (dann ist es
  // Alltag, keine Ersteinrichtung mehr) - analog zum Dienstplan.
  const [createExpandedOverride, setCreateExpandedOverride] = useState<boolean | null>(null);
  const createExpanded = createExpandedOverride ?? (slots.length === 0);

  const [filterYear, setFilterYear] = useState('');
  const [filterCategory, setFilterCategory] = useState<number>(0);

  // Für den Detail-Dialog eines angeklickten Matrix-Feldes (wer hat gespendet,
  // plus Bearbeiten/Löschen des Ziels selbst).
  const [selectedSlotDetail, setSelectedSlotDetail] = useState<FoodDonationSlot | null>(null);

  const resetSlotForm = () => setSlotForm({ yearGroupIds: [], categoryId: 0, foodItemId: 0, targetQuantity: 0, description: '' });

  const openEditSlot = (slot: FoodDonationSlot) => {
    setEditingSlotId(slot.id);
    setSlotForm({ yearGroupIds: [slot.yearGroupId || 0], categoryId: slot.foodItem?.categoryId || 0, foodItemId: slot.foodItemId || 0, targetQuantity: slot.targetQuantity, description: slot.description || '' });
    setCreateExpandedOverride(true);
  };

  const saveSlot = async () => {
    if (!selectedTournament || slotForm.yearGroupIds.length === 0) {
      return await modal.alert({ title: 'Hinweis', message: 'Bitte mindestens einen Jahrgang wählen.' });
    }

    if (editingSlotId) {
      await apiPatch(`/api/food-donation-slots/${editingSlotId}`, {
        yearGroupId: slotForm.yearGroupIds[0],
        foodItemId: slotForm.foodItemId || null,
        targetQuantity: slotForm.targetQuantity,
        description: slotForm.description || null
      });
      resetSlotForm();
      setEditingSlotId(null);
    } else {
      for (const yearGroupId of slotForm.yearGroupIds) {
        await apiPost('/api/food-donation-slots', {
          tournamentId: selectedTournament,
          yearGroupId,
          foodItemId: slotForm.foodItemId || null,
          targetQuantity: slotForm.targetQuantity,
          description: slotForm.description || null
        });
      }
      // Reset only item and description to keep categories, years and targetQuantity selected
      setSlotForm(prev => ({
        ...prev,
        foodItemId: 0,
        description: ''
      }));
    }
    queryClient.invalidateQueries({ queryKey: ['foodDonationSlots', selectedTournament] });
  };

  const deleteSlot = async (id: number) => {
    if (!(await modal.confirm({ title: 'Ziel löschen', message: 'Möchtest du dieses Verpflegungs-Ziel wirklich löschen?', variant: 'danger' }))) return;
    await apiDelete(`/api/food-donation-slots/${id}`);
    queryClient.invalidateQueries({ queryKey: ['foodDonationSlots', selectedTournament] });
  };

  const deleteDonation = async (donationId: number, quantity: number) => {
    if (!(await modal.confirm({ title: 'Spende löschen', message: 'Möchtest du diese Spende wirklich löschen?', variant: 'danger' }))) return;
    await apiDelete(`/api/food/donations/${donationId}`);
    queryClient.invalidateQueries({ queryKey: ['foodDonationSlots', selectedTournament] });
    queryClient.invalidateQueries({ queryKey: ['allFoodDonations', selectedTournament] });

    if (selectedSlotDetail) {
      setSelectedSlotDetail(prev => prev ? {
        ...prev,
        collected: Math.max(0, prev.collected - quantity)
      } : null);
    }
  };

  if (!selectedTournament) {
    return <div style={{ padding: 24, background: '#fff', borderRadius: 16 }}>Bitte wähle zunächst oben ein Turnier aus.</div>;
  }

  const filteredItems = slotForm.categoryId
    ? foodItems.filter(item => item.categoryId === slotForm.categoryId)
    : [];

  const toggleYearGroup = (yg: number) => {
    if (editingSlotId) { setSlotForm({ ...slotForm, yearGroupIds: [yg] }); return; }
    setSlotForm(prev => ({
      ...prev,
      yearGroupIds: prev.yearGroupIds.includes(yg) ? prev.yearGroupIds.filter(x => x !== yg) : [...prev.yearGroupIds, yg]
    }));
  };

  const yearGroupKey = (yg: FoodDonationSlot['yearGroup']) => yg?.id ?? -1;
  const itemKey = (item: FoodDonationSlot['foodItem']) => item?.id ?? -1;

  const yearGroupsMap = new Map<number, { id: number; name: string }>();
  const itemsMap = new Map<number, { id: number; name: string; icon: string; unit: string }>();
  for (const slot of slots) {
    yearGroupsMap.set(yearGroupKey(slot.yearGroup), { id: yearGroupKey(slot.yearGroup), name: slot.yearGroup?.name || 'Ohne Jahrgang' });
    itemsMap.set(itemKey(slot.foodItem), { id: itemKey(slot.foodItem), name: slot.foodItem?.name || 'Alle Artikel', icon: slot.foodItem?.category?.icon || '🍽️', unit: slot.foodItem?.unit || 'Stk' });
  }
  const allRows = [...yearGroupsMap.values()].sort((a, b) => a.id === -1 ? 1 : b.id === -1 ? -1 : a.name.localeCompare(b.name));
  const rows = filterYear ? allRows.filter(r => String(r.id) === filterYear) : allRows;
  const cols = [...itemsMap.values()].sort((a, b) => a.id === -1 ? 1 : b.id === -1 ? -1 : a.name.localeCompare(b.name));
  const slotAt = (ygId: number, itId: number) => slots.find(s => yearGroupKey(s.yearGroup) === ygId && itemKey(s.foodItem) === itId);

  const rowTotal = (ygId: number) => {
    let target = 0, collected = 0;
    for (const col of cols) {
      const slot = slotAt(ygId, col.id);
      if (slot) { target += slot.targetQuantity; collected += slot.collected; }
    }
    return { target, collected };
  };

  const formContent = (
    <div style={{ background: '#f8f9fa', padding: 20, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>1. Jahrgang(e) {editingSlotId ? '(Nur einer)' : '(Mehrfachauswahl)'}</label>
          <p style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>{yearGroups.length} von {allYearGroups.length} Jahrgängen (Turnier-Jahrgänge)</p>
          {yearGroups.length === 0 && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '12px 16px', marginBottom: 12, color: '#856404', fontSize: 14 }}>
              ⚠️ <strong>Keine Jahrgänge definiert!</strong><br />
              Gehe zu <em>Stammdaten</em> → <em>Turniere</em>, bearbeite das Turnier und füge dort die Jahrgänge hinzu.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {yearGroups.filter(yg => yg.isActive).map(yg => {
              const isSelected = slotForm.yearGroupIds.includes(yg.id);
              return (
                <button key={yg.id} type="button" onClick={() => toggleYearGroup(yg.id)} style={{ padding: '8px 14px', background: isSelected ? adminPrimary : '#fff', color: isSelected ? '#fff' : '#000', border: isSelected ? 'none' : '1px solid #dee2e6', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: isSelected ? 'bold' : 'normal' }}>
                  {yg.name} ({yg.birthYearStart}–{yg.birthYearEnd})
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>2. Kategorie</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setSlotForm({ ...slotForm, categoryId: 0, foodItemId: 0 })} style={{ ...btnStyle, background: slotForm.categoryId === 0 ? adminPrimary : '#fff', color: slotForm.categoryId === 0 ? '#fff' : '#000', border: slotForm.categoryId === 0 ? 'none' : '1px solid #dee2e6' }}>
              -- Alle Kategorien --
            </button>
            {foodCategories.map(cat => (
              <button key={cat.id} onClick={() => setSlotForm({ ...slotForm, categoryId: cat.id, foodItemId: 0 })} style={{ ...btnStyle, background: slotForm.categoryId === cat.id ? adminPrimary : '#fff', color: slotForm.categoryId === cat.id ? '#fff' : '#000', border: slotForm.categoryId === cat.id ? 'none' : '1px solid #dee2e6' }}>
                {cat.icon} {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>3. Artikel</label>
          <select value={slotForm.foodItemId} onChange={e => setSlotForm({ ...slotForm, foodItemId: parseInt(e.target.value) || 0 })} style={inputStyle}>
            <option value={0}>-- Artikel wählen --</option>
            {filteredItems.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>4. Soll-Menge</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="mobile-touch-stepper">
              <button
                type="button"
                className="mobile-stepper-btn"
                onClick={() => setSlotForm(prev => ({ ...prev, targetQuantity: Math.max(0, prev.targetQuantity - 1) }))}
              >
                –
              </button>
              <input
                type="number"
                value={slotForm.targetQuantity}
                onChange={e => setSlotForm({ ...slotForm, targetQuantity: Math.max(0, parseInt(e.target.value) || 0) })}
                className="mobile-stepper-value"
              />
              <button
                type="button"
                className="mobile-stepper-btn"
                onClick={() => setSlotForm(prev => ({ ...prev, targetQuantity: prev.targetQuantity + 1 }))}
              >
                +
              </button>
            </div>
            <span style={{ color: '#666', fontSize: 14, fontWeight: 600 }}>
              {filteredItems.find(i => i.id === slotForm.foodItemId)?.unit || 'Stk'}
            </span>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>5. Optionale Beschreibung</label>
          <input value={slotForm.description} onChange={e => setSlotForm({ ...slotForm, description: e.target.value })} placeholder="Besondere Hinweise..." style={{ ...inputStyle, width: '100%', maxWidth: 500 }} />
        </div>

        <div style={{ marginTop: 10 }}>
          <button onClick={saveSlot} style={{ padding: '10px 24px', background: adminPrimary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            {editingSlotId ? '💾 Ziel speichern' : `➕ ${slotForm.yearGroupIds.length} Ziel${slotForm.yearGroupIds.length === 1 ? '' : 'e'} erstellen`}
          </button>
          {editingSlotId && (
            <button onClick={() => { setEditingSlotId(null); resetSlotForm(); }} style={{ ...btnStyleSecondary, marginLeft: 10, padding: '10px 20px' }}>Abbrechen</button>
          )}
        </div>
    </div>
  );

  return (
    <div style={{ background: '#fff', padding: isMobile ? 16 : 24, borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
      <div style={{ marginBottom: 24, border: '1px solid #e9ecef', borderRadius: 12, overflow: 'hidden' }}>
        <button
          onClick={() => setCreateExpandedOverride(!createExpanded)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#f8f9fa', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: '#212557' }}>🍰 Verpflegungsziele erstellen</span>
          <span style={{ fontSize: 13, color: '#6c757d', display: isMobile ? 'none' : 'inline' }}>Welche Jahrgänge sollen welche Verpflegung beitragen?</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 18, color: '#6c757d', transition: 'transform 0.2s', display: 'inline-block', transform: createExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
        </button>

        {createExpanded && (
          <div style={{ padding: isMobile ? 12 : 20 }}>
            <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>Lege hier fest, welche Jahrgänge während des gesamten Turniers welche Verpflegung beitragen sollen.</p>
            {!editingSlotId && formContent}
          </div>
        )}
      </div>

      {editingSlotId && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}>
          <div style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: '100%', maxWidth: isMobile ? undefined : 560, maxHeight: isMobile ? '92vh' : '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e9ecef', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8f9fa' }}>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#212529' }}>✏️ Ziel bearbeiten</div>
              <button onClick={() => { setEditingSlotId(null); resetSlotForm(); }} style={{ border: 'none', background: 'transparent', fontSize: 24, lineHeight: 1, cursor: 'pointer', color: '#adb5bd' }}>×</button>
            </div>
            <div style={{ padding: 20 }}>{formContent}</div>
          </div>
        </div>
      )}

      <h4 style={{ fontSize: 16, marginBottom: 12, color: '#212529' }}>Übersicht ({slots.length} Ziele)</h4>

      <div className="mobile-filter-pills-bar">
        <button
          type="button"
          onClick={() => setFilterCategory(0)}
          className={`mobile-pill ${filterCategory === 0 ? 'mobile-pill-active' : ''}`}
        >
          🍽️ Alle Kategorien
        </button>
        {foodCategories.map(cat => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setFilterCategory(cat.id)}
            className={`mobile-pill ${filterCategory === cat.id ? 'mobile-pill-active' : ''}`}
          >
            {cat.icon} {cat.name}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }}>
          <option value="">-- Alle Jahrgänge --</option>
          {yearGroups.map(yg => <option key={yg.id} value={yg.id}>{yg.name}</option>)}
          {allRows.some(r => r.id === -1) && <option value="-1">Ohne Jahrgang</option>}
        </select>
      </div>

      {slots.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#6c757d', padding: 20, lineHeight: 1.6, fontSize: 14 }}>Noch keine Verpflegungs-Ziele angelegt.<br /><span style={{ fontSize: 13 }}>Lege je Jahrgang fest, welcher Artikel in welcher Menge gebraucht wird – die Eltern sehen im Self-Service nur die Ziele ihres eigenen Jahrgangs und sagen dort zu.</span></div>
      ) : isMobile ? (
        <div className="mobile-food-cards-list">
          {slots
            .filter(s => !filterCategory || s.foodItem?.categoryId === filterCategory)
            .filter(s => !filterYear || (filterYear === '-1' ? !s.yearGroupId : String(s.yearGroupId) === filterYear))
            .map(slot => {
              const isDone = slot.collected >= slot.targetQuantity;
              const progress = slot.targetQuantity > 0 ? Math.min(100, Math.round((slot.collected / slot.targetQuantity) * 100)) : 0;
              const slotDonationCount = foodDonations.filter(d => d.foodDonationSlotId === slot.id).length;
              return (
                <div key={slot.id} className="mobile-food-card" onClick={() => setSelectedSlotDetail(slot)}>
                  <div className="mobile-food-card-header">
                    <div className="mobile-food-card-title">
                      {slot.foodItem?.category?.icon ?? '🍽️'} {slot.foodItem?.name || 'Unbekannt'}
                    </div>
                    <span className="mobile-food-card-year">
                      {slot.yearGroup?.name || 'Ohne Jahrgang'}
                    </span>
                  </div>
                  {slot.description && (
                    <div style={{ fontSize: 12, color: '#6c757d', fontStyle: 'italic', marginBottom: 6 }}>
                      {slot.description}
                    </div>
                  )}
                  <div className="mobile-progress-container">
                    <div className="mobile-progress-track">
                      <div
                        className="mobile-progress-fill"
                        style={{
                          width: `${progress}%`,
                          background: isDone ? '#198754' : progress > 0 ? '#ffc107' : '#adb5bd'
                        }}
                      />
                    </div>
                    <div className="mobile-progress-text">
                      <span>{slot.collected} von {slot.targetQuantity} {slot.foodItem?.unit || 'Stk'}</span>
                      <span>{progress}%</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e9ecef', fontSize: 12 }}>
                    <span style={{ color: '#6c757d' }}>💬 {slotDonationCount} Spenden</span>
                    <span style={{ color: adminPrimary, fontWeight: 'bold' }}>Details & Spender ›</span>
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 15 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%', minWidth: 500 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: '#fff', textAlign: 'left', padding: '12px 16px 12px 0', borderBottom: '2px solid #dee2e6', verticalAlign: 'bottom', zIndex: 1 }}>Jahrgang</th>
                {cols.filter(c => !filterCategory || foodItems.find(i => i.id === c.id)?.categoryId === filterCategory).map(col => (
                  <th key={col.id} style={{ height: 140, minWidth: 80, padding: 0, borderBottom: '2px solid #dee2e6', verticalAlign: 'bottom', overflow: 'visible', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', height: '100%', overflow: 'visible' }}>
                      <div style={{ 
                        transform: 'rotate(-60deg)', 
                        transformOrigin: 'bottom left', 
                        whiteSpace: 'nowrap', 
                        fontWeight: 600, 
                        color: '#495057',
                        position: 'absolute',
                        bottom: 8,
                        left: 20,
                        fontSize: 12,
                        paddingBottom: 4
                      }}>
                        {col.icon} {col.name}
                      </div>
                    </div>
                  </th>
                ))}
                <th style={{ minWidth: 100, padding: '12px 16px', borderBottom: '2px solid #dee2e6', borderLeft: '2px solid #dee2e6', verticalAlign: 'bottom', textAlign: 'center', fontWeight: 700, color: '#495057' }}>Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const total = rowTotal(row.id);
                const progress = total.target > 0 ? Math.min(100, (total.collected / total.target) * 100) : 0;
                return (
                <tr key={row.id}>
                  <td style={{ position: 'sticky', left: 0, background: '#fff', fontWeight: 600, padding: '12px 16px 12px 0', borderBottom: '1px solid #dee2e6', whiteSpace: 'nowrap', zIndex: 1 }}>{row.name}</td>
                  {cols.filter(c => !filterCategory || foodItems.find(i => i.id === c.id)?.categoryId === filterCategory).map(col => {
                    const slot = slotAt(row.id, col.id);
                    if (!slot) return <td key={col.id} style={{ textAlign: 'center', color: '#dee2e6', borderBottom: '1px solid #dee2e6', borderRight: '1px solid #f0f0f0', padding: '8px 4px' }}>–</td>;
                    const isDone = slot.collected >= slot.targetQuantity;
                    const hasProgress = slot.collected > 0;
                    return (
                      <td key={col.id} style={{ textAlign: 'center', borderBottom: '1px solid #dee2e6', borderRight: '1px solid #f0f0f0', padding: '8px 4px' }}>
                        <button
                          onClick={() => setSelectedSlotDetail(slot)}
                          title={`${row.name} – ${col.icon} ${col.name}: ${slot.collected}/${slot.targetQuantity} ${col.unit}`}
                          style={{
                            width: '100%', maxWidth: 52, height: 28, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                            background: isDone ? '#d1e7dd' : hasProgress ? '#fff3cd' : '#f8d7da',
                            color: isDone ? '#0f5132' : hasProgress ? '#664d03' : '#842029',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                            transition: 'transform 0.1s, box-shadow 0.1s'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = 'scale(1.05)';
                            e.currentTarget.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = 'none';
                            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                          }}
                        >
                          {slot.collected}/{slot.targetQuantity}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{ borderBottom: '1px solid #dee2e6', borderLeft: '2px solid #dee2e6', padding: '12px 16px', textAlign: 'center', background: '#f8f9fa' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: progress >= 100 ? '#198754' : progress > 0 ? '#664d03' : '#842029' }}>
                      {total.collected}/{total.target}
                    </div>
                    <div style={{ background: '#e9ecef', borderRadius: 4, height: 6, overflow: 'hidden', marginTop: 5, width: 80, marginLeft: 'auto', marginRight: 'auto' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: progress >= 100 ? '#198754' : '#ffc107', borderRadius: 4 }} />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unassignedDonations.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h5 style={{ fontSize: 14, color: '#212529', marginBottom: 10 }}>🎁 Zusätzliche Spenden (ohne Ziel)</h5>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unassignedDonations.filter(d => d.userId != null).map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8f9fa', borderRadius: 8, border: '1px solid #e9ecef', fontSize: 13, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{d.user?.name || 'Unbekannt'}</strong>: {d.foodItem?.category?.icon ?? '🍽️'} {d.foodItem?.name} × {d.quantity} {d.foodItem?.unit || 'Stk'}
                  {d.note && <span style={{ color: '#6c757d' }}> – "{d.note}"</span>}
                </div>
                <span style={{ color: '#adb5bd' }}>{new Date(d.createdAt).toLocaleDateString('de-DE')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSlotDetail && (
        <div
          className={isMobile ? 'mobile-bottom-sheet-overlay' : ''}
          style={!isMobile ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 } : undefined}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedSlotDetail(null); }}
        >
          <div
            className={isMobile ? 'mobile-bottom-sheet-content' : ''}
            style={!isMobile ? { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' } : undefined}
          >
            {isMobile && <div className="mobile-bottom-sheet-handle" />}
            
            {/* Schlanker, kompakter Header im Self-Service Style */}
            <div style={{ padding: isMobile ? '4px 20px 16px' : '16px 20px 16px', borderBottom: '1px solid #e9ecef', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#212529', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{selectedSlotDetail.foodItem?.category?.icon ?? '🍽️'}</span>
                  <span>{selectedSlotDetail.foodItem?.name || 'Alle Artikel'}</span>
                </div>
                <div style={{ fontSize: 13, color: '#6c757d', marginTop: 4, fontWeight: 500 }}>
                  {selectedSlotDetail.yearGroup?.name || 'Ohne Jahrgang'} · {selectedSlotDetail.collected}/{selectedSlotDetail.targetQuantity} {selectedSlotDetail.foodItem?.unit || 'Stk'}
                  {selectedSlotDetail.description && <span style={{ marginLeft: 6, fontStyle: 'italic', color: '#495057' }}>({selectedSlotDetail.description})</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSlotDetail(null)}
                style={{ border: 'none', background: '#f8f9fa', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', color: '#6c757d', flexShrink: 0 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: isMobile ? 'calc(85vh - 140px)' : '60vh' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: '#212529' }}>Spenden für dieses Ziel</h4>
              {(() => {
                const slotDonations = foodDonations.filter(d => d.foodDonationSlotId === selectedSlotDetail.id);
                if (slotDonations.length === 0) return <div style={{ color: '#adb5bd', fontStyle: 'italic', fontSize: 13 }}>Noch keine Spenden für dieses Ziel.</div>;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {slotDonations.map(d => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8f9fa', borderRadius: 8, border: '1px solid #e9ecef' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#0d6efd', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 14 }}>
                            {d.user?.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div>
                            <div style={{ fontWeight: '600', color: '#212529', fontSize: 14 }}>{d.userId != null ? (d.user?.name || 'Unbekannt') : ''}</div>
                            {d.note && <div style={{ fontSize: 12, color: '#6c757d', marginTop: 2 }}>„{d.note}"</div>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ fontWeight: 600, color: '#212529', fontSize: 14 }}>{d.quantity} <span style={{ color: '#6c757d', fontSize: 12, fontWeight: 'normal' }}>{selectedSlotDetail.foodItem?.unit || 'Stk'}</span></div>
                          <button
                            type="button"
                            onClick={() => deleteDonation(d.id, d.quantity)}
                            style={{
                              border: 'none',
                              background: '#ffe3e3',
                              color: '#dc3545',
                              borderRadius: 6,
                              width: 28,
                              height: 28,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              fontSize: 14
                            }}
                            title="Spende löschen"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div style={{ padding: isMobile ? '12px 20px 24px' : '16px 20px', borderTop: '1px solid #e9ecef', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { const slot = selectedSlotDetail; setSelectedSlotDetail(null); openEditSlot(slot); }}
                  style={{ ...btnStyleSecondary, color: '#856404', borderColor: '#ffeeba', background: '#fff3cd', padding: '8px 12px', fontSize: 13, fontWeight: 600 }}
                >
                  ✏️ Bearbeiten
                </button>
                <button
                  type="button"
                  onClick={async () => { const id = selectedSlotDetail.id; setSelectedSlotDetail(null); await deleteSlot(id); }}
                  style={{ ...btnStyleSecondary, color: '#dc3545', borderColor: '#f5c6cb', background: '#f8d7da', padding: '8px 12px', fontSize: 13, fontWeight: 600 }}
                >
                  🗑️ Löschen
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSlotDetail(null)}
                style={{ ...btnStyle, background: '#6c757d', color: '#fff', border: 'none', padding: '8px 16px', fontSize: 13, fontWeight: 600 }}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
