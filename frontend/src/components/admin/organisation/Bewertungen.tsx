import { useState, useEffect } from 'react';
import { apiFetch } from '../../../api';
import { Ladefehler } from '../../Verbindung';
import '../../../styles/components/dashboard.css';

/**
 * Was die Helfer nach ihren Schichten zurueckgemeldet haben.
 *
 * Lag frueher als Modal hinter dem eingeklappten Abschnitt zur
 * Dienstplan-Generierung - dort hat es praktisch niemand gefunden. Als eigener
 * Reiter ist es das, was es sein soll: eine Seite, auf die man nach dem
 * Turnier geht.
 *
 * Die Durchschnitte kommen fertig vom Server. Sie hier ein zweites Mal zu
 * rechnen hiess frueher, denselben Fehler an zwei Stellen zu pflegen.
 */

interface FeedbackItem {
  id: number;
  ratingWorkload?: number | null;
  ratingOrganization?: number | null;
  ratingFun?: number | null;
  ratingComment?: string | null;
  date: string;
  slot: string;
  role: string;
  user?: { id: number; name: string; email?: string | null } | null;
  shift?: {
    startMin?: number | null;
    endMin?: number | null;
    workArea?: { id?: number; name?: string; icon?: string } | null;
  } | null;
}

interface Auswertung {
  workAreaName: string;
  workAreaIcon: string;
  totalRatings: number;
  avgWorkload: number | null;
  avgOrganization: number | null;
  avgFun: number | null;
}

interface Props {
  selectedTournament: number | null;
}

/**
 * Der Stress-Wert ist der einzige, bei dem hoch schlecht ist - deshalb bekommt
 * er als einziger eine Einordnung statt einer nackten Zahl.
 */
function StressBadge({ wert }: { wert: number | null }) {
  if (wert === null) return <span className="feedback-badge-empty">–</span>;
  if (wert >= 4.0) return <span className="feedback-badge-high">{wert} / 5 🥵 (Hoch)</span>;
  if (wert <= 1.8) return <span className="feedback-badge-low">{wert} / 5 😴 (Ruhig)</span>;
  return <span className="feedback-badge-opt">{wert} / 5 😊 (Optimal)</span>;
}

