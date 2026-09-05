import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  apiFetch, getTournaments, getTournamentDays, getTournamentWorkAreas,
  getShifts, getVolunteerShifts
} from '../../../api';
import { Tournament, TournamentDay, TournamentWorkArea, VolunteerShift } from '../shared';
import '../../../styles/components/station-print.css';
import '../../../styles/components/turnierabschluss.css';

/**
 * Der Turnierabschluss als druckbares Dokument.
 *
 * Nach dem Turnier liegen die Antworten auf "wie ist es gelaufen" an vier
 * Stellen: Dienstplan, Statistik, Rueckmeldungen, Zeitverlauf. Wer im Verein
 * berichtet - im Vorstand, in der Abteilungsversammlung, gegenueber dem
 * Sponsor - muss sie heute von Hand zusammentragen. Dieses Dokument stellt
 * sie in einer Reihenfolge zusammen, die eine Geschichte erzaehlt: was
 * zusammenkam, wer es getragen hat, was die Helfer gesagt haben, wo es eng
 * war.
 *
 * Gerechnet wird nichts: alle Zahlen kommen fertig aus denselben Endpunkten,
 * die auch die Statistik- und Bewertungsansicht speisen. Eine zweite Rechnung
 * hier waere eine zweite Wahrheit.
 *
 * Druckmechanik wie beim Stationszettel (siehe StationPrintModal): Portal an
 * <body>, `druckdialog-offen` nimmt die App im Druck aus dem Layout, Masse in
 * mm. Das ist hart erarbeitet - hier wird es nur wiederverwendet.
 */

// ---------------------------------------------------------------- Datenformen
// Bewusst lokal statt aus Statistik.tsx importiert: Die Ansicht dort ist eine
// eigene Baustelle, und ein gemeinsamer Typ haette beide aneinander gekettet.
// Die Wahrheit steht ohnehin im Backend (utils/turnierStatistik.ts).

interface Kennzahl { plaetze: number; besetzt: number; offen: number; stunden: number; besetzungsgrad: number | null }
interface Bereich extends Kennzahl { name: string; icon: string }
interface Tag extends Kennzahl { datum: string }
interface Helfer { userId: number; name: string; schichten: number; stunden: number; spenden: number }

interface Jahrgang {
  id: number | null;
  name: string;
  kinder: number;
  personen: { userId: number; name: string; schichten: number; stunden: number; spenden: number }[];
  ohneBeteiligung: { userId: number; name: string }[];
  schichten: number;
  stunden: number;
  spenden: number;
  stundenProKind: number | null;
  lastAnteilObereHaelfte: number | null;
}

interface Luecke {
  shiftId: number; bereich: string; icon: string; datum: string | null;
  startMin: number | null; endMin: number | null; offen: number; besetzt: number; plaetze: number;
}

interface VerlaufAufruf {
  id: number; titel: string; empfaenger: string; erreicht: number; createdAt: string;
  reaktion: { zusagen: number; spenden: number };
}

interface Statistik {
  eckdaten: { helfer: number; beteiligte: number; spenden: number; spender: number; schichten: number; stunden: number } & Kennzahl;
  jeBereich: Bereich[];
  jeTag: Tag[];
  werHatGetragen: {
    nachStunden: Helfer[];
    nachSchichten: Helfer[];
    nachSpenden: Helfer[];
    verteilung: { eine: number; zwei: number; dreiOderMehr: number };
    schnittStundenProHelfer: number;
  };
  jahrgaenge: { liste: Jahrgang[]; mehrfachzaehlung: boolean };
  verlauf?: { aufrufe: VerlaufAufruf[]; fensterStunden: number; ohneZeitstempel: number };
  luecken: {
    jeAbschnitt: { abschnitt: string; label: string; plaetze: number; besetzt: number; offen: number; besetzungsgrad: number | null }[];
    groessteLuecken: Luecke[];
  };
}

