import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Tournament, TournamentDay, TournamentWorkArea, VolunteerShift } from '../shared';
import { useKontakte, KontakteEditor, KontakteFooter } from './StationPrintKontakte';

interface StationPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournament: Tournament | null;
  days: TournamentDay[];
  workAreas: TournamentWorkArea[];
  jobSlots: any[];
  volunteerShifts: VolunteerShift[];
}

function minToTimeStr(min: number | null | undefined): string {
  if (min == null) return '--:--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** „Samstag, 05.09.2026" - fuer die Ueberschrift eines Tagesabschnitts. */
const tagLang = (d: TournamentDay): string =>
  d.date
    ? new Date(d.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    : d.label || 'Turniertag';

/** „Sa., 05.09." - fuer die Aufzaehlung in der Kopfleiste, wo mehrere stehen. */
const tagKurz = (d: TournamentDay): string =>
  d.date
    ? new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
    : d.label || 'Turniertag';

function formatHelperName(name: string, mode: 'full' | 'short'): string {
  if (!name) return 'Unbekannt';
  if (mode === 'full') return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0].toUpperCase();
  return `${firstName} ${lastInitial}.`;
}

export default function StationPrintModal({
  isOpen,
  onClose,
  tournament,
  days,
  workAreas,
  jobSlots,
  volunteerShifts
}: StationPrintModalProps) {
  const [selectedDayId, setSelectedDayId] = useState<string>('all');
  const [selectedWorkAreaId, setSelectedWorkAreaId] = useState<string>('all');
  const [showPhone, setShowPhone] = useState<boolean>(false); // DSGVO Standard: Aus
  const [nameMode, setNameMode] = useState<'short' | 'full'>('short'); // DSGVO Standard: Max M.
  const [showSignature, setShowSignature] = useState<boolean>(true);
  const [seitenAufteilung, setSeitenAufteilung] = useState<'station' | 'stationUndTag'>('station');
  const [stationNote, setStationNote] = useState<string>('Bitte 5 Minuten vor Schichtbeginn an der Station einfinden. Bei Fragen oder Wechselgeld-Bedarf bitte an die Turnierleitung wenden.');
  // Muss oberhalb des `if (!isOpen) return null` stehen - der Dialog wird
  // geschlossen und wieder geoeffnet, und ein Hook hinter einem Early Return
  // laesst React beim naechsten Rendern aussteigen.
  const [kontakte, setKontakte] = useKontakte(tournament?.id);

  /**
   * Markiert am <body>, dass gerade ein Stationszettel im Vordergrund steht.
   *
   * Die Druckregeln nehmen die App dann aus dem Layout. Das darf nur gelten,
   * solange dieser Dialog offen ist - sonst druckte jeder andere Strg+P im
   * Admin-Bereich ein leeres Blatt.
   */
  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add('druckdialog-offen');
    return () => document.body.classList.remove('druckdialog-offen');
  }, [isOpen]);

  // Render filter logic
  const filteredDays = useMemo(() => {
    if (selectedDayId === 'all') return days;
    return days.filter(d => String(d.id) === selectedDayId);
  }, [days, selectedDayId]);

  const filteredWorkAreas = useMemo(() => {
    const active = workAreas.filter(w => w.active);
    if (selectedWorkAreaId === 'all') return active;
    return active.filter(w => String(w.id) === selectedWorkAreaId);
  }, [workAreas, selectedWorkAreaId]);

  /**
   * Die Blaetter, die gedruckt werden.
   *
   * Frueher entstand je Tag UND Station ein Blatt - bei zwei Turniertagen und
   * acht Stationen also sechzehn. An der Station haengen dann zwei Zettel
   * nebeneinander, die dasselbe Team an zwei Tagen zeigen, und wer nachsieht,
   * muss erst den richtigen finden. Voreinstellung ist deshalb ein Blatt je
   * Station mit allen Tagen darauf. Wer die alte Aufteilung braucht - etwa
   * weil pro Tag ein frischer Zettel ausgehaengt wird - stellt sie um.
   *
   * Tage ohne Schichten fallen raus, Stationen ohne jede Schicht ebenfalls:
   * ein leeres Blatt sagt nichts und kostet Papier.
   */
  const blaetter = useMemo(() => {
    const proStation = filteredWorkAreas.map(area => ({
      area,
      tage: filteredDays
        .map(day => ({
          day,
          shifts: jobSlots
            .filter(s =>
              s.tournamentDayId === day.id
              && (s.tournamentWorkAreaId === area.id || s.arbeitsbereichId === area.id || s.workArea?.id === area.id))
            .sort((a, b) =>
              (a.startMin ?? a.daySlot?.startMin ?? 0) - (b.startMin ?? b.daySlot?.startMin ?? 0))
        }))
        .filter(t => t.shifts.length > 0)
    })).filter(s => s.tage.length > 0);

    if (seitenAufteilung === 'station') {
      return proStation.map(s => ({ key: `a${s.area.id}`, area: s.area, tage: s.tage }));
    }
    return proStation.flatMap(s =>
      s.tage.map(t => ({ key: `a${s.area.id}-d${t.day.id}`, area: s.area, tage: [t] })));
  }, [filteredWorkAreas, filteredDays, jobSlots, seitenAufteilung]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const clubLogo = tournament?.club?.logo;
  const sponsorLogo = tournament?.logo;
  const sponsorName = tournament?.sponsorName || (tournament?.hasSponsor ? 'Sponsor' : null);

  /**
   * Der Dialog haengt per Portal direkt an <body>, nicht dort, wo er im
   * Komponentenbaum steht.
   *
   * Grund ist der Ausdruck. Bisher lag er tief in der Admin-Oberflaeche, die
   * beim Drucken zwar auf visibility:hidden stand, aber im Layout blieb - und
   * zwar fensterbreit. Chrome verkleinert die Seite, damit die breiteste
   * Layoutbreite aufs Papier passt: gemessen 49%. Der Bogen kam winzig aus dem
   * Drucker und fuellte ein Drittel der Seite.
   *
   * Am Portal laesst sich die App im Druck komplett aus dem Layout nehmen
   * (#root auf display:none), statt sie nur unsichtbar zu machen. Dann ist der
   * Stationszettel das einzige, was ueberhaupt eine Breite hat.
   */
  return createPortal(
    <div className="station-print-overlay">
      <div className="station-print-modal">
        {/* Toolbar Header */}
        <div className="station-print-toolbar">
          <div className="station-print-toolbar-title">
            <span>🖨️</span>
            <span>Stationszettel Druck- & PDF-Generator (DIN A4)</span>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handlePrint}
              style={{
                padding: '8px 18px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
              }}
            >
              <span>🖨️</span>
              <span>Drucken / Als PDF speichern</span>
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 14px',
                background: '#e2e8f0',
                color: '#334155',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer'
              }}
            >
              Schließen ✖
            </button>
          </div>
        </div>

        {/* Filter & DSGVO Options */}
        <div className="station-print-options">
          <div className="station-print-field">
            <label>📅 Turniertag</label>
            <select
              className="station-print-select"
              value={selectedDayId}
              onChange={e => setSelectedDayId(e.target.value)}
            >
              <option value="all">Alle Tage</option>
              {days.map((d, i) => (
                <option key={d.id} value={String(d.id)}>
                  Tag {i + 1} ({d.label || d.date ? new Date(d.date).toLocaleDateString('de-DE') : `Tag ${i + 1}`})
                </option>
              ))}
            </select>
          </div>

          <div className="station-print-field">
            <label>📍 Arbeitsstation</label>
            <select
              className="station-print-select"
              value={selectedWorkAreaId}
              onChange={e => setSelectedWorkAreaId(e.target.value)}
            >
              <option value="all">Alle Arbeitsstationen</option>
              {workAreas.filter(w => w.active).map(w => (
                <option key={w.id} value={String(w.id)}>
                  {w.icon} {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="station-print-field">
            <label>📄 Seitenaufteilung</label>
            <select
              className="station-print-select"
              value={seitenAufteilung}
              onChange={e => setSeitenAufteilung(e.target.value as 'station' | 'stationUndTag')}
            >
              <option value="station">Ein Blatt je Station (alle Tage darauf)</option>
              <option value="stationUndTag">Ein Blatt je Station und Tag</option>
            </select>
          </div>

          <div className="station-print-field">
            <label>🔒 DSGVO Namensformat</label>
            <select
              className="station-print-select"
              value={nameMode}
              onChange={e => setNameMode(e.target.value as 'short' | 'full')}
            >
              <option value="short">DSGVO geschützt (z.B. Max M.)</option>
              <option value="full">Vollständiger Name (z.B. Max Mustermann)</option>
            </select>
          </div>

          <div className="station-print-field">
            <label>📝 Notiz für Stationen</label>
            <input
              className="station-print-input"
              value={stationNote}
              onChange={e => setStationNote(e.target.value)}
              placeholder="Hinweis für Helfer vor Ort..."
            />
          </div>

          <label className="station-print-checkbox-group">
            <input
              type="checkbox"
              checked={showPhone}
              onChange={e => setShowPhone(e.target.checked)}
            />
            <span>Telefonnummern anzeigen</span>
          </label>

          <label className="station-print-checkbox-group">
            <input
              type="checkbox"
              checked={showSignature}
              onChange={e => setShowSignature(e.target.checked)}
            />
            <span>Anwesenheits-Spalte (Handzeichen)</span>
          </label>
        </div>

        <KontakteEditor
          kontakte={kontakte}
          setKontakte={setKontakte}
          volunteerShifts={volunteerShifts}
        />

        {/* Live A4 Print Pages Preview Container */}
        <div className="station-print-preview-container">
          {blaetter.map(({ key, area, tage }) => {
            const mehrereTage = tage.length > 1;
            const schichtenGesamt = tage.reduce((s, t) => s + t.shifts.length, 0);

            return (
              <div key={key} className="station-print-page">
                <div>
                  {/* Header */}
                  <div className="station-print-header">
                    <div className="station-print-header-left">
                      {clubLogo ? (
                        <img src={clubLogo} alt="Vereins Logo" className="station-print-logo" />
                      ) : (
                        <div style={{ fontSize: 32 }}>🏆</div>
                      )}
                    </div>

                    <div className="station-print-title-box">
                      <div className="station-print-tournament-name">{tournament?.name || 'Turnier Planungs Tool'}</div>
                      <h1 className="station-print-station-title">
                        {area.icon} {area.name}
                      </h1>
                    </div>

                    <div className="station-print-header-right">
                      {sponsorLogo ? (
                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Präsentiert von</div>
                          {/* Kein Name unter dem Logo: das Logo traegt den Namen bereits.
                              Fuer Vorlese-Software steht er im alt-Text, und ohne Logo
                              greift ohnehin der Textfall darunter. */}
                          <img src={sponsorLogo} alt={sponsorName || 'Sponsor Logo'} className="station-print-logo" />
                        </div>
                      ) : sponsorName ? (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Präsentiert von</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{sponsorName}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Meta Bar */}
                  <div className="station-print-meta-bar">
                    {mehrereTage ? (
                      <div>📅 <strong>Tage:</strong> {tage.map(t => tagKurz(t.day)).join(' · ')}</div>
                    ) : (
                      <div>📅 <strong>Datum:</strong> {tagLang(tage[0].day)}</div>
                    )}
                    <div>📍 <strong>Station:</strong> {area.name}</div>
                    <div>⏱️ <strong>Schichten:</strong> {schichtenGesamt} insgesamt</div>
                  </div>

                  {/* Je Turniertag ein Abschnitt. Die Ueberschrift steht nur da,
                      wenn es mehrere sind - bei einem einzigen Tag stuende sie
                      unmittelbar unter demselben Datum in der Leiste darueber. */}
                  {tage.map(({ day, shifts }) => (
                    <div key={day.id} className="station-print-tag">
                      {mehrereTage && (
                        <div className="station-print-tag-titel">📅 {tagLang(day)}</div>
                      )}

                      <div className="station-print-table-container">
                        <table className="station-print-table">
                          <thead>
                            <tr>
                              <th style={{ width: '22%' }}>Uhrzeit / Slot</th>
                              <th style={{ width: '45%' }}>Eingeteilte Helfer</th>
                              {showSignature && <th style={{ width: '20%' }}>Anwesenheit</th>}
                              <th style={{ width: '13%', textAlign: 'center' }}>Belegung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shifts.map((shift: any) => {
                              const startMin = shift.startMin ?? shift.daySlot?.startMin;
                              const endMin = shift.endMin ?? shift.daySlot?.endMin;
                              const timeLabel = startMin != null && endMin != null
                                ? `${minToTimeStr(startMin)} - ${minToTimeStr(endMin)} Uhr`
                                : shift.slot || shift.daySlot?.label || 'Zeit unbestimmt';

                              // Find volunteers assigned to this shift
                              const assignedVS = volunteerShifts.filter(vs => vs.shiftId === shift.id || (vs.areaId === area.id && vs.date === day.date && vs.slot === shift.slot));
                              const count = assignedVS.length;
                              const maxVol = shift.maxVolunteers || area.maxVolunteers || 1;
                              const isFull = count >= maxVol;

                              return (
                                <tr key={shift.id}>
                                  <td>
                                    <span className="station-print-time-badge">{timeLabel}</span>
                                    {shift.daySlot?.label && (
                                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{shift.daySlot.label}</div>
                                    )}
                                  </td>
                                  <td>
                                    {assignedVS.length > 0 ? (
                                      <div className="station-print-volunteer-list">
                                        {assignedVS.map(vs => {
                                          const hName = vs.user?.name ? formatHelperName(vs.user.name, nameMode) : 'Helfer eingetragen';
                                          return (
                                            <div key={vs.id} className="station-print-volunteer-item">
                                              <span>👤 {hName}</span>
                                              {showPhone && vs.user?.phone && (
                                                <span className="station-print-phone-tag">📞 {vs.user.phone}</span>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {count < maxVol && (
                                          <div className="station-print-empty-slot">
                                            ➕ {maxVol - count} weitere(r) Platz/Plätze frei
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="station-print-empty-slot">
                                        ⚠️ Noch unbesetzt ({maxVol} Helfer gesucht)
                                      </div>
                                    )}
                                  </td>
                                  {showSignature && (
                                    <td>
                                      <div className="station-print-sign-box" />
                                    </td>
                                  )}
                                  <td style={{ textAlign: 'center', fontWeight: 700 }}>
                                    <span style={{ color: isFull ? '#16a34a' : '#d97706' }}>
                                      {count} / {maxVol}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  {/* Station Instructions / Notes */}
                  {stationNote.trim() && (
                    <div className="station-print-notes-section">
                      <div className="station-print-notes-title">
                        <span>📌</span>
                        <span>Hinweise & Anweisungen für diese Station:</span>
                      </div>
                      <div>{stationNote}</div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="station-print-footer">
                  <KontakteFooter kontakte={kontakte} />
                  <div className="station-print-footer-meta">
                    <div>TSV Holm Planungs Tool &bull; Dienstplan Arbeitsstation <strong>{area.name}</strong></div>
                    <div>Stand: {new Date().toLocaleString('de-DE')}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