export default function Bewertungen({ selectedTournament }: Props) {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [auswertung, setAuswertung] = useState<Record<string, Auswertung>>({});
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<unknown>(null);
  const [bereichFilter, setBereichFilter] = useState<string>('all');
  // Hochzaehlen loest einen neuen Ladeversuch aus, ohne die Abbruchlogik aus
  // dem Effect herausziehen zu muessen.
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    if (!selectedTournament) {
      setFeedbacks([]);
      setAuswertung({});
      setLaedt(false);
      return;
    }

    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);

    apiFetch(`/api/volunteer-shifts/feedback?tournamentId=${selectedTournament}`)
      .then((daten: { feedbacks?: FeedbackItem[]; auswertung?: Record<string, Auswertung> }) => {
        if (abgebrochen) return;
        setFeedbacks(daten?.feedbacks || []);
        setAuswertung(daten?.auswertung || {});
      })
      .catch((err: unknown) => {
        if (!abgebrochen) setFehler(err);
      })
      .finally(() => {
        if (!abgebrochen) setLaedt(false);
      });

    // Beim schnellen Turnierwechsel darf die spaeter eintreffende Antwort der
    // vorigen Anfrage die neue nicht ueberschreiben.
    return () => { abgebrochen = true; };
  }, [selectedTournament, versuch]);

  const bereiche = Object.keys(auswertung);
  const kommentare = feedbacks.filter(f => f.ratingComment && f.ratingComment.trim().length > 0);
  const sichtbareKommentare = kommentare.filter(
    k => bereichFilter === 'all' || (k.shift?.workArea?.name || k.role) === bereichFilter
  );

  if (!selectedTournament) {
    return (
      <div className="feedback-empty">
        <div className="feedback-empty-icon">📊</div>
        <div className="feedback-empty-title">Kein Turnier ausgewählt</div>
        <div className="feedback-empty-desc">Wähle oben ein Turnier, um dessen Rückmeldungen zu sehen.</div>
      </div>
    );
  }

  if (laedt) return <div className="feedback-loading">Lade Bewertungen …</div>;
  if (fehler) return <Ladefehler was="Die Bewertungen" fehler={fehler} erneut={() => setVersuch(v => v + 1)} />;

  if (feedbacks.length === 0) {
    return (
      <div className="feedback-empty">
        <div className="feedback-empty-icon">📝</div>
        <div className="feedback-empty-title">Noch keine Bewertungen vorhanden</div>
        <div className="feedback-empty-desc">
          Sobald Helfer nach ihren Schichten eine Bewertung oder Notiz abgeben, erscheinen diese hier.
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-modal-body">
      <div>
        <h3 className="feedback-section-title">📈 Auswertung nach Arbeitsbereichen</h3>
        <div className="feedback-grid">
          {bereiche.map(name => {
            const agg = auswertung[name];
            const hoheLast = agg.avgWorkload !== null && agg.avgWorkload >= 4.0;
            return (
              <div
                key={name}
                className={`feedback-agg-card ${hoheLast ? 'feedback-agg-card-highload' : 'feedback-agg-card-normal'}`}
              >
                <div className="feedback-agg-header">
                  <span className="feedback-agg-icon">{agg.workAreaIcon}</span>
                  <strong className="feedback-agg-title">{agg.workAreaName}</strong>
                  <span className="feedback-agg-count">
                    {agg.totalRatings} {agg.totalRatings === 1 ? 'Bewertung' : 'Bewertungen'}
                  </span>
                </div>

                <div className="feedback-agg-stats">
                  <div className="feedback-agg-stat-row">
                    <span className="feedback-agg-stat-label">Stress / Auslastung:</span>
                    <StressBadge wert={agg.avgWorkload} />
                  </div>
                  <div className="feedback-agg-stat-row">
                    <span className="feedback-agg-stat-label">Organisation / Info:</span>
                    <span className="feedback-agg-stat-value">
                      {agg.avgOrganization !== null ? `${agg.avgOrganization} / 5 ⭐` : '–'}
                    </span>
                  </div>
                  <div className="feedback-agg-stat-row">
                    <span className="feedback-agg-stat-label">Spaß / Stimmung:</span>
                    <span className="feedback-agg-stat-value">
                      {agg.avgFun !== null ? `${agg.avgFun} / 5 🤩` : '–'}
                    </span>
                  </div>
                </div>

                {hoheLast && (
                  <div className="feedback-learning-alert">
                    <span>💡</span>
                    <span>
                      <strong>Learning:</strong> Hohe Arbeitsbelastung. Für künftige Turniere
                      {' '}+1 Helfer oder kürzere Schichten prüfen!
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="feedback-comments-header">
          <h3 className="feedback-comments-title">
            💬 Notizen & Verbesserungsvorschläge ({kommentare.length})
          </h3>
          {bereiche.length > 1 && (
            <select
              value={bereichFilter}
              onChange={e => setBereichFilter(e.target.value)}
              className="feedback-comments-select"
              aria-label="Nach Arbeitsbereich filtern"
            >
              <option value="all">Alle Bereiche</option>
              {bereiche.map(a => (
                <option key={a} value={a}>{auswertung[a].workAreaIcon} {a}</option>
              ))}
            </select>
          )}
        </div>

        <div className="feedback-comments-list">
          {sichtbareKommentare.map(item => (
            <div key={item.id} className="feedback-comment-card">
              <div className="feedback-comment-meta">
                <div>
                  <strong className="feedback-comment-area">
                    {item.shift?.workArea?.icon || '📍'} {item.shift?.workArea?.name || item.role}
                  </strong>
                  <span className="feedback-comment-dot">•</span>
                  <span>
                    {new Date(item.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                    {' '}({item.slot})
                  </span>
                </div>
                <div className="feedback-comment-user">👤 {item.user?.name || 'Helfer'}</div>
              </div>
              <div className="feedback-comment-text">„{item.ratingComment}"</div>
              <div className="feedback-comment-ratings">
                {item.ratingWorkload != null && <span>Stress: <strong>{item.ratingWorkload}/5</strong></span>}
                {item.ratingOrganization != null && <span>Orga: <strong>{item.ratingOrganization}/5</strong></span>}
                {item.ratingFun != null && <span>Spaß: <strong>{item.ratingFun}/5</strong></span>}
              </div>
            </div>
          ))}
          {sichtbareKommentare.length === 0 && (
            <div className="feedback-comments-empty">Keine Kommentare in diesem Bereich vorhanden.</div>
          )}
        </div>
      </div>
    </div>
  );
}