type EmpfehlungsTon = 'warnung' | 'chance' | 'lob';

interface Auswertung {
  workAreaName: string;
  workAreaIcon: string;
  totalRatings: number;
  avgWorkload: number | null;
  avgOrganization: number | null;
  avgFun: number | null;
  empfehlungen: { ton: EmpfehlungsTon; text: string }[];
}

interface FeedbackItem {
  id: number;
  ratingComment?: string | null;
  user?: { id: number; name: string } | null;
  shift?: { workArea?: { name?: string; icon?: string } | null } | null;
}

// ------------------------------------------------------------------- Helferlein

const hhmm = (m: number | null | undefined) =>
  m == null ? '--:--' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const zahl = (n: number) => n.toLocaleString('de-DE');

const tagLang = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

const tagKurz = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '–';

/** „Anja P." - dieselbe Abkuerzung wie auf dem Stationszettel. */
function kurzName(name: string): string {
  if (!name) return 'Unbekannt';
  const teile = name.trim().split(/\s+/);
  if (teile.length === 1) return teile[0];
  return `${teile[0]} ${teile[teile.length - 1][0].toUpperCase()}.`;
}

const TON_DARSTELLUNG: Record<EmpfehlungsTon, { symbol: string; label: string }> = {
  warnung: { symbol: '💡', label: 'Learning' },
  chance:  { symbol: '↔️', label: 'Spielraum' },
  lob:     { symbol: '✅', label: 'Beibehalten' }
};

/** Unter so vielen Rueckmeldungen ist ein Mittelwert kaum belastbar. */
const BELASTBAR_AB = 3;

/** Der Stresswert ist der einzige, bei dem hoch schlecht ist. */
const stressWort = (w: number | null) =>
  w == null ? '–' : w >= 4.0 ? `${w} / 5 (hoch)` : w <= 1.8 ? `${w} / 5 (ruhig)` : `${w} / 5 (gut)`;

// ------------------------------------------------------------------ Komponente

