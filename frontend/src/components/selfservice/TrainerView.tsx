import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiFetch } from '../../api';
import '../../styles/components/dashboard.css';

interface LayoutContext {
  clubPrimary: string;
  clubSecondary: string;
  clubAccent: string;
  selectedTournamentId: number | null;
}

type Bereich = 'jobs' | 'verpflegung' | 'beteiligung';

interface Beteiligung {
  id: number;
  name: string;
  helfer: number;
  schichten: number;
  stunden: number;
  kinder: number;
  stundenProKind: number | null;
  personen: { userId: number; name: string; schichten: number; stunden: number }[];
  ohneBeteiligung: { userId: number; name: string; phone: string | null }[];
  lastAnteilObereHaelfte: number | null;
}

interface TrainerData {
  trainedYearGroups: { id: number; name: string }[];
  foodDonationSlots: any[];
  volunteerShifts: any[];
  beteiligung?: Beteiligung[];
}

const minToTime = (min: number | null | undefined) => {
  if (min == null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
};

/** Fortschrittsbalken wie im Dashboard - gleiche Klassen, damit die Optik traegt. */
function FillBar({ assigned, max }: { assigned: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, assigned / max) : 0;
  const color = ratio >= 1 ? '#198754' : ratio > 0 ? '#ffc107' : '#dc3545';
  return (
    <div className="dashboard-progress-bg">
      <div className="dashboard-progress-fill" style={{ width: `${ratio * 100}%`, background: color }} />
    </div>
  );
}

/**
 * Trainer-Ansicht: was die Eltern des eigenen Jahrgangs zugesagt haben.
 *
 * Bewusst eine eigene Seite und kein dritter Reiter im Dashboard: die beiden
 * Dashboard-Reiter zeigen, wofuer ich mich selbst eintragen kann - hier geht
 * es um die Zusagen anderer. Erreichbar ueber das Menue, genau wie der
 * Admin-Bereich, der ebenfalls ein Rollenwechsel ist.
 */
export default function TrainerView() {
  const { volunteer } = useUser();
  const { clubPrimary, clubSecondary, clubAccent, selectedTournamentId } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();

  // Gleiche Aufteilung wie im Dienstplan: Jobs und Verpflegung sind auch hier
  // zwei gleichrangige Inhaltsbereiche. Reiterzeile und Klassen sind bewusst
  // dieselben wie dort (dashboard-tabs-wrapper / dashboard-pill-tab), damit es
  // nicht nur aehnlich aussieht, sondern identisch bleibt.
  const [bereich, setBereich] = useState<Bereich>('jobs');
  // Ebene ueber den Reitern: erst der Jahrgang, dann Jobs/Verpflegung.
  // null = noch nicht gewaehlt, wird gesetzt sobald die Daten da sind.
  const [jahrgangId, setJahrgangId] = useState<number | null>(null);

  const [data, setData] = useState<TrainerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      setLoading(true);
      try {
        const tId = selectedTournamentId || volunteer?.tournamentId;
        const url = tId ? `/api/self/trainer-dashboard?tournamentId=${tId}` : '/api/self/trainer-dashboard';
        const d = await apiFetch(url);
        if (!abgebrochen) { setData(d); setError(null); }
      } catch (e: any) {
        if (!abgebrochen) setError(e?.message || 'Die Trainer-Daten konnten nicht geladen werden.');
      } finally {
        if (!abgebrochen) setLoading(false);
      }
    })();
    return () => { abgebrochen = true; };
  }, [selectedTournamentId, volunteer?.tournamentId]);

  const jahrgaenge = data?.trainedYearGroups || [];

  // Sobald die Daten da sind, den ersten Jahrgang vorauswählen - und eine
  // Auswahl verwerfen, die nach einem Turnierwechsel nicht mehr existiert.
  useEffect(() => {
    if (jahrgaenge.length === 0) { setJahrgangId(null); return; }
    if (jahrgangId === null || !jahrgaenge.some(yg => yg.id === jahrgangId)) {
      setJahrgangId(jahrgaenge[0].id);
    }
  }, [jahrgaenge, jahrgangId]);

  const slotsDesJahrgangs = (data?.foodDonationSlots || []).filter(s => s.yearGroupId === jahrgangId);
  const schichtenDesJahrgangs = (data?.volunteerShifts || []).filter(vs => (vs.yearGroupIds || []).includes(jahrgangId));
  const beteiligungDesJahrgangs = (data?.beteiligung || []).find(b => b.id === jahrgangId) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Kontextleiste: macht den Rollenwechsel sichtbar, statt ihn nur zu behaupten */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: clubPrimary, color: '#fff',
        borderRadius: 12, padding: '12px 14px'
      }}>
        <button
          onClick={() => navigate('/')}
          aria-label="Zurück zum Dienstplan"
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, width: 36, height: 36, fontSize: 18, cursor: 'pointer', flexShrink: 0 }}
        >←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.85 }}>Trainer-Ansicht</div>
          <div style={{ fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>
            {jahrgaenge.length > 0 ? jahrgaenge.map(yg => yg.name).join(', ') : 'Kein Jahrgang zugewiesen'}
          </div>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Lade…</p>}

      {error && (
        <div style={{ background: '#f8d7da', color: '#842029', border: '1px solid #f5c2c7', borderRadius: 12, padding: 14, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && jahrgaenge.length === 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, fontSize: 14, color: 'var(--text-muted)' }}>
          Dir ist noch kein Jahrgang zugewiesen. Ein Administrator kann das in der Benutzerverwaltung nachtragen.
        </div>
      )}

      {!loading && !error && jahrgaenge.length > 0 && data && (
        <>
          {/* Ebene 1: Jahrgang. Nur bei mehr als einem betreuten Jahrgang -
              bei genau einem waere die Zeile reine Platzverschwendung, der
              Jahrgang steht ohnehin in der Kopfleiste. */}
          {jahrgaenge.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {jahrgaenge.map(yg => {
                const aktiv = yg.id === jahrgangId;
                return (
                  <button
                    key={yg.id}
                    onClick={() => setJahrgangId(yg.id)}
                    style={{
                      flex: '0 0 auto', padding: '8px 14px', minHeight: 40, borderRadius: 999,
                      border: `1px solid ${aktiv ? clubPrimary : 'var(--border-color)'}`,
                      background: aktiv ? clubPrimary : 'var(--bg-surface)',
                      color: aktiv ? '#fff' : 'var(--text-muted)',
                      fontSize: 14, fontWeight: aktiv ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap'
                    }}
                  >{yg.name}</button>
                );
              })}
            </div>
          )}

          {/* Ebene 2: identische Reiterzeile wie im Dienstplan. Die Anzahl
              steht mit im Reiter und bezieht sich auf den gewählten Jahrgang,
              damit der Ueberblick nicht verloren geht, den das Untereinander
              vorher geboten hat. */}
          <div className="dashboard-tabs-wrapper">
            <button
              onClick={() => setBereich('jobs')}
              className={`dashboard-pill-tab ${bereich === 'jobs' ? 'active' : ''}`}
              style={{ background: bereich === 'jobs' ? clubSecondary : 'var(--bg-surface)', color: bereich === 'jobs' ? '#fff' : 'var(--text-muted)' }}
            >📋 Jobs ({schichtenDesJahrgangs.length})</button>
            <button
              onClick={() => setBereich('verpflegung')}
              className={`dashboard-pill-tab ${bereich === 'verpflegung' ? 'active' : ''}`}
              style={{ background: bereich === 'verpflegung' ? clubSecondary : 'var(--bg-surface)', color: bereich === 'verpflegung' ? '#fff' : 'var(--text-muted)' }}
            >🍔 Verpflegung ({slotsDesJahrgangs.length})</button>
            <button
              onClick={() => setBereich('beteiligung')}
              className={`dashboard-pill-tab ${bereich === 'beteiligung' ? 'active' : ''}`}
              style={{ background: bereich === 'beteiligung' ? clubSecondary : 'var(--bg-surface)', color: bereich === 'beteiligung' ? '#fff' : 'var(--text-muted)' }}
            >📊 Beteiligung</button>
          </div>

          <section style={{ display: bereich === 'verpflegung' ? 'block' : 'none' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 17, color: 'var(--text-main)' }}>Verpflegungsspenden</h3>
            {slotsDesJahrgangs.length > 0 ? (
              <div className="dashboard-shifts-grid">
                {slotsDesJahrgangs.map(slot => {
                  const isDone = (slot.targetQuantity - slot.collected) <= 0;
                  return (
                    <div key={slot.id} className="dashboard-shift-card" style={{ borderLeft: `6px solid ${isDone ? '#198754' : clubAccent}`, cursor: 'default' }}>
                      <div className="dashboard-shift-card-inner">
                        <div className="dashboard-shift-title">
                          <span>{slot.foodItem?.icon || '🍔'}</span> <span>{slot.foodItem?.name || '–'}</span>
                        </div>
                        {/* Der Jahrgang stand hier vorher - seit oben danach
                            gefiltert wird, waere er nur Wiederholung. */}
                        {slot.foodItem?.unit && (
                          <div className="dashboard-shift-time">
                            <span>Einheit: {slot.foodItem.unit}</span>
                          </div>
                        )}
                      </div>

                      <div className="dashboard-shift-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <div className="dashboard-shift-remaining" style={{ color: isDone ? '#198754' : 'var(--text-main)', alignSelf: 'flex-end' }}>
                          {slot.collected}/{slot.targetQuantity}
                        </div>
                        {slot.donations && slot.donations.length > 0 && (
                          <div style={{ fontSize: 13, background: 'var(--bg-main)', padding: 10, borderRadius: 8 }}>
                            <strong style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Spender</strong>
                            {slot.donations.map((d: any) => (
                              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                                  {d.quantity}× {d.user?.name || 'Unbekannt'}{d.note ? ` (${d.note})` : ''}
                                </span>
                                {d.user?.phone && (
                                  <a href={`tel:${d.user.phone}`} style={{ color: clubPrimary, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>📞</a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <FillBar assigned={slot.collected} max={slot.targetQuantity || 0} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Keine Spendenaufrufe für diesen Jahrgang.</p>
            )}
          </section>

          <section style={{ display: bereich === 'jobs' ? 'block' : 'none' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 17, color: 'var(--text-main)' }}>Helfer-Schichten der Eltern</h3>
            {schichtenDesJahrgangs.length > 0 ? (
              <div className="dashboard-shifts-grid">
                {schichtenDesJahrgangs.map(vs => (
                  <div key={vs.id} className="dashboard-shift-card" style={{ borderLeft: `6px solid ${clubAccent}`, cursor: 'default' }}>
                    <div className="dashboard-shift-card-inner">
                      <div className="dashboard-shift-title">
                        <span>{vs.shift?.workArea?.icon || '👷'}</span> <span>{vs.user?.name}</span>
                      </div>
                      <div className="dashboard-shift-time">
                        <span>
                          {new Date(vs.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                          {' • '}
                          {vs.shift?.startMin != null && vs.shift?.endMin != null
                            ? `${minToTime(vs.shift.startMin)}–${minToTime(vs.shift.endMin)}`
                            : (vs.shift?.daySlot ? `${minToTime(vs.shift.daySlot.startMin)}–${minToTime(vs.shift.daySlot.endMin)}` : '')}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                        {vs.shift?.workArea?.name || 'Allgemein'}
                      </div>
                      {vs.user?.phone && (
                        <a href={`tel:${vs.user.phone}`} style={{ marginTop: 8, fontSize: 14, color: clubPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32 }}>
                          📞 {vs.user.phone}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Noch keine Schichten von Eltern dieses Jahrgangs übernommen.</p>
            )}
          </section>

          {/* Beteiligung: beantwortet eine andere Frage als die Schichtliste -
              nicht "wer macht wann was", sondern "wie verteilt sich die Last
              und wen kann ich noch fragen". */}
          <section style={{ display: bereich === 'beteiligung' ? 'block' : 'none' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 17, color: 'var(--text-main)' }}>Beteiligung im Jahrgang</h3>

            {!beteiligungDesJahrgangs ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                Für diesen Jahrgang liegen noch keine Zahlen vor.
              </p>
            ) : (
              <div className="trainer-beteiligung">
                <div className="trainer-kennzahlen">
                  <div className="trainer-kennzahl">
                    <span className="trainer-kennzahl-wert">{beteiligungDesJahrgangs.helfer}</span>
                    <span className="trainer-kennzahl-label">Eltern im Einsatz</span>
                  </div>
                  <div className="trainer-kennzahl">
                    <span className="trainer-kennzahl-wert">
                      {beteiligungDesJahrgangs.stunden.toLocaleString('de-DE')} h
                    </span>
                    <span className="trainer-kennzahl-label">Stunden gesamt</span>
                  </div>
                  {beteiligungDesJahrgangs.stundenProKind !== null && (
                    <div className="trainer-kennzahl">
                      <span className="trainer-kennzahl-wert">
                        {beteiligungDesJahrgangs.stundenProKind.toLocaleString('de-DE')} h
                      </span>
                      <span className="trainer-kennzahl-label">je Kind</span>
                    </div>
                  )}
                </div>

                {beteiligungDesJahrgangs.lastAnteilObereHaelfte !== null && (
                  <p className="trainer-hinweis">
                    Die aktivere Hälfte trägt{' '}
                    <strong>{beteiligungDesJahrgangs.lastAnteilObereHaelfte} %</strong> der Stunden.
                  </p>
                )}

                <h4 className="trainer-untertitel">
                  Wer mitgemacht hat ({beteiligungDesJahrgangs.personen.length})
                </h4>
                <ol className="trainer-liste">
                  {beteiligungDesJahrgangs.personen.map(pp => (
                    <li key={pp.userId}>
                      <span>{pp.name}</span>
                      <span className="trainer-liste-wert">
                        {pp.stunden.toLocaleString('de-DE')} h · {pp.schichten} Sch.
                      </span>
                    </li>
                  ))}
                  {beteiligungDesJahrgangs.personen.length === 0 && (
                    <li style={{ color: 'var(--text-muted)' }}>noch niemand</li>
                  )}
                </ol>

                <h4 className="trainer-untertitel">
                  Noch nicht dabei ({beteiligungDesJahrgangs.ohneBeteiligung.length})
                </h4>
                {beteiligungDesJahrgangs.ohneBeteiligung.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    Alle erfassten Familien dieses Jahrgangs haben etwas übernommen.
                  </p>
                ) : (
                  <>
                    <ul className="trainer-liste trainer-liste--offen">
                      {beteiligungDesJahrgangs.ohneBeteiligung.map(pp => (
                        <li key={pp.userId}>
                          <span>{pp.name}</span>
                          {pp.phone && (
                            <a href={`tel:${pp.phone}`} className="trainer-anruf" style={{ color: clubPrimary }}>
                              📞 {pp.phone}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="trainer-hinweis">
                      Als Gesprächsgrundlage gedacht – wer hier steht, wurde vielleicht schlicht
                      noch nicht gefragt. Aufgeführt sind nur Familien mit Konto und hinterlegtem
                      Kind; wer beides nicht hat, fehlt in der Liste.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
