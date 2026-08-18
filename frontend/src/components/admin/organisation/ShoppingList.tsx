import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IScannerControls } from '@zxing/browser';
import {
  getShoppingList, addShoppingListItem, updateShoppingListItem, deleteShoppingListItem,
  copyShoppingListFrom, lookupShoppingBarcode, createShoppingCatalogItem,
  getFoodCategories, linkFoodCategoryToCatalogItem
} from '../../../api';
import { Tournament } from '../shared';
import { modal } from '../Modal';

interface FoodCategory {
  id: number;
  name: string;
  icon: string;
  order: number;
  items: { id: number; name: string; unit: string }[];
}

interface CatalogItem {
  id: number;
  name: string;
  category: string | null;
  unit: string;
  barcode: string | null;
  foodCategoryId?: number | null;
  foodCategory?: FoodCategory | null;
  matchedFoodItem?: { id: number; name: string } | null;
  matchedFoodCategory?: FoodCategory | null;
  offProduct?: {
    name: string;
    category: string | null;
    hierarchy: string[];
    hierarchyLabelsDe: string[];
  } | null;
}
interface ListItem {
  id: number;
  tournamentId: number;
  catalogItemId: number;
  plannedQuantity: number;
  purchasedQuantity: number;
  note: string | null;
  catalogItem: CatalogItem;
}

/**
 * Kamera-Barcode-Scan über @zxing/browser statt der nativen BarcodeDetector-
 * API: die läuft zwar auf Android/Chrome, aber NICHT in Safari (also nicht
 * auf dem iPhone - dem in der Praxis wichtigsten "Handy"-Fall). zxing deckt
 * per Video-Stream + JS-Dekodierung alle modernen Browser inkl. iOS Safari
 * ab. Trotzdem immer nur eine ZUSÄTZLICHE Option neben dem manuellen
 * Eingabefeld: ein externer USB-/Bluetooth-Barcode-Scanner "tippt" seine
 * Ergebnisse ohnehin wie eine Tastatur ins Textfeld - dafür braucht es gar
 * keine Kamera.
 */
function useBarcodeScanner(onDetected: (code: string) => void) {
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const start = () => setScanning(true);

  // Erst NACHDEM das <video>-Element (weiter unten, an videoRef gebunden)
  // durch den scanning=true-State gerendert wurde, kann zxing den Stream
  // daran anhängen - deshalb hier als Effekt statt direkt in start().
  // zxing wird dynamisch nachgeladen (nicht im Haupt-Bundle) - die
  // Dekodier-Engine ist groß (~450 KB), aber nur relevant, wenn diese
  // Funktion tatsächlich genutzt wird.
  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    let cancelled = false;

    (async () => {
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library')
      ]);
      if (cancelled || !videoRef.current) return;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE
      ]);
      const reader = new BrowserMultiFormatReader(hints);

      reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (result && !cancelled) {
            cancelled = true;
            const value = result.getText();
            stop();
            onDetectedRef.current(value);
          }
          // Error callback wird im .catch() behandelt — NotFoundException ignorieren
        }
      ).then(controls => {
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
      }).catch(async () => {
        if (cancelled) return;
        setScanning(false);
        await modal.alert({ title: 'Kamera nicht verfügbar', message: 'Auf die Kamera konnte nicht zugegriffen werden. Bitte Barcode manuell eingeben.' });
      });
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return { supported, scanning, videoRef, start, stop };
}

