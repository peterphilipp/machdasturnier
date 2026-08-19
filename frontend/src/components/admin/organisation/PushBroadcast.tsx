import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getVolunteers, getShifts, getVolunteerShifts, broadcastPush } from '../../../api';
import { Shift, VolunteerShift, minToTime, inputStyle, btnStyle } from '../shared';
import { modal } from '../Modal';
import { useIsMobile } from '../../../hooks/useIsMobile';

export default function PushBroadcast({ selectedTournament }: { selectedTournament: number | null }) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<'all' | 'shifts' | 'users'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  // Freitextsuche über die Helferliste. Bei über fünfzig Namen ist Scrollen
  // keine Auswahl mehr, sondern Suchen von Hand.
  const [helferSuche, setHelferSuche] = useState('');
  const [selectedShiftIds, setSelectedShiftIds] = useState<number[]>([]);
  const [title, setTitle] = useState('Wichtige Info zum Turnier');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [sending, setSending] = useState(false);

  const { data: volunteers = [], isLoading: loadingVolunteers } = useQuery<any[]>({
    queryKey: ['volunteers', selectedTournament],
    queryFn: () => getVolunteers(selectedTournament),
    enabled: !!selectedTournament && (mode === 'users' || mode === 'all')
  });

  const gefilterteVolunteers = volunteers.filter(v => {
    const q = helferSuche.trim().toLowerCase();
    if (!q) return true;
    return (v.name || '').toLowerCase().includes(q) || (v.email || '').toLowerCase().includes(q);
  });

  const { data: shifts = [], isLoading: loadingShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', selectedTournament],
    queryFn: () => getShifts(selectedTournament),
    enabled: !!selectedTournament && mode === 'shifts'
  });

  const { data: volunteerShifts = [] } = useQuery<VolunteerShift[]>({
    queryKey: ['volunteerShifts', selectedTournament],
    queryFn: () => getVolunteerShifts(selectedTournament),
    enabled: !!selectedTournament && mode === 'shifts'
  });

  // Sort shifts by date and startMin
  const sortedShifts = useMemo(() => {
    return [...shifts].sort((a: any, b: any) => {
      const dateA = a.day?.date || a.date;
      const dateB = b.day?.date || b.date;
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const startA = a.startMin ?? a.daySlot?.startMin ?? 0;
      const startB = b.startMin ?? b.daySlot?.startMin ?? 0;
      return startA - startB;
    });
  }, [shifts]);

  // Calculate estimated recipients for shifts mode
  const estimatedShiftRecipients = useMemo(() => {
    if (mode !== 'shifts' || selectedShiftIds.length === 0) return 0;
    const assignedUserIds = new Set(
      volunteerShifts
        .filter(vs => vs.shiftId && selectedShiftIds.includes(vs.shiftId))
        .map(vs => vs.userId)
    );
    return assignedUserIds.size;
  }, [mode, selectedShiftIds, volunteerShifts]);

  if (!selectedTournament) {
    return (
      <div className="push-broadcast-empty">
        <div className="push-broadcast-empty-icon">🔔</div>
        <div className="push-broadcast-empty-title">Bitte ein Turnier auswählen</div>
        <div className="push-broadcast-empty-subtitle">Wähle oben ein Turnier aus, um Push-Nachrichten an Helfer zu senden</div>
      </div>
    );
  }

  const handleToggleUser = (id: number) => {
    setSelectedUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleToggleShift = (id: number) => {
    setSelectedShiftIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      return await modal.alert({ title: 'Hinweis', message: 'Bitte Titel und Nachrichtentext ausfüllen.' });
    }
    if (mode === 'users' && selectedUserIds.length === 0) {
      return await modal.alert({ title: 'Hinweis', message: 'Bitte mindestens einen Helfer auswählen.' });
    }
    if (mode === 'shifts' && selectedShiftIds.length === 0) {
      return await modal.alert({ title: 'Hinweis', message: 'Bitte mindestens eine Schicht auswählen.' });
    }

    const recipientText = mode === 'all'
      ? `${volunteers.length} Helfer dieses Turniers`
      : mode === 'shifts'
      ? `${estimatedShiftRecipients} Helfer aus ${selectedShiftIds.length} Schichten`
      : `${selectedUserIds.length} ausgewählte Helfer`;

    if (!(await modal.confirm({
      title: 'Push-Nachricht senden?',
      message: `Möchtest du diese Nachricht jetzt an ${recipientText} absenden?\n\nTitel: "${title}"\nText: "${body}"`
    }))) {
      return;
    }

    setSending(true);
    try {
      const res = await broadcastPush({
        mode,
        userIds: mode === 'users' ? selectedUserIds : undefined,
        shiftIds: mode === 'shifts' ? selectedShiftIds : undefined,
        tournamentId: selectedTournament,
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || '/'
      }) as any;

      await modal.alert({
        title: 'Erfolgreich gesendet 🎉',
        message: `Die Nachricht wurde an ${res.targetedUsers || 0} Helfer weitergeleitet.\n\nDavon wurden ${res.sentPushCount || 0} aktive PWA-Geräte direkt erreicht!`
      });
      setBody('');
    } catch (err: any) {
      await modal.alert({ title: 'Fehler', message: err?.message || 'Konnte Push-Nachricht nicht senden.' });
    } finally {
      setSending(false);
    }
  };

  const applyPreset = (presetTitle: string, presetBody: string, presetMode: 'all' | 'shifts' | 'users' = 'all') => {
    setTitle(presetTitle);
    setBody(presetBody);
    setMode(presetMode);
  };

  return (
    <div className="push-broadcast-container" style={{ paddingBottom: isMobile ? 80 : undefined }}>
      <div className="push-broadcast-card">
        <h2 className="push-broadcast-title">
          <span>🔔</span> Helfer per PWA Push kontaktieren
        </h2>
        <p className="push-broadcast-description">
          Sende Sofort-Benachrichtigungen direkt auf die Geräte deiner Helfer. Keine E-Mails erforderlich!
        </p>

        {/* Schnell-Vorlagen / Presets */}
        <div style={{ marginBottom: 12, fontWeight: 'bold', fontSize: 13, color: '#495057' }}>⚡ Schnell-Vorlagen (1-Tipp):</div>
        <div className="mobile-preset-chips-container">
          <button
            type="button"
            className="mobile-preset-chip"
            onClick={() => applyPreset('Wichtige Info zum Turnier', 'Hallo zusammen! Hier ist eine wichtige Information zum Turnierverlauf.', 'all')}
          >
            📢 Wichtige Info
          </button>
          <button
            type="button"
            className="mobile-preset-chip"
            onClick={() => applyPreset('⚠️ Dringend: Schicht besetzen', 'Wir suchen aktuell noch Unterstützung für Schichten. Wer kann spontan einspringen?', 'all')}
          >
            ⚠️ Schichten besetzen
          </button>
          <button
            type="button"
            className="mobile-preset-chip"
            onClick={() => applyPreset('⏰ Schicht-Erinnerung', 'Erinnerung: Deine Schicht steht in Kürze an. Bitte denke an dein Pünktlichsein! Danke!', 'all')}
          >
            ⏰ Schicht-Erinnerung
          </button>
          <button
            type="button"
            className="mobile-preset-chip"
            onClick={() => applyPreset('🍕 Verpflegungs-Info', 'Vielen Dank für alle Spenden und die Unterstützung am Verpflegungsstand!', 'all')}
          >
            🍕 Verpflegung & Danke
          </button>
        </div>

        <div className="push-broadcast-section">
          <label className="push-broadcast-section-label">1. Zielgruppe wählen:</label>
          <div className={`push-broadcast-mode-grid ${isMobile ? 'push-broadcast-mode-grid-mobile' : 'push-broadcast-mode-grid-desktop'}`}>
            {[
              { id: 'all', label: '📢 Alle Helfer im Turnier', desc: 'An alle registrierten Helfer' },
              { id: 'shifts', label: '🧩 Schichten auswählen', desc: 'An Helfer bestimmter Schichten' },
              { id: 'users', label: '👤 Einzelne Helfer', desc: 'Gezielt Personen auswählen' }
            ].map(item => (
              <div
                key={item.id}
                onClick={() => setMode(item.id as any)}
                className={`push-broadcast-mode-item ${isMobile ? 'push-broadcast-mode-item-mobile' : ''} ${mode === item.id ? 'push-broadcast-mode-item-active' : ''}`}
              >
                <div className={`push-broadcast-mode-label ${isMobile ? 'push-broadcast-mode-label-mobile' : ''} ${mode === item.id ? 'push-broadcast-mode-label-active' : ''}`}>
                  {item.label}
                </div>
                <div className="push-broadcast-mode-desc">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bedingte Anzeige: Alle Helfer - zeigt VOR dem Versand konkret, wer
            gemeint ist (nur Helfer dieses Turniers, nie die ganze Datenbank),
            statt sich auf eine vage Beschreibung verlassen zu müssen. */}
        {mode === 'all' && (
          <div className="push-broadcast-selection-panel">
            <div className="push-broadcast-selection-header-simple">
              <strong className="push-broadcast-selection-title">Diese Helfer werden informiert:</strong>
              <span className="push-broadcast-badge">
                {volunteers.length} Helfer dieses Turniers
              </span>
            </div>

            {loadingVolunteers ? (
              <div className="push-broadcast-loading">⏳ Lade Helfer...</div>
            ) : volunteers.length === 0 ? (
              <div className="push-broadcast-empty-state">Diesem Turnier sind noch keine Helfer zugeordnet.</div>
            ) : (
              <div className="push-broadcast-list">
                {volunteers.map(v => (
                  <div
                    key={v.id}
                    className={`push-broadcast-list-item ${isMobile ? 'push-broadcast-list-item-mobile' : ''}`}
                  >
                    <div>
                      <strong className="push-broadcast-item-name">{v.name}</strong>
                      {v.email && <span className="push-broadcast-item-email">({v.email})</span>}
                    </div>
                    {v.role && <span className="push-broadcast-role-badge">{v.role}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bedingte Auswahl: Schichten */}
        {mode === 'shifts' && (
          <div className="push-broadcast-selection-panel">
            <div className="push-broadcast-selection-header-flex">
              <div>
                <strong className="push-broadcast-selection-title">Schichten anhaken:</strong>
                <span className="push-broadcast-badge">
                  Empfänger: ca. {estimatedShiftRecipients} Helfer ({selectedShiftIds.length} Schichten)
                </span>
              </div>
              <div className="push-broadcast-actions">
                <button
                  onClick={() => setSelectedShiftIds(sortedShifts.map(s => s.id))}
                  className="push-broadcast-action-btn"
                >
                  Alle auswählen
                </button>
                <button
                  onClick={() => setSelectedShiftIds([])}
                  className="push-broadcast-action-btn push-broadcast-action-btn-danger"
                >
                  Auswahl aufheben
                </button>
              </div>
            </div>

            {loadingShifts ? (
              <div className="push-broadcast-loading">⏳ Lade Schichten...</div>
            ) : sortedShifts.length === 0 ? (
              <div className="push-broadcast-empty-state">Keine Schichten in diesem Turnier vorhanden.</div>
            ) : (
              <div className="push-broadcast-list">
                {sortedShifts.map((s: any) => {
                  const shiftDate = s.day?.date || s.date;
                  const startMin = s.startMin ?? s.daySlot?.startMin ?? 0;
                  const endMin = s.endMin ?? s.daySlot?.endMin ?? 0;
                  const roleName = s.workArea?.name || s.arbeitsbereich?.name || 'Helfer';
                  const areaIcon = s.workArea?.icon || s.arbeitsbereich?.icon || '🔹';
                  const assignedCount = volunteerShifts.filter(vs => vs.shiftId === s.id).length;
                  const isChecked = selectedShiftIds.includes(s.id);

                  return (
                    <label
                      key={s.id}
                      className={`push-broadcast-list-item push-broadcast-list-item-selectable ${isMobile ? 'push-broadcast-list-item-mobile' : ''} ${isChecked ? 'push-broadcast-list-item-checked' : ''}`}
                    >
                      <div className="push-broadcast-list-item-content">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleShift(s.id)}
                          className={`push-broadcast-checkbox ${isMobile ? 'push-broadcast-checkbox-mobile' : ''}`}
                        />
                        <div>
                          <strong className="push-broadcast-item-name">{areaIcon} {roleName}</strong>
                          <span className="push-broadcast-shift-details">
                            📅 {new Date(shiftDate).toLocaleDateString('de-DE')} | ⏰ {minToTime(startMin)}-{minToTime(endMin)}
                          </span>
                        </div>
                      </div>
                      <span className={`push-broadcast-assigned-badge ${assignedCount > 0 ? 'push-broadcast-assigned-badge-has' : 'push-broadcast-assigned-badge-empty'}`}>
                        {assignedCount} {assignedCount === 1 ? 'Helfer' : 'Helfer'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Bedingte Auswahl: Einzelne Helfer */}
        {mode === 'users' && (
          <div className="push-broadcast-selection-panel">
            <div className="push-broadcast-selection-header-flex">
              <div>
                <strong className="push-broadcast-selection-title">Helfer auswählen:</strong>
                <span className="push-broadcast-badge">
                  Ausgewählt: {selectedUserIds.length} von {volunteers.length}
                </span>
              </div>
              <div className="push-broadcast-actions">
                <button
                  onClick={() => setSelectedUserIds(prev => Array.from(
                    new Set([...(helferSuche ? prev : []), ...gefilterteVolunteers.map(v => v.id)])
                  ))}
                  className="push-broadcast-action-btn"
                >
                  {helferSuche ? 'Alle Treffer auswählen' : 'Alle auswählen'}
                </button>
                <button
                  onClick={() => setSelectedUserIds([])}
                  className="push-broadcast-action-btn push-broadcast-action-btn-danger"
                >
                  Auswahl aufheben
                </button>
              </div>
            </div>

            <input
              value={helferSuche}
              onChange={e => setHelferSuche(e.target.value)}
              placeholder="🔍 Name oder E-Mail suchen …"
              className="push-broadcast-input"
              style={{ ...inputStyle, marginBottom: 10 }}
            />

            {loadingVolunteers ? (
              <div className="push-broadcast-loading">⏳ Lade Helfer...</div>
            ) : volunteers.length === 0 ? (
              <div className="push-broadcast-empty-state">Keine Helfer gefunden.</div>
            ) : gefilterteVolunteers.length === 0 ? (
              <div className="push-broadcast-empty-state">Niemand passt zu „{helferSuche}".</div>
            ) : (
              <div className="push-broadcast-list">
                {gefilterteVolunteers.map(v => {
                  const isChecked = selectedUserIds.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`push-broadcast-list-item push-broadcast-list-item-selectable ${isMobile ? 'push-broadcast-list-item-mobile' : ''} ${isChecked ? 'push-broadcast-list-item-checked' : ''}`}
                    >
                      <div className="push-broadcast-list-item-content">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleUser(v.id)}
                          className={`push-broadcast-checkbox ${isMobile ? 'push-broadcast-checkbox-mobile' : ''}`}
                        />
                        <div>
                          <strong className="push-broadcast-item-name">{v.name}</strong>
                          {v.email && <span className="push-broadcast-item-email">({v.email})</span>}
                        </div>
                      </div>
                      {v.role && <span className="push-broadcast-role-badge">{v.role}</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Nachrichten-Inhalt */}
        <div className="push-broadcast-section">
          <label className="push-broadcast-section-label">2. Nachricht verfassen:</label>
          
          <div className="push-broadcast-input-group">
            <label className="push-broadcast-input-label">Titel (Betreff):</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="z.B. Aufbau verschiebt sich um 30 Min"
              style={inputStyle}
              className="push-broadcast-input"
            />
          </div>

          <div className="push-broadcast-input-group">
            <label className="push-broadcast-input-label">Nachrichtentext:</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Gib hier deine Nachricht an die Helfer ein..."
              rows={isMobile ? 6 : 4}
              style={inputStyle}
              className={`push-broadcast-textarea ${isMobile ? 'push-broadcast-textarea-mobile' : ''}`}
            />
          </div>

          <div>
            <label className="push-broadcast-input-label">Ziel-URL beim Klick (optional):</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="/"
              style={inputStyle}
              className="push-broadcast-input"
            />
            <span className="push-broadcast-input-hint">Wohin soll der Helfer in der PWA geleitet werden, wenn er die Benachrichtigung anklickt?</span>
          </div>
        </div>

        {/* Absenden Button */}
        <div className={`push-broadcast-footer ${isMobile ? 'push-broadcast-footer-mobile' : 'push-broadcast-footer-desktop'}`}>
          <button
            onClick={handleSend}
            disabled={sending || !title.trim() || !body.trim()}
            style={btnStyle}
            className={`push-broadcast-submit-btn ${isMobile ? 'push-broadcast-submit-btn-mobile' : ''} ${sending || !title.trim() || !body.trim() ? 'push-broadcast-submit-btn-disabled' : ''}`}
          >
            <span>{sending ? '⏳' : '🚀'}</span>
            <span>{sending ? 'Versende Push-Nachrichten...' : 'Push-Nachricht jetzt absenden'}</span>
          </button>
        </div>
      </div>

      {isMobile && (
        <div className="mobile-sticky-push-bar">
          <div>
            <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 'bold' }}>EMPFÄNGER</div>
            <div style={{ fontSize: 13, fontWeight: '700', color: '#212529' }}>
              {mode === 'all' ? `${volunteers.length} Helfer` : mode === 'shifts' ? `${estimatedShiftRecipients} Helfer` : `${selectedUserIds.length} Helfer`}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !title.trim() || !body.trim()}
            style={{
              background: sending || !title.trim() || !body.trim() ? '#adb5bd' : '#0d6efd',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 20,
              fontWeight: 'bold',
              fontSize: 14,
              cursor: sending || !title.trim() || !body.trim() ? 'not-allowed' : 'pointer',
              boxShadow: sending || !title.trim() || !body.trim() ? 'none' : '0 4px 12px rgba(13,110,253,0.3)'
            }}
          >
            {sending ? '⏳ Senden...' : '🚀 Push Senden'}
          </button>
        </div>
      )}
    </div>
  );
}
