import { useState, useRef, useEffect } from 'react';
import { modal } from '../Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getClubs, apiPost, apiPut, apiDelete } from '../../../api';
import { btnStyleSecondary, Club, useSortableData, confirmWithImpact } from '../shared';
import { StammdatenKopf, AnlegenDialog } from '../Stammdatenseite';

export default function Vereine({ adminPrimary }: { adminPrimary: string }) {
  const queryClient = useQueryClient();
  const { data: clubs = [] } = useQuery<Club[]>({ queryKey: ['clubs'], queryFn: getClubs });

  // Sortierbare Tabelle statt Kartenraster gruppiert nach Stadt - wie auf
  // allen anderen Stammdatenseiten. Die Stadt ist jetzt eine Spalte wie jede
  // andere, statt eine feste Gruppierung vorzugeben.
  const { items: sortedClubs, requestSort, getSortIndicator } = useSortableData(clubs, { key: 'name', direction: 'asc' });

  // Form state – nur noch 2 Farben: Vereinsfarbe + Aktionsfarbe
  const [clubForm, setClubForm] = useState({ name: '', city: '', primaryColor: '#0d6efd', secondaryColor: '#198754', logo: '' });
  const [editingClub, setEditingClub] = useState<number | null>(null);
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [clubLogo, setClubLogo] = useState<string | null>(null);
  const [extractedColors, setExtractedColors] = useState<{ primary: string; secondary: string } | null>(null);
  const [colorStrategyIndex, setColorStrategyIndex] = useState(0);
  const [analysisCount, setAnalysisCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync extrahierte Farben → clubForm
  useEffect(() => {
    if (extractedColors) {
      setClubForm(prev => ({ ...prev, primaryColor: extractedColors.primary, secondaryColor: extractedColors.secondary }));
    }
  }, [extractedColors]);

  // Tauscht Vereinsfarbe und Aktionsfarbe
  const handleSwap = () => {
    if (extractedColors) {
      setExtractedColors(prev => prev ? ({ primary: prev.secondary, secondary: prev.primary }) : null);
    } else {
      setClubForm(prev => ({ ...prev, primaryColor: prev.secondaryColor, secondaryColor: prev.primaryColor }));
    }
  };

  const resetAnalysis = () => { setColorStrategyIndex(0); setExtractedColors(null); };

  const saveClub = async () => {
    if (!clubForm.name.trim()) return await modal.alert({ title: 'Hinweis', message: 'Name erforderlich!' });
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    if (!hexColorRegex.test(clubForm.primaryColor)) return await modal.alert({ title: 'Hinweis', message: 'Vereinsfarbe muss ein Hex-Wert wie #aabbcc sein' });
    if (!hexColorRegex.test(clubForm.secondaryColor)) return await modal.alert({ title: 'Hinweis', message: 'Aktionsfarbe muss ein Hex-Wert wie #aabbcc sein' });
    // Verhindert nahezu-weiße Farben (wie beim Logo-Farbfilter)
    const tooLight = (hex: string) => {
      const r = parseInt(hex.substring(1, 3), 16), g = parseInt(hex.substring(3, 5), 16), b = parseInt(hex.substring(5, 7), 16);
      return r > 235 && g > 235 && b > 235;
    };
    if (tooLight(clubForm.primaryColor)) return await modal.alert({ title: 'Hinweis', message: 'Vereinsfarbe ist zu hell (nahezu weiß). Sie wird für Tabs/Buttons verwendet – bitte eine kräftigere Farbe wählen.' });
    if (tooLight(clubForm.secondaryColor)) return await modal.alert({ title: 'Hinweis', message: 'Aktionsfarbe ist zu hell (nahezu weiß). Sie wird für wichtige Buttons verwendet – bitte eine kräftigere Farbe wählen.' });
    const data: { name: string; city?: string | null; primaryColor: string; secondaryColor: string; logo?: string } = {
      name: clubForm.name, city: clubForm.city || undefined, primaryColor: clubForm.primaryColor, secondaryColor: clubForm.secondaryColor
    };
    if (clubForm.logo) data.logo = clubForm.logo;
    if (editingClub) {
      await apiPut(`/api/clubs/${editingClub}`, data);
    } else {
      await apiPost('/api/clubs', data);
    }
    queryClient.invalidateQueries({ queryKey: ['clubs'] });
    resetAnalysis(); setClubForm({ name: '', city: '', primaryColor: '#0d6efd', secondaryColor: '#198754', logo: '' });
    setClubLogo(null); setEditingClub(null); setAnlegenOffen(false);
  };

  const deleteClub = async (club: Club) => {
    if (!(await confirmWithImpact('club', club.id, club.name))) return;
    await apiDelete(`/api/clubs/${club.id}`);
    queryClient.invalidateQueries({ queryKey: ['clubs'] });
  };

  const extractColors = (imgSrc: string, strategyIndex?: number) => {
    try {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = 100; canvas.height = 100; ctx.drawImage(img, 0, 0, 100, 100);
        const imageData = ctx.getImageData(0, 0, 100, 100).data;
        const strategies = [{ step: 32, skip: 8, minBrightness: 50 }, { step: 64, skip: 16, minBrightness: 80 }, { step: 16, skip: 4, minBrightness: 20 }, { step: 48, skip: 32, minBrightness: 100 }];
        const s = strategyIndex !== undefined ? strategies[strategyIndex % strategies.length] : strategies[0];
        // Logos haben fast immer einen weißen/nahezu-weißen Hintergrund (transparentes
        // PNG wird beim Zeichnen aufs Canvas oft ohnehin hell). Ohne diesen Filter
        // gewinnt "Weiß" regelmäßig als eine der drei Vereinsfarben - die dann als
        // Button-/Header-Hintergrund mit weißer Schrift praktisch unsichtbar ist.
        const MAX_BRIGHTNESS = 235;
        const colorMap: Record<string, number> = {}; let totalPixels = 0;
        for (let i = 0; i < imageData.length; i += s.skip * 4) {
          const r = imageData[i], g = imageData[i + 1], b = imageData[i + 2]; totalPixels++;
          if (r < s.minBrightness && g < s.minBrightness && b < s.minBrightness) continue;
          if (r > MAX_BRIGHTNESS && g > MAX_BRIGHTNESS && b > MAX_BRIGHTNESS) continue;
          let qr = Math.round(r / s.step) * s.step, qg = Math.round(g / s.step) * s.step, qb = Math.round(b / s.step) * s.step;
          qr = Math.min(qr, 255); qg = Math.min(qg, 255); qb = Math.min(qb, 255);
          colorMap[`${qr},${qg},${qb}`] = (colorMap[`${qr},${qg},${qb}`] || 0) + 1;
        }
        // Die 2 dominantesten Farben extrahieren
        const sorted = Object.entries(colorMap).sort((a, b) => b[1] - a[1]).slice(0, 2);
        if (sorted.length >= 2) {
          const toHex = (rgb: string) => '#' + rgb.split(',').map(c => parseInt(c).toString(16).padStart(2, '0')).join('');
          setExtractedColors({ primary: toHex(sorted[0][0]), secondary: toHex(sorted[1][0]) });
          setAnalysisCount(prev => prev + 1);
        } else { modal.alert({ title: 'Hinweis', message: 'Das Logo hat nicht genug verschiedene Farben.' }).catch(() => {}); }
      };
      img.src = imgSrc;
    } catch (err) { modal.alert({ title: 'Fehler', message: 'Farbanalyse fehlgeschlagen: ' + (err as Error).message }).catch(() => {}); }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => { const base64 = reader.result as string; setClubLogo(base64); setColorStrategyIndex(0); setExtractedColors(null); setAnalysisCount(0); setClubForm({ ...clubForm, logo: base64 }); setTimeout(() => extractColors(base64), 100); };
    reader.readAsDataURL(file);
  };

  const openEdit = (club: Club) => {
    resetAnalysis(); setEditingClub(club.id);
    setClubForm({ name: club.name, city: club.city || '', primaryColor: club.primaryColor, secondaryColor: club.secondaryColor, logo: club.logo || '' });
    setClubLogo(club.logo); setColorStrategyIndex(0); setAnalysisCount(0);
  };

  const closeEdit = () => { resetAnalysis(); setEditingClub(null); setClubForm({ name: '', city: '', primaryColor: '#0d6efd', secondaryColor: '#198754', logo: '' }); setClubLogo(null); };

  const ColorPicker = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="vereine-style-1">
      <div className="vereine-style-2">{label}</div>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="vereine-style-3" />
    </div>
  );

  return (
    <div className="vereine-card">
      <StammdatenKopf
        titel="🛡️ Vereine & Clubs"
        untertitel="Vereine mit Logo und Farben – sie erscheinen im Turnier und im Spielplan."
        neuText="Neuer Verein"
        onNeu={() => setAnlegenOffen(true)}
        farbe={adminPrimary}
      />

      {anlegenOffen && (
        <AnlegenDialog
          titel="🛡️ Neuen Verein anlegen"
          onAbbrechen={() => setAnlegenOffen(false)}
          onAnlegen={saveClub}
          anlegenText="Verein anlegen"
          breite={520}
          farbe={adminPrimary}
        >
          <div className="vereine-style-5">
            <div className="vereine-style-6">
              <label className="vereine-style-7">📝 Name</label>
              <input value={clubForm.name} onChange={e => setClubForm({ ...clubForm, name: e.target.value })} placeholder="z.B. TSV Holm" className="vereine-style-8" />
            </div>
            <div className="vereine-style-9">
              <label className="vereine-style-10">🏙️ Stadt</label>
              <input value={clubForm.city} onChange={e => setClubForm({ ...clubForm, city: e.target.value })} placeholder="z.B. Holm" className="vereine-style-11" />
            </div>
          </div>
        </AnlegenDialog>
      )}

      <div className="admin-table-scroll">
      <table className="vereine-table admin-cards-mobile">
        <thead>
          <tr className="vereine-table-header-row">
            <th className="vereine-th-no-cursor">Logo</th>
            <th onClick={() => requestSort('name')} className="vereine-th-left-pointer">Name{getSortIndicator('name')}</th>
            <th onClick={() => requestSort('city')} className="vereine-th-left-pointer">Stadt{getSortIndicator('city')}</th>
            <th className="vereine-th-no-cursor">Farben</th>
            <th className="vereine-th-no-cursor">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {sortedClubs.length === 0 ? (
            <tr><td colSpan={5} className="vereine-empty-td">Noch keine Vereine angelegt.</td></tr>
          ) : sortedClubs.map(club => (
            <tr key={club.id} className="vereine-tr">
              <td data-label="Logo" className="vereine-td-center">
                {club.logo
                  ? <img src={club.logo} alt={club.name} className="vereine-table-logo" />
                  : <span className="vereine-table-logo-placeholder" style={{ background: club.primaryColor }}>{club.name.charAt(0)}</span>}
              </td>
              <td data-label="Name" className="vereine-td-bold">{club.name}</td>
              <td data-label="Stadt" className="vereine-td">{club.city || <span className="vereine-gray-text">–</span>}</td>
              <td data-label="Farben" className="vereine-td">
                <span title="Vereinsfarbe" className="vereine-color-dot" style={{ background: club.primaryColor }} />
                <span title="Aktionsfarbe" className="vereine-color-dot" style={{ background: club.secondaryColor }} />
              </td>
              <td className="vereine-td-actions">
                <div className="vereine-actions-container">
                  <button onClick={() => openEdit(club)} className="vereine-btn-edit">✏️</button>
                  <button onClick={() => deleteClub(club)} className="vereine-btn-delete">🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Edit Modal */}
      {editingClub && (
        <div className="vereine-modal-overlay">
          <div className="vereine-modal-content">
            <div className="vereine-style-23">
              <h3 className="vereine-style-24">✏️ Verein bearbeiten</h3>
              <button onClick={closeEdit} className="vereine-style-25">×</button>
            </div>
            {/* Scrollbarer Inhalt */}
            <div className="vereine-style-26">
              <div className="vereine-style-27">

                {/* Name & Stadt – mit Labels (§13.1) */}
                <div>
                  <label className="vereine-style-28">📝 Name</label>
                  <input value={clubForm.name} onChange={e => setClubForm({ ...clubForm, name: e.target.value })} placeholder="Vereinsname" className="vereine-style-29" />
                </div>
                <div>
                  <label className="vereine-style-30">🏙️ Stadt</label>
                  <input value={clubForm.city} onChange={e => setClubForm({ ...clubForm, city: e.target.value })} placeholder="z.B. Holm" className="vereine-style-31" />
                </div>

            {/* Logo-Upload */}
            <div className="vereine-style-32">
              <label className="vereine-style-33">🖼️ Logo</label>
              <input type="file" accept="image/*" ref={fileInputRef} onChange={handleLogoUpload} className="vereine-style-34" />
              {!clubLogo ? (
                <button onClick={() => fileInputRef.current?.click()} className="vereine-style-35">
                  Bild auswählen
                </button>
              ) : (
                <div className="vereine-style-36">
                  <img src={clubLogo} alt="Vereinslogo" className="vereine-style-37" />
                  {extractedColors && (
                    <button onClick={() => setClubForm({ ...clubForm, primaryColor: extractedColors.primary, secondaryColor: extractedColors.secondary })} className="vereine-style-38">
                      Farben übernehmen
                    </button>
                  )}
                  <button onClick={() => { setColorStrategyIndex(prev => prev + 1); extractColors(clubLogo, analysisCount); }} className="vereine-style-39">
                    Neu analysieren
                  </button>
                  <button onClick={() => { setClubLogo(null); setExtractedColors(null); }} className="vereine-style-40">
                    Ändern
                  </button>
                </div>
              )}
            </div>

            {/* Vereinsfarben – nur wenn Logo vorhanden */}
            {clubLogo && (
              <div className="vereine-style-41">
                <label className="vereine-style-42">🎨 Vereinsfarben</label>

                {/* Detaillierte Legende – was die Farben bewirken */}
                <div className="vereine-style-43">
                  <span>🔵 <strong>Vereinsfarbe</strong>: Aktive Tabs, Header-Hintergrund, Club-Avatar. Wähle die dominante Farbe deines Logos/Vereinsbrandings.</span>
                  <span>🟢 <strong>Aktionsfarbe</strong>: Push-Banner-Button, wichtige CTAs. Sollte auf weißem Grund gut lesbar sein!</span>
                </div>

                {/* Pipette-Hinweis */}
                <div className="vereine-style-44">
                  💡 Tipp: Klicke auf einen Farbwähler → Pipette aktivieren → Farbe vom Logo oben auswählen
                </div>

                {/* ColorPicker mit Tausch-Button */}
                <div className="vereine-style-45">
                  <ColorPicker label="Vereinsfarbe" value={extractedColors ? extractedColors.primary : clubForm.primaryColor} onChange={v => { if (extractedColors) setExtractedColors({ ...extractedColors, primary: v }); else setClubForm({ ...clubForm, primaryColor: v }); }} />
                  <button onClick={() => handleSwap()} title="Farben tauschen" className="vereine-style-46">⇄</button>
                  <ColorPicker label="Aktionsfarbe" value={extractedColors ? extractedColors.secondary : clubForm.secondaryColor} onChange={v => { if (extractedColors) setExtractedColors({ ...extractedColors, secondary: v }); else setClubForm({ ...clubForm, secondaryColor: v }); }} />
                </div>
              </div>
            )}

            </div>
            {/* Fixierter Footer – IMMER sichtbar (§13.2) */}
            <div className="vereine-style-47">
              <button onClick={closeEdit} style={{ ...btnStyleSecondary, border: '1px solid #dee2e6', background: '#fff', padding: '10px 20px', fontSize: 14 }}>Abbrechen</button>
              <button onClick={saveClub} style={{ padding: '10px 20px', background: adminPrimary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, minHeight: 40 }}>Speichern</button>
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