export default function ShoppingList({ selectedTournament, tournaments }: { selectedTournament: number | null; tournaments: Tournament[] }) {
  const queryClient = useQueryClient();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [manualForm, setManualForm] = useState<{ name: string; category: string; unit: string; barcode: string } | null>(null);
  const [copySourceId, setCopySourceId] = useState('');

  // Verpflegung-Kategorien für das Mapping laden
  const { data: foodCategories = [] } = useQuery<FoodCategory[]>({
    queryKey: ['foodCategories'],
    queryFn: getFoodCategories,
    staleTime: 5 * 60 * 1000 // 5 Min gültig - ändert sich selten
  });

  // Pending mapping: Barcode-Ergebnis das noch einer Kategorie zugeordnet werden muss
  const [pendingMapping, setPendingMapping] = useState<{
    catalogItemId: number;
    matchedFoodItem?: { id: number; name: string } | null;
    matchedFoodCategory?: FoodCategory | null;
    selectedCategoryId?: number | null;
    offHierarchy?: string[]; // OFF-Kategorien-Hierarchie zur Transparenz
    hierarchyLabelsDe?: string[]; // Deutsche Anzeige-Namen
  } | null>(null);

  const { data: items = [] } = useQuery<ListItem[]>({
    queryKey: ['shoppingList', selectedTournament],
    queryFn: () => getShoppingList(selectedTournament as number),
    enabled: !!selectedTournament
  });

  const scanner = useBarcodeScanner(async (code) => {
    setBarcodeInput(code);
    await handleLookup(code);
  });

  if (!selectedTournament) {
    return (
      <div style={{ padding: 48, textAlign: 'center', background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🛒</div>
        <div style={{ fontSize: 20, fontWeight: '600', marginBottom: 8, color: '#212529' }}>Bitte ein Turnier auswählen</div>
        <div style={{ fontSize: 14, color: '#666' }}>Wähle oben ein Turnier aus, um die Einkaufsliste zu pflegen</div>
      </div>
    );
  }

  const handleLookup = async (codeArg?: string) => {
    const code = (codeArg ?? barcodeInput).trim();
    if (!code) return;
    setLookingUp(true);
    setManualForm(null);
    try {
      const found: CatalogItem = await lookupShoppingBarcode(code);

      // Wenn Backend einen FoodCategory-Match gefunden hat → Mapping-UI anzeigen
      if (found.matchedFoodCategory || found.matchedFoodItem) {
        setPendingMapping({
          catalogItemId: found.id,
          matchedFoodItem: found.matchedFoodItem,
          matchedFoodCategory: found.matchedFoodCategory,
          selectedCategoryId: found.foodCategoryId ?? null,
          offHierarchy: found.offProduct?.hierarchy,
          hierarchyLabelsDe: found.offProduct?.hierarchyLabelsDe
        });
      } else {
        // Kein Match → direkt hinzufügen
        await addShoppingListItem({ tournamentId: selectedTournament, catalogItemId: found.id, plannedQuantity: 1 });
        queryClient.invalidateQueries({ queryKey: ['shoppingList', selectedTournament] });
      }
      setBarcodeInput('');
    } catch (e: any) {
      if (e?.status === 404) {
        // "Kein Produkt gefunden" - manuelle Pflege anbieten, Barcode schon vorausgefüllt.
        setManualForm({ name: '', category: '', unit: 'Stk', barcode: code });
      } else {
        await modal.alert({ title: 'Fehler', message: e?.message || 'Barcode-Suche fehlgeschlagen' });
      }
    } finally {
      setLookingUp(false);
    }
  };

  // Mapping bestätigen: FoodCategory zuordnen und Artikel hinzufügen
  const confirmMapping = async () => {
    if (!pendingMapping) return;
    try {
      // Kategorie verknüpfen (falls noch nicht geschehen)
      if (pendingMapping.selectedCategoryId && pendingMapping.selectedCategoryId !== pendingMapping.matchedFoodCategory?.id) {
        await linkFoodCategoryToCatalogItem(pendingMapping.catalogItemId, pendingMapping.selectedCategoryId);
      }
      // Artikel zur Liste hinzufügen
      await addShoppingListItem({ tournamentId: selectedTournament, catalogItemId: pendingMapping.catalogItemId, plannedQuantity: 1 });
      queryClient.invalidateQueries({ queryKey: ['shoppingList', selectedTournament] });
      setPendingMapping(null);
    } catch (e: any) {
      await modal.alert({ title: 'Fehler', message: e?.message || 'Kategorie konnte nicht verknüpft werden' });
    }
  };

  const submitManualItem = async () => {
    if (!manualForm) return;
    if (!manualForm.name.trim()) {
      await modal.alert({ title: 'Hinweis', message: 'Bitte einen Namen eingeben.' });
      return;
    }
    try {
      const created = await createShoppingCatalogItem({
        name: manualForm.name.trim(),
        category: manualForm.category.trim() || null,
        unit: manualForm.unit.trim() || 'Stk',
        barcode: manualForm.barcode.trim() || null
      });
      await addShoppingListItem({ tournamentId: selectedTournament, catalogItemId: created.id, plannedQuantity: 1 });
      queryClient.invalidateQueries({ queryKey: ['shoppingList', selectedTournament] });
      setManualForm(null);
      setBarcodeInput('');
    } catch (e: any) {
      await modal.alert({ title: 'Fehler', message: e?.message || 'Artikel konnte nicht angelegt werden' });
    }
  };

  const changeQuantity = async (item: ListItem, field: 'plannedQuantity' | 'purchasedQuantity', value: number) => {
    if (value < 0) return;
    await updateShoppingListItem(item.id, { [field]: value });
    queryClient.invalidateQueries({ queryKey: ['shoppingList', selectedTournament] });
  };

  const removeItem = async (item: ListItem) => {
    if (!(await modal.confirm({ title: 'Artikel entfernen', message: `"${item.catalogItem.name}" von der Einkaufsliste entfernen?`, variant: 'warning' }))) return;
    await deleteShoppingListItem(item.id);
    queryClient.invalidateQueries({ queryKey: ['shoppingList', selectedTournament] });
  };

  const runCopy = async () => {
    if (!copySourceId) return;
    try {
      const res = await copyShoppingListFrom(Number(copySourceId), selectedTournament);
      queryClient.invalidateQueries({ queryKey: ['shoppingList', selectedTournament] });
      await modal.alert({ title: 'Übernommen', message: `${res.copied} Artikel übernommen${res.skipped > 0 ? `, ${res.skipped} waren schon auf der Liste` : ''}.` });
      setCopySourceId('');
    } catch (e: any) {
      await modal.alert({ title: 'Fehler', message: e?.message || 'Übernahme fehlgeschlagen' });
    }
  };

  const otherTournaments = tournaments.filter(t => t.id !== selectedTournament);
  const totalPlanned = items.reduce((s, i) => s + i.plannedQuantity, 0);
  const totalPurchased = items.reduce((s, i) => s + i.purchasedQuantity, 0);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid #e9ecef' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: 22, color: '#212529', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🛒</span> Einkaufsliste
        </h2>
        <p style={{ margin: '0 0 24px 0', color: '#6c757d', fontSize: 14 }}>
          Was für dieses Turnier eingekauft werden muss - Lebensmittel und alles andere (Kohle, Becher, Reinigungsmittel, ...).
          {items.length > 0 && ` Bisher: ${totalPurchased} von ${totalPlanned} besorgt.`}
        </p>

        {/* Aus früherem Turnier übernehmen */}
        {otherTournaments.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center', background: '#f8f9fa', padding: 12, borderRadius: 10, border: '1px solid #e9ecef' }}>
            <span style={{ fontSize: 13, color: '#495057' }}>📋 Liste übernehmen von:</span>
            <select value={copySourceId} onChange={e => setCopySourceId(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13, flex: 1, minWidth: 160 }}>
              <option value="">-- Turnier wählen --</option>
              {otherTournaments.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            <button onClick={runCopy} disabled={!copySourceId} style={{ padding: '8px 14px', background: copySourceId ? '#0d6efd' : '#adb5bd', color: '#fff', border: 'none', borderRadius: 6, cursor: copySourceId ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
              Übernehmen
            </button>
          </div>
        )}

        {/* Artikel hinzufügen: Barcode (Scan oder Eingabe) */}
        <div style={{ background: '#f8f9fa', borderRadius: 12, padding: 16, border: '1px solid #dee2e6', marginBottom: 20 }}>
          <strong style={{ display: 'block', marginBottom: 10, color: '#212529' }}>Artikel hinzufügen:</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
              placeholder="Barcode scannen oder eingeben..."
              style={{ flex: 1, minWidth: 200, padding: '10px 12px', border: '1px solid #ced4da', borderRadius: 8, fontSize: 14 }}
            />
            <button onClick={() => handleLookup()} disabled={lookingUp || !barcodeInput.trim()} style={{ padding: '10px 16px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              {lookingUp ? '⏳ Suche...' : '🔍 Suchen'}
            </button>
            {scanner.supported && (
              <button onClick={scanner.scanning ? scanner.stop : scanner.start} style={{ padding: '10px 16px', background: scanner.scanning ? '#dc3545' : '#198754', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                {scanner.scanning ? '✕ Scan beenden' : '📷 Mit Kamera scannen'}
              </button>
            )}
            <button onClick={() => setManualForm({ name: '', category: '', unit: 'Stk', barcode: '' })} style={{ padding: '10px 16px', background: '#fff', color: '#495057', border: '1px solid #ced4da', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              ➕ Ohne Barcode
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>Ein USB-/Bluetooth-Barcode-Scanner tippt seinen Code direkt ins Feld - dafür ist keine Kamera nötig.</div>

          {scanner.scanning && (
            <div style={{ marginTop: 12, borderRadius: 8, overflow: 'hidden', maxWidth: 400 }}>
              <video ref={scanner.videoRef} style={{ width: '100%', display: 'block' }} muted playsInline />
              <div style={{ fontSize: 12, color: '#6c757d', textAlign: 'center', marginTop: 4 }}>Barcode vor die Kamera halten...</div>
            </div>
          )}

          {/* Mapping-UI: Barcode-Ergebnis mit Verpflegung-Kategorie verknüpfen */}
          {pendingMapping && (
            <div style={{ marginTop: 14, padding: 14, background: '#e7f5ff', border: '1px solid #b3d9ff', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0c5460', marginBottom: 10 }}>
                ℹ️ Barcode erkannt → Verpflegung-Kategorie zuordnen:
              </div>

              {/* OFF-Hierarchie anzeigen (mit deutschen Labels) */}
              {pendingMapping.offHierarchy && pendingMapping.offHierarchy.length > 0 && (
                <div style={{ fontSize: 12, color: '#084298', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>OFF-Hierarchie (gewählt: <strong>{pendingMapping.hierarchyLabelsDe?.[pendingMapping.hierarchyLabelsDe!.length - 1] || pendingMapping.offHierarchy[pendingMapping.offHierarchy.length - 1]}</strong>):</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                    {pendingMapping.offHierarchy.map((tag, idx) => (
                      <span key={idx} style={{
                        padding: '2px 6px',
                        background: idx === pendingMapping.offHierarchy!.length - 1 ? '#b3d9ff' : '#fff',
                        border: '1px solid #b3d9ff',
                        borderRadius: 4,
                        fontSize: 10,
                        whiteSpace: 'nowrap'
                      }}>
                        {pendingMapping.hierarchyLabelsDe?.[idx] || tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Fallback wenn keine Hierarchie */}
              {!pendingMapping.offHierarchy || pendingMapping.offHierarchy.length === 0 ? (
                <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 8 }}>
                  ℹ️ Keine OFF-Hierarchie verfügbar — bitte Kategorie manuell wählen.
                </div>
              ) : null}

              {pendingMapping.matchedFoodItem && (
                <div style={{ fontSize: 12, color: '#084298', marginBottom: 8 }}>
                  Gefunden: <strong>{pendingMapping.matchedFoodCategory?.icon} {pendingMapping.matchedFoodCategory?.name}</strong> → "{pendingMapping.matchedFoodItem.name}"
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#495057' }}>Kategorie:</span>
                {foodCategories.length === 0 ? (
                  <span style={{ fontSize: 12, color: '#6c757d', fontStyle: 'italic' }}>Lade Kategorien...</span>
                ) : (
                  <select
                    value={pendingMapping.selectedCategoryId || ''}
                    onChange={e => setPendingMapping({ ...pendingMapping, selectedCategoryId: e.target.value ? Number(e.target.value) : null })}
                    style={{ padding: '8px 10px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13, flex: 1, minWidth: 200 }}
                  >
                    <option value="">-- Kategorie wählen --</option>
                    {foodCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                    ))}
                  </select>
                )}
                {/* Vorschlag anzeigen */}
                {pendingMapping.matchedFoodCategory && pendingMapping.selectedCategoryId !== pendingMapping.matchedFoodCategory.id && (
                  <span style={{ fontSize: 11, color: '#084298' }}>
                    💡 Vorgeschlagen: {pendingMapping.matchedFoodCategory.icon} {pendingMapping.matchedFoodCategory.name}
                  </span>
                )}
                <button onClick={confirmMapping} style={{ padding: '8px 14px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  ✅ Bestätigen &amp; hinzufügen
                </button>
                <button onClick={() => setPendingMapping(null)} style={{ padding: '8px 14px', background: '#fff', color: '#6c757d', border: '1px solid #ced4da', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  Ohne Kategorie
                </button>
              </div>
            </div>
          )}

          {manualForm && (
            <div style={{ marginTop: 14, padding: 14, background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#856404', marginBottom: 10 }}>
                {manualForm.barcode ? `ℹ️ Kein Produkt gefunden für Barcode ${manualForm.barcode} - bitte manuell anlegen:` : 'Neuen Artikel anlegen:'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={manualForm.name} onChange={e => setManualForm({ ...manualForm, name: e.target.value })} placeholder="Artikelname" style={{ flex: 2, minWidth: 160, padding: '8px 10px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13 }} />
                <input value={manualForm.category} onChange={e => setManualForm({ ...manualForm, category: e.target.value })} placeholder="Kategorie (optional)" style={{ flex: 1, minWidth: 120, padding: '8px 10px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13 }} />
                <input value={manualForm.unit} onChange={e => setManualForm({ ...manualForm, unit: e.target.value })} placeholder="Einheit" style={{ width: 80, padding: '8px 10px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13 }} />
                <button onClick={submitManualItem} style={{ padding: '8px 14px', background: '#198754', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>➕ Anlegen &amp; hinzufügen</button>
                <button onClick={() => setManualForm(null)} style={{ padding: '8px 14px', background: '#fff', color: '#6c757d', border: '1px solid #ced4da', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>

        {/* Liste */}
        {items.length === 0 ? (
          <div style={{ color: '#6c757d', padding: 20, textAlign: 'center', lineHeight: 1.6, fontSize: 14 }}>Noch keine Artikel auf der Liste.<br /><span style={{ fontSize: 13 }}>Hier steht, was der Verein selbst einkauft – im Unterschied zu den Spenden der Eltern. Am schnellsten geht es per Barcode oder indem du die Liste eines vergangenen Turniers übernimmst.</span></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(item => {
              const done = item.purchasedQuantity >= item.plannedQuantity && item.plannedQuantity > 0;
              const catIcon = item.catalogItem.foodCategory?.icon || '📦';
              const catName = item.catalogItem.foodCategory?.name || item.catalogItem.category;
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: done ? '#f0f9f4' : '#fff', border: `1px solid ${done ? '#b7e4c7' : '#e9ecef'}`, borderRadius: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#212529', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.catalogItem.name}
                      {done && <span style={{ marginLeft: 6 }}>✓</span>}
                    </div>
                    {catName && <div style={{ fontSize: 11, color: '#999' }}>{catIcon} {catName}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6c757d' }}>
                    <span>Soll:</span>
                    <input type="number" min={0} value={item.plannedQuantity} onChange={e => changeQuantity(item, 'plannedQuantity', parseInt(e.target.value) || 0)} style={{ width: 55, padding: '6px 8px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13 }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6c757d' }}>
                    <span>Ist:</span>
                    <input type="number" min={0} value={item.purchasedQuantity} onChange={e => changeQuantity(item, 'purchasedQuantity', parseInt(e.target.value) || 0)} style={{ width: 55, padding: '6px 8px', border: '1px solid #ced4da', borderRadius: 6, fontSize: 13 }} />
                  </div>
                  <span style={{ fontSize: 11, color: '#999', minWidth: 30 }}>{item.catalogItem.unit}</span>
                  <button onClick={() => removeItem(item)} title="Entfernen" style={{ width: 32, height: 32, border: 'none', background: '#ffe3e3', color: '#dc3545', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