export default function TurnierabschlussModal({
  isOpen,
  onClose,
  tournamentId
}: {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: number | null;
}) {
  const [nameMode, setNameMode] = useState<'short' | 'full'>('short');
  // Aus, weil offene Kommentare das Heikelste im ganzen Dokument sind: Sie
  // stehen namentlich zuordenbar in einem Bericht, der herumgeht. Wer sie
  // braucht, schaltet sie bewusst ein.
  const [zeigeKommentare, setZeigeKommentare] = useState(false);
  const [zeigeDienstplaene, setZeigeDienstplaene] = useState(true);
  const [dank, setDank] = useState(
    'Danke an alle, die mitgeholfen haben – ohne euch gäbe es dieses Turnier nicht.'
  );

  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add('druckdialog-offen');
    return () => document.body.classList.remove('druckdialog-offen');
  }, [isOpen]);

  const aktiv = isOpen && !!tournamentId;

  const { data: statistik, isLoading: ladeStat, error: statFehler } = useQuery<Statistik>({
    queryKey: ['statistik', tournamentId],
    queryFn: () => apiFetch(`/api/volunteer-shifts/statistik?tournamentId=${tournamentId}`),
    enabled: aktiv
  });

  const { data: feedbackDaten } = useQuery<{ feedbacks?: FeedbackItem[]; auswertung?: Record<string, Auswertung> }>({
    queryKey: ['feedback', tournamentId],
    queryFn: () => apiFetch(`/api/volunteer-shifts/feedback?tournamentId=${tournamentId}`),
    enabled: aktiv
  });

  const { data: tournaments = [] } = useQuery<Tournament[]>({
    queryKey: ['tournaments'], queryFn: getTournaments, enabled: aktiv
  });
  const { data: days = [] } = useQuery<TournamentDay[]>({
    queryKey: ['t-days', tournamentId], queryFn: () => getTournamentDays(tournamentId), enabled: aktiv
  });
  const { data: areas = [] } = useQuery<TournamentWorkArea[]>({
    queryKey: ['t-work-areas', tournamentId], queryFn: () => getTournamentWorkAreas(tournamentId), enabled: aktiv
  });
  const { data: jobSlots = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['shifts', tournamentId], queryFn: () => getShifts(tournamentId), enabled: aktiv && zeigeDienstplaene
  });
  const { data: volunteerShifts = [] } = useQuery<VolunteerShift[]>({
    queryKey: ['volunteerShifts', tournamentId], queryFn: () => getVolunteerShifts(tournamentId), enabled: aktiv
  });

  const tournament = useMemo(
    () => tournaments.find(t => t.id === tournamentId) || null,
    [tournaments, tournamentId]
  );

  /** Dienstplan-Anhang: je Bereich die Tage, je Tag die Schichten. */
  const dienstplaene = useMemo(() => {
    if (!zeigeDienstplaene) return [];
    return areas.filter(a => a.active).map(area => ({
      area,
      tage: days.map(day => ({
        day,
        shifts: jobSlots
          .filter(s =>
            s.tournamentDayId === day.id
            && (s.tournamentWorkAreaId === area.id || s.arbeitsbereichId === area.id || s.workArea?.id === area.id))
          .sort((a, b) => (a.startMin ?? a.daySlot?.startMin ?? 0) - (b.startMin ?? b.daySlot?.startMin ?? 0))
      })).filter(t => t.shifts.length > 0)
    })).filter(a => a.tage.length > 0);
  }, [zeigeDienstplaene, areas, days, jobSlots]);

  if (!isOpen) return null;

  const name = (n: string) => (nameMode === 'full' ? n : kurzName(n));
  const auswertung = feedbackDaten?.auswertung ?? {};
  const bereicheMitFeedback = Object.values(auswertung).sort((a, b) => b.totalRatings - a.totalRatings);
  const kommentare = (feedbackDaten?.feedbacks ?? []).filter(f => f.ratingComment?.trim());

  const clubLogo = tournament?.club?.logo;
  const sponsorLogo = tournament?.logo;
  const sponsorName = tournament?.sponsorName || (tournament?.hasSponsor ? 'Sponsor' : null);
  const zeitraum = days.length > 0
    ? days.length === 1
      ? tagLang(days[0].date)
      : `${tagKurz(days[0].date)} – ${tagKurz(days[days.length - 1].date)}`
    : '';

  /** Kopfzeile, die auf jedem Blatt gleich aussieht. */
  const Kopf = ({ titel }: { titel: string }) => (
    <div className="station-print-header">
      <div className="station-print-header-left">
        {clubLogo ? <img src={clubLogo} alt="Vereinslogo" className="station-print-logo" /> : <div style={{ fontSize: 32 }}>🏆</div>}
      </div>
      <div className="station-print-title-box">
        <div className="station-print-tournament-name">{tournament?.name || 'Turnier'}</div>
        <h1 className="station-print-station-title">{titel}</h1>
      </div>
      <div className="station-print-header-right">
        {sponsorLogo ? (
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Präsentiert von</div>
            <img src={sponsorLogo} alt={sponsorName || 'Sponsorlogo'} className="station-print-logo" />
          </div>
        ) : sponsorName ? (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Präsentiert von</div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{sponsorName}</div>
          </div>
        ) : null}
      </div>
    </div>
  );

  /** Fusszeile: woher das Dokument kommt und wann es entstand. */
  const Fuss = ({ seite }: { seite: string }) => (
    <div className="station-print-footer">
      <div className="station-print-footer-meta">
        <div>TSV Holm Planungs Tool &bull; Turnierabschluss <strong>{tournament?.name}</strong></div>
        <div>{seite} · Stand: {new Date().toLocaleDateString('de-DE')}</div>
      </div>
    </div>
  );

  return createPortal(
    <div className="station-print-overlay">
      <div className="station-print-modal">
        <div className="station-print-toolbar">
          <div className="station-print-toolbar-title">
            <span>🏁</span>
            <span>Turnierabschluss (DIN A4)</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => window.print()}
              style={{
                padding: '8px 18px', background: '#2563eb', color: '#fff', border: 'none',
                borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
              }}
            >
              <span>🖨️</span><span>Drucken / Als PDF speichern</span>
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 14px', background: '#e2e8f0', color: '#334155', border: 'none',
                borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer'
              }}
            >
              Schließen ✖
            </button>
          </div>
        </div>

        <div className="station-print-options">
          <div className="station-print-field">
            <label>🔒 Namensformat</label>
            <select className="station-print-select" value={nameMode} onChange={e => setNameMode(e.target.value as 'short' | 'full')}>
              <option value="short">DSGVO-geschützt (Max M.)</option>
              <option value="full">Vollständige Namen</option>
            </select>
          </div>
          <div className="station-print-field">
            <label>💬 Offene Kommentare</label>
            <select
              className="station-print-select"
              value={zeigeKommentare ? 'ja' : 'nein'}
              onChange={e => setZeigeKommentare(e.target.value === 'ja')}
            >
              <option value="nein">Nur Durchschnitte (empfohlen)</option>
              <option value="ja">Kommentare im Wortlaut anhängen</option>
            </select>
          </div>
          <div className="station-print-field">
            <label>📋 Dienstpläne anhängen</label>
            <select
              className="station-print-select"
              value={zeigeDienstplaene ? 'ja' : 'nein'}
              onChange={e => setZeigeDienstplaene(e.target.value === 'ja')}
            >
              <option value="ja">Ja, wer wann wo war</option>
              <option value="nein">Nein, nur die Auswertung</option>
            </select>
          </div>
          <div className="station-print-field">
            <label>🙏 Dankeswort auf dem Deckblatt</label>
            <input
              className="station-print-input"
              value={dank}
              maxLength={300}
              onChange={e => setDank(e.target.value)}
              placeholder="Optional – bleibt leer, wenn du es löschst"
            />
          </div>
        </div>

        {zeigeKommentare && (
          <div className="abschluss-warnung">
            ⚠️ Die Kommentare stehen im Wortlaut im Dokument und sind über die Schicht der
            Person zuordenbar – auch bei abgekürzten Namen. Für einen Bericht, der weitergegeben
            wird, sind die Durchschnitte in der Regel die bessere Wahl.
          </div>
        )}

        <div className="station-print-preview-container">
          {ladeStat && <div className="abschluss-laden">Lade Auswertung …</div>}
          {statFehler && <div className="abschluss-laden">Die Auswertung konnte nicht geladen werden.</div>}

          {statistik && (
            <>
              {/* ------------------------------------------------ Deckblatt */}
              <div className="station-print-page">
                <div>
                  <Kopf titel="🏁 Turnierabschluss" />

                  <div className="abschluss-deckblatt-kopf">
                    <div className="abschluss-deckblatt-zeitraum">{zeitraum}</div>
                    <div className="abschluss-deckblatt-unter">
                      {statistik.eckdaten.schichten} Schichten · {days.length} Turniertag
                      {days.length === 1 ? '' : 'e'} · {areas.filter(a => a.active).length} Arbeitsbereiche
                    </div>
                  </div>

                  <div className="abschluss-kacheln">
                    <div className="abschluss-kachel">
                      <div className="abschluss-kachel-wert">{zahl(statistik.eckdaten.beteiligte)}</div>
                      <div className="abschluss-kachel-label">Menschen haben mitgeholfen</div>
                    </div>
                    <div className="abschluss-kachel">
                      <div className="abschluss-kachel-wert">{zahl(Math.round(statistik.eckdaten.stunden))}</div>
                      <div className="abschluss-kachel-label">Stunden geleistet</div>
                    </div>
                    <div className="abschluss-kachel">
                      <div className="abschluss-kachel-wert">
                        {statistik.eckdaten.besetzungsgrad ?? '–'}<span className="abschluss-kachel-einheit">%</span>
                      </div>
                      <div className="abschluss-kachel-label">der Plätze besetzt</div>
                    </div>
                    <div className="abschluss-kachel">
                      <div className="abschluss-kachel-wert">{zahl(statistik.eckdaten.spenden)}</div>
                      <div className="abschluss-kachel-label">
                        Verpflegungsspenden von {zahl(statistik.eckdaten.spender)} Personen
                      </div>
                    </div>
                  </div>

                  {/* Die Verteilung sagt mehr als der Schnitt: Sie zeigt, ob die
                      Last auf vielen Schultern lag oder auf wenigen. */}
                  <div className="abschluss-abschnitt">
                    <h2 className="abschluss-h2">Wie die Last verteilt war</h2>
                    <div className="abschluss-verteilung">
                      <span><strong>{statistik.werHatGetragen.verteilung.eine}</strong> mit einer Schicht</span>
                      <span><strong>{statistik.werHatGetragen.verteilung.zwei}</strong> mit zwei</span>
                      <span><strong>{statistik.werHatGetragen.verteilung.dreiOderMehr}</strong> mit drei oder mehr</span>
                      <span className="abschluss-verteilung-schnitt">
                        Schnitt: {statistik.werHatGetragen.schnittStundenProHelfer} h je Helfer
                      </span>
                    </div>
                  </div>

                  {dank.trim() && <div className="abschluss-dank">{dank}</div>}
                </div>
                <Fuss seite="Deckblatt" />
              </div>

              {/* ------------------------------------- Beteiligung im Detail */}
              <div className="station-print-page">
                <div>
                  <Kopf titel="📊 Beteiligung" />

                  <h2 className="abschluss-h2">Je Arbeitsbereich</h2>
                  <table className="station-print-table">
                    <thead>
                      <tr>
                        <th>Bereich</th><th>Besetzt</th><th>Offen</th><th>Stunden</th><th>Quote</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statistik.jeBereich.map(b => (
                        <tr key={b.name}>
                          <td>{b.icon} {b.name}</td>
                          <td>{b.besetzt} / {b.plaetze}</td>
                          <td>{b.offen > 0 ? b.offen : '–'}</td>
                          <td>{Math.round(b.stunden)} h</td>
                          <td><strong>{b.besetzungsgrad ?? '–'} %</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h2 className="abschluss-h2">Je Turniertag</h2>
                  <table className="station-print-table">
                    <thead>
                      <tr><th>Tag</th><th>Besetzt</th><th>Offen</th><th>Stunden</th><th>Quote</th></tr>
                    </thead>
                    <tbody>
                      {statistik.jeTag.map(t => (
                        <tr key={t.datum}>
                          <td>{tagLang(t.datum)}</td>
                          <td>{t.besetzt} / {t.plaetze}</td>
                          <td>{t.offen > 0 ? t.offen : '–'}</td>
                          <td>{Math.round(t.stunden)} h</td>
                          <td><strong>{t.besetzungsgrad ?? '–'} %</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                </div>
                <Fuss seite="Beteiligung" />
              </div>

              {/* Eigenes Blatt, nicht unter die Tabellen davor: Gemessen laufen
                  drei Tabellen auf einer Seite ueber die A4-Hoehe hinaus, und
                  dann bricht die letzte mitten durch und die Fusszeile landet
                  auf einem Blatt fuer sich. Ein Bericht, dessen Blaetter jeweils
                  fuer sich stehen, ist ausserdem der ganze Zweck der Uebung.
                  Bewusst nur eine Bestenliste und keine Gegenliste: Wer wenig
                  uebernommen hat, wurde vielleicht schlicht nicht gefragt. */}
              {statistik.werHatGetragen.nachStunden.length > 0 && (
                <div className="station-print-page">
                  <div>
                    <Kopf titel="💪 Der grösste Einsatz" />
                    <p className="abschluss-hinweis">
                      Die zehn mit den meisten Stunden. Eine Gegenliste gibt es bewusst nicht –
                      wer wenig übernommen hat, wurde vielleicht schlicht nicht gefragt.
                    </p>
                    <table className="station-print-table">
                      <thead>
                        <tr><th>#</th><th>Name</th><th>Schichten</th><th>Stunden</th><th>Spenden</th></tr>
                      </thead>
                      <tbody>
                        {statistik.werHatGetragen.nachStunden.slice(0, 10).map((h, i) => (
                          <tr key={h.userId}>
                            <td>{i + 1}</td>
                            <td>{name(h.name)}</td>
                            <td>{h.schichten}</td>
                            <td><strong>{h.stunden} h</strong></td>
                            <td>{h.spenden > 0 ? h.spenden : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {statistik.werHatGetragen.nachSpenden.length > 0 && (
                      <>
                        <h2 className="abschluss-h2">Die meisten Verpflegungsspenden</h2>
                        <table className="station-print-table">
                          <thead>
                            <tr><th>#</th><th>Name</th><th>Spenden</th></tr>
                          </thead>
                          <tbody>
                            {statistik.werHatGetragen.nachSpenden.slice(0, 10).map((h, i) => (
                              <tr key={h.userId}>
                                <td>{i + 1}</td>
                                <td>{name(h.name)}</td>
                                <td><strong>{h.spenden}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                  <Fuss seite="Einsatz" />
                </div>
              )}

              {/* ------------------------------------------------ Jahrgänge */}
              {statistik.jahrgaenge.liste.length > 0 && (
                <div className="station-print-page">
                  <div>
                    <Kopf titel="👨‍👩‍👧 Beteiligung nach Jahrgang" />
                    <p className="abschluss-hinweis">
                      Wie viel jeder Jahrgang übernommen hat, bezogen auf die Zahl seiner Kinder.
                      {statistik.jahrgaenge.mehrfachzaehlung && (
                        <> Familien mit Kindern in mehreren Jahrgängen zählen in jedem davon –
                        die Summe der Zeilen ist deshalb grösser als das Turnier.</>
                      )}
                    </p>
                    <table className="station-print-table">
                      <thead>
                        <tr><th>Jahrgang</th><th>Kinder</th><th>Schichten</th><th>Stunden</th><th>h / Kind</th><th>Spenden</th></tr>
                      </thead>
                      <tbody>
                        {statistik.jahrgaenge.liste.map(j => (
                          <tr key={j.name}>
                            <td>{j.name}</td>
                            <td>{j.kinder || '–'}</td>
                            <td>{j.schichten}</td>
                            <td>{Math.round(j.stunden)} h</td>
                            <td><strong>{j.stundenProKind ?? '–'}</strong></td>
                            <td>{j.spenden > 0 ? j.spenden : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Die Namen der Unbeteiligten stehen bewusst NICHT hier: In der
                        Ansicht sind sie eine Gesprächsgrundlage, in einem Dokument,
                        das herumgeht, wären sie eine Anklagebank. */}
                    <p className="abschluss-hinweis">
                      Wer sich noch nicht beteiligt hat, steht namentlich nur in der
                      Organisationsansicht – als Grundlage für ein Gespräch, nicht für einen Bericht.
                    </p>
                  </div>
                  <Fuss seite="Jahrgänge" />
                </div>
              )}

              {/* -------------------------------------------- Rückmeldungen */}
              <div className="station-print-page">
                <div>
                  <Kopf titel="💬 Was die Helfer gesagt haben" />

                  {bereicheMitFeedback.length === 0 ? (
                    <p className="abschluss-hinweis">
                      Für dieses Turnier liegen keine Rückmeldungen vor.
                    </p>
                  ) : (
                    <>
                      <p className="abschluss-hinweis">
                        Skala 1–5. Beim Stress ist die Mitte das Ziel, nicht das Maximum: hoch heisst
                        überlastet, niedrig heisst Langeweile. Unter {BELASTBAR_AB} Rückmeldungen ist
                        ein Mittelwert mit Vorsicht zu lesen – das ist in der Spalte vermerkt.
                      </p>
                      <table className="station-print-table">
                        <thead>
                          <tr><th>Bereich</th><th>Antworten</th><th>Stress</th><th>Organisation</th><th>Spass</th></tr>
                        </thead>
                        <tbody>
                          {bereicheMitFeedback.map(a => (
                            <tr key={a.workAreaName}>
                              <td>{a.workAreaIcon} {a.workAreaName}</td>
                              <td>
                                {a.totalRatings}
                                {a.totalRatings < BELASTBAR_AB && <span className="abschluss-duenn"> (dünn)</span>}
                              </td>
                              <td>{stressWort(a.avgWorkload)}</td>
                              <td>{a.avgOrganization != null ? `${a.avgOrganization} / 5` : '–'}</td>
                              <td>{a.avgFun != null ? `${a.avgFun} / 5` : '–'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {bereicheMitFeedback.some(a => a.empfehlungen.length > 0) && (
                        <>
                          <h2 className="abschluss-h2">Was daraus folgt</h2>
                          <ul className="abschluss-empfehlungen">
                            {bereicheMitFeedback.flatMap(a =>
                              a.empfehlungen.map((e, i) => (
                                <li key={`${a.workAreaName}-${i}`} className={`abschluss-empfehlung abschluss-empfehlung--${e.ton}`}>
                                  <span className="abschluss-empfehlung-kopf">
                                    {TON_DARSTELLUNG[e.ton].symbol} {TON_DARSTELLUNG[e.ton].label} · {a.workAreaIcon} {a.workAreaName}
                                  </span>
                                  <span>{e.text}</span>
                                </li>
                              ))
                            )}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </div>
                <Fuss seite="Rückmeldungen" />
              </div>

              {/* ------------------------- Kommentare (nur wenn ausdrücklich) */}
              {zeigeKommentare && kommentare.length > 0 && (
                <div className="station-print-page">
                  <div>
                    <Kopf titel="💬 Kommentare im Wortlaut" />
                    <p className="abschluss-hinweis">
                      {kommentare.length} Rückmeldung{kommentare.length === 1 ? '' : 'en'} mit Text.
                      Unverändert übernommen.
                    </p>
                    <ul className="abschluss-kommentare">
                      {kommentare.map(f => (
                        <li key={f.id} className="abschluss-kommentar">
                          <span className="abschluss-kommentar-text">„{f.ratingComment?.trim()}"</span>
                          <span className="abschluss-kommentar-quelle">
                            {f.shift?.workArea?.icon} {f.shift?.workArea?.name}
                            {f.user?.name && <> · {name(f.user.name)}</>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Fuss seite="Kommentare" />
                </div>
              )}

              {/* ------------------------------------------- Wo es eng wurde */}
              <div className="station-print-page">
                <div>
                  <Kopf titel="🕳️ Wo es eng wurde" />
                  <p className="abschluss-hinweis">
                    Für die nächste Planung das Interessanteste an diesem Dokument: die Stellen,
                    an denen Plätze offen blieben.
                  </p>

                  <h2 className="abschluss-h2">Besetzung nach Tageszeit</h2>
                  <table className="station-print-table">
                    <thead>
                      <tr><th>Tageszeit</th><th>Besetzt</th><th>Offen</th><th>Quote</th></tr>
                    </thead>
                    <tbody>
                      {statistik.luecken.jeAbschnitt.map(a => (
                        <tr key={a.abschnitt}>
                          <td>{a.label}</td>
                          <td>{a.besetzt} / {a.plaetze}</td>
                          <td>{a.offen > 0 ? a.offen : '–'}</td>
                          <td><strong>{a.besetzungsgrad ?? '–'} %</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {statistik.luecken.groessteLuecken.length > 0 && (
                    <>
                      <h2 className="abschluss-h2">Die grössten einzelnen Lücken</h2>
                      <table className="station-print-table">
                        <thead>
                          <tr><th>Offen</th><th>Bereich</th><th>Wann</th><th>Besetzung</th></tr>
                        </thead>
                        <tbody>
                          {statistik.luecken.groessteLuecken.map(l => (
                            <tr key={l.shiftId}>
                              <td><strong>{l.offen}</strong></td>
                              <td>{l.icon} {l.bereich}</td>
                              <td>{tagKurz(l.datum)} · {hhmm(l.startMin)}–{hhmm(l.endMin)}</td>
                              <td>{l.besetzt} von {l.plaetze}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {statistik.verlauf && statistik.verlauf.aufrufe.length > 0 && (
                    <>
                      <h2 className="abschluss-h2">Aufrufe und was danach kam</h2>
                      <p className="abschluss-hinweis">
                        Gezählt sind die Zusagen und Spenden in den {statistik.verlauf.fensterStunden}
                        {' '}Stunden nach dem Aufruf. Ein Anhaltspunkt, kein Beweis – manches wäre
                        auch ohne Aufruf gekommen.
                      </p>
                      <table className="station-print-table">
                        <thead>
                          <tr><th>Wann</th><th>Aufruf</th><th>Erreicht</th><th>Zusagen danach</th><th>Spenden danach</th></tr>
                        </thead>
                        <tbody>
                          {statistik.verlauf.aufrufe.map(a => (
                            <tr key={a.id}>
                              <td>{tagKurz(a.createdAt)}</td>
                              <td>{a.titel}</td>
                              <td>{a.erreicht}</td>
                              <td><strong>{a.reaktion.zusagen}</strong></td>
                              <td>{a.reaktion.spenden}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
                <Fuss seite="Lücken" />
              </div>

              {/* --------------------------------------- Dienstpläne (Anhang) */}
              {dienstplaene.map(({ area, tage }) => (
                <div key={area.id} className="station-print-page">
                  <div>
                    <Kopf titel={`${area.icon} ${area.name}`} />
                    <div className="station-print-meta-bar">
                      <div>📋 <strong>Anhang:</strong> Dienstplan wie gelaufen</div>
                      <div>📅 {tage.map(t => tagKurz(t.day.date)).join(' · ')}</div>
                    </div>

                    {tage.map(({ day, shifts }) => (
                      <div key={day.id} className="station-print-tag">
                        <div className="station-print-tag-titel">📅 {tagLang(day.date)}</div>
                        <table className="station-print-table">
                          <thead>
                            <tr><th style={{ width: '25%' }}>Uhrzeit</th><th>Wer war da</th><th style={{ width: '15%' }}>Besetzung</th></tr>
                          </thead>
                          <tbody>
                            {shifts.map(s => {
                              const startMin = s.startMin ?? s.daySlot?.startMin;
                              const endMin = s.endMin ?? s.daySlot?.endMin;
                              const eingeplant = volunteerShifts.filter(vs => vs.shiftId === s.id);
                              const max = s.maxVolunteers || 1;
                              return (
                                <tr key={s.id}>
                                  <td><span className="station-print-time-badge">{hhmm(startMin)} – {hhmm(endMin)}</span></td>
                                  <td>
                                    {eingeplant.length === 0
                                      ? <span className="abschluss-unbesetzt">unbesetzt geblieben</span>
                                      : eingeplant.map(vs => vs.user?.name ? name(vs.user.name) : 'Helfer').join(', ')}
                                  </td>
                                  <td>
                                    <strong>{eingeplant.length} / {max}</strong>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                  <Fuss seite={`Dienstplan ${area.name}`} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
