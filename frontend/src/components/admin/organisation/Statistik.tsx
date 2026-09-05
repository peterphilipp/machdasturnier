import { useState, useEffect, Fragment } from 'react';
import { apiFetch } from '../../../api';
import { Ladefehler } from '../../Verbindung';
import '../../../styles/components/statistik.css';

/**
 * Auswertung eines Turniers - was tatsaechlich passiert ist.
 *
 * Gerechnet wird im Backend (utils/turnierStatistik.ts), hier wird nur
 * dargestellt. Bewusst ohne Diagramm-Bibliothek: bei einer Handvoll Bereichen
 * und Jahrgaengen sind Balken aus CSS schneller zu lesen als ein Chart - und
 * kosten kein halbes Megabyte im Bundle.
 */

interface Kennzahl { plaetze: number; besetzt: number; offen: number; stunden: number; besetzungsgrad: number | null }
interface Bereich extends Kennzahl { name: string; icon: string }
interface Tag extends Kennzahl { datum: string }
interface Helfer { userId: number; name: string; schichten: number; stunden: number; spenden: number }
interface JahrgangPerson { userId: number; name: string; schichten: number; stunden: number; spenden: number }
interface Jahrgang {
  id: number; name: string; helfer: number; schichten: number;
  stunden: number; kinder: number; stundenProKind: number | null;
  spenden: number;
  spender: number;
  personen: JahrgangPerson[];
  ohneBeteiligung: { userId: number; name: string }[];
  /** Anteil der Stunden, den die aktivere Hälfte trägt. Null bei zu wenigen. */
  lastAnteilObereHaelfte: number | null;
}
interface Luecke {
  shiftId: number; bereich: string; icon: string; datum: string | null;
  startMin: number | null; endMin: number | null; plaetze: number; besetzt: number; offen: number;
}

interface VerlaufTag {
  datum: string; zusagen: number; spenden: number;
  aufrufe: { id: number; titel: string; erreicht: number }[];
  zusagenKumuliert: number; spendenKumuliert: number;
}
interface VerlaufAufruf {
  id: number; titel: string; empfaenger: string; erreicht: number; createdAt: string;
  reaktion: { zusagen: number; spenden: number };
}

interface ChronikEintrag {
  zeitpunkt: string; art: 'schicht' | 'spende'; name: string; was: string;
}

interface Nutzung {
  eckdaten: {
    konten: number; mitZugang: number; ohneZugang: number; unerreichbar: number;
    nieAngemeldet: number; aktivLetzte7Tage: number; aktivLetzte30Tage: number;
  };
  erreichbarkeit: {
    perPush: number; pushGeraete: number; nurInDerApp: number;
    ueberKontaktperson: number; garNicht: number;
  };
  anmeldeart: { mitPasskey: number; nurPasswort: number; nieAngemeldet: number };
  tage: {
    datum: string; aktive: number; anmeldungen: number;
    registrierungen: number; registrierungenKumuliert: number;
  }[];
  aufzeichnungAb: string | null;
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
  verlauf?: {
    tage: VerlaufTag[];
    ohneZeitstempel: number;
    aufrufe: VerlaufAufruf[];
    fensterStunden: number;
    chronik?: ChronikEintrag[];
  };
  nutzung?: Nutzung;
  luecken: {
    jeAbschnitt: { abschnitt: string; label: string; plaetze: number; besetzt: number; offen: number; besetzungsgrad: number | null }[];
    groessteLuecken: Luecke[];
  };
}

const hhmm = (m: number | null) =>
  m == null ? '?' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const datumKurz = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '–';

/** Zahl mit deutschem Dezimalkomma - "3,5 h" statt "3.5 h". */
const zahl = (n: number) => n.toLocaleString('de-DE');

function Kachel({ wert, einheit, label, ton }: {
  wert: string | number; einheit?: string; label: string; ton?: 'warnung' | 'gut';
}) {
  return (
    <div className={`stat-kachel${ton ? ` stat-kachel--${ton}` : ''}`}>
      <div className="stat-kachel-wert">
        {wert}{einheit && <span className="stat-kachel-einheit">{einheit}</span>}
      </div>
      <div className="stat-kachel-label">{label}</div>
    </div>
  );
}

/** Ein Balken, dessen Fuellung den besetzten Anteil zeigt. */
function Balken({ anteil, ton = 'normal' }: { anteil: number; ton?: 'normal' | 'warnung' }) {
  return (
    <div className="stat-balken" role="presentation">
      <div
        className={`stat-balken-fuellung stat-balken-fuellung--${ton}`}
        style={{ width: `${Math.min(100, Math.max(0, anteil))}%` }}
      />
    </div>
  );
}

export default function Statistik({ selectedTournament }: { selectedTournament: number | null }) {
  const [daten, setDaten] = useState<Statistik | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<unknown>(null);
  const [versuch, setVersuch] = useState(0);
  const [topModus, setTopModus] = useState<'stunden' | 'schichten' | 'spenden'>('stunden');
  // Welche Jahrgänge sind aufgeschlüsselt? Zugeklappt bleibt die Tabelle
  // überschaubar, aufgeklappt beantwortet sie "wer genau".
  const [offeneJahrgaenge, setOffeneJahrgaenge] = useState<Set<number>>(new Set());
  // Die Chronik nennt Namen. Zugeklappt zeigt der Verlauf nur Zahlen - wer
  // wissen will, wer wann zugesagt hat, klappt sie bewusst auf.
  const [chronikOffen, setChronikOffen] = useState(false);

  useEffect(() => {
    if (!selectedTournament) { setDaten(null); setLaedt(false); return; }
    let abgebrochen = false;
    setLaedt(true);
    setFehler(null);

    apiFetch(`/api/volunteer-shifts/statistik?tournamentId=${selectedTournament}`)
      .then((d: Statistik) => { if (!abgebrochen) setDaten(d); })
      .catch((e: unknown) => { if (!abgebrochen) setFehler(e); })
      .finally(() => { if (!abgebrochen) setLaedt(false); });

    return () => { abgebrochen = true; };
  }, [selectedTournament, versuch]);

  if (!selectedTournament) {
    return (
      <div className="feedback-empty">
        <div className="feedback-empty-icon">📊</div>
        <div className="feedback-empty-title">Kein Turnier ausgewählt</div>
        <div className="feedback-empty-desc">Wähle oben ein Turnier, um dessen Auswertung zu sehen.</div>
      </div>
    );
  }
  if (laedt) return <div className="feedback-loading">Lade Auswertung …</div>;
  if (fehler) return <Ladefehler was="Die Auswertung" fehler={fehler} erneut={() => setVersuch(v => v + 1)} />;
  if (!daten || daten.eckdaten.plaetze === 0) {
    return (
      <div className="feedback-empty">
        <div className="feedback-empty-icon">📊</div>
        <div className="feedback-empty-title">Noch nichts auszuwerten</div>
        <div className="feedback-empty-desc">
          Sobald der Dienstplan Schichten enthält, entsteht hier die Auswertung.
        </div>
      </div>
    );
  }

  const { eckdaten, jeBereich, jeTag, werHatGetragen, jahrgaenge, luecken, verlauf, nutzung } = daten;
  const top = topModus === 'stunden' ? werHatGetragen.nachStunden
    : topModus === 'schichten' ? werHatGetragen.nachSchichten
    : werHatGetragen.nachSpenden;
  const topWert = (h: Helfer) =>
    topModus === 'stunden' ? h.stunden : topModus === 'schichten' ? h.schichten : h.spenden;
  const topMax = top.length ? Math.max(1, topWert(top[0])) : 1;
  const { eine, zwei, dreiOderMehr } = werHatGetragen.verteilung;
  const helferMitSchichten = eine + zwei + dreiOderMehr;
  const jgMax = Math.max(1, ...jahrgaenge.liste.map(j => j.stunden));
  const jgMaxProKind = Math.max(0.1, ...jahrgaenge.liste.map(j => j.stundenProKind ?? 0));

  return (
    <div className="stat-seite">

      {/* ---- Eckdaten ---- */}
      <section>
        <h3 className="feedback-section-title">📋 Eckdaten</h3>
        <div className="stat-kacheln">
          <Kachel wert={eckdaten.helfer} label="Helfer im Einsatz" />
          {eckdaten.spender > 0 && (
            <Kachel wert={eckdaten.beteiligte} label="beteiligt insgesamt" />
          )}
          <Kachel wert={eckdaten.schichten} label="übernommene Schichten" />
          <Kachel wert={zahl(eckdaten.stunden)} einheit=" h" label="geleistete Stunden" />
          <Kachel
            wert={eckdaten.besetzungsgrad ?? '–'} einheit="%"
            label="der Plätze besetzt"
            ton={eckdaten.besetzungsgrad !== null && eckdaten.besetzungsgrad < 80 ? 'warnung' : 'gut'}
          />
          <Kachel
            wert={eckdaten.offen} label="Plätze unbesetzt"
            ton={eckdaten.offen > 0 ? 'warnung' : 'gut'}
          />
        </div>
      </section>

      {/* ---- Besetzung je Tag und Bereich ---- */}
      <section>
        <h3 className="feedback-section-title">🗓️ Besetzung je Tag</h3>
        <div className="stat-tabelle-huelle">
        <table className="stat-tabelle">
          <thead>
            <tr><th>Tag</th><th>Besetzt</th><th className="stat-spalte-balken">Anteil</th><th>Stunden</th></tr>
          </thead>
          <tbody>
            {jeTag.map(t => (
              <tr key={t.datum}>
                <td>{datumKurz(t.datum)}</td>
                <td className="stat-zahl">{t.besetzt} / {t.plaetze}</td>
                <td className="stat-spalte-balken">
                  <Balken anteil={t.besetzungsgrad ?? 0} ton={(t.besetzungsgrad ?? 100) < 80 ? 'warnung' : 'normal'} />
                  <span className="stat-balken-wert">{t.besetzungsgrad ?? '–'} %</span>
                </td>
                <td className="stat-zahl">{zahl(t.stunden)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section>
        <h3 className="feedback-section-title">📍 Besetzung je Arbeitsbereich</h3>
        <p className="stat-hinweis">Nach offenen Plätzen sortiert – oben steht, wo am meisten fehlte.</p>
        <div className="stat-tabelle-huelle">
        <table className="stat-tabelle">
          <thead>
            <tr><th>Bereich</th><th>Besetzt</th><th className="stat-spalte-balken">Anteil</th><th>Offen</th><th>Stunden</th></tr>
          </thead>
          <tbody>
            {jeBereich.map(b => (
              <tr key={b.name}>
                <td>{b.icon} {b.name}</td>
                <td className="stat-zahl">{b.besetzt} / {b.plaetze}</td>
                <td className="stat-spalte-balken">
                  <Balken anteil={b.besetzungsgrad ?? 0} ton={(b.besetzungsgrad ?? 100) < 80 ? 'warnung' : 'normal'} />
                  <span className="stat-balken-wert">{b.besetzungsgrad ?? '–'} %</span>
                </td>
                <td className={`stat-zahl${b.offen > 0 ? ' stat-zahl--warnung' : ''}`}>{b.offen}</td>
                <td className="stat-zahl">{zahl(b.stunden)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* ---- Wer hat getragen ---- */}
      <section>
        <h3 className="feedback-section-title">💪 Wer hat getragen</h3>

        <div className="stat-verteilung">
          <div className="stat-verteilung-titel">
            Auf wie vielen Schultern lag die Arbeit? <strong>{helferMitSchichten}</strong> Helfer,
            im Schnitt <strong>{zahl(werHatGetragen.schnittStundenProHelfer)} h</strong> pro Person.
          </div>
          <div className="stat-verteilung-reihe">
            {[
              { label: 'genau 1 Schicht', anzahl: eine, klasse: 'eine' },
              { label: '2 Schichten', anzahl: zwei, klasse: 'zwei' },
              { label: '3 oder mehr', anzahl: dreiOderMehr, klasse: 'drei' }
            ].map(g => (
              <div key={g.klasse} className="stat-verteilung-block">
                <div className={`stat-verteilung-zahl stat-verteilung-zahl--${g.klasse}`}>{g.anzahl}</div>
                <div className="stat-verteilung-label">{g.label}</div>
              </div>
            ))}
          </div>
          {dreiOderMehr > 0 && helferMitSchichten > 0 && (
            <p className="stat-hinweis">
              {dreiOderMehr} von {helferMitSchichten} Helfern haben drei oder mehr Schichten übernommen.
            </p>
          )}
        </div>

        <div className="stat-top-kopf">
          <h4 className="stat-untertitel">Die zehn mit dem grössten Einsatz</h4>
          <div className="stat-umschalter" role="group" aria-label="Sortierung der Rangliste">
            <button
              className={`stat-umschalter-btn${topModus === 'stunden' ? ' stat-umschalter-btn--aktiv' : ''}`}
              onClick={() => setTopModus('stunden')}
              aria-pressed={topModus === 'stunden'}
            >nach Stunden</button>
            <button
              className={`stat-umschalter-btn${topModus === 'schichten' ? ' stat-umschalter-btn--aktiv' : ''}`}
              onClick={() => setTopModus('schichten')}
              aria-pressed={topModus === 'schichten'}
            >nach Schichten</button>
            {/* Nur anbieten, wenn es überhaupt Spenden gibt - ein leerer
                Reiter wirft mehr Fragen auf, als er beantwortet. */}
            {eckdaten.spender > 0 && (
              <button
                className={`stat-umschalter-btn${topModus === 'spenden' ? ' stat-umschalter-btn--aktiv' : ''}`}
                onClick={() => setTopModus('spenden')}
                aria-pressed={topModus === 'spenden'}
              >nach Spenden</button>
            )}
          </div>
        </div>

        <ol className="stat-rangliste">
          {top.map((h, i) => {
            const wert = topWert(h);
            return (
              <li key={h.userId} className="stat-rang">
                <span className="stat-rang-platz">{i + 1}</span>
                <span className="stat-rang-name">{h.name}</span>
                <span className="stat-rang-balken">
                  <Balken anteil={(wert / topMax) * 100} />
                </span>
                <span className="stat-rang-wert">
                  {topModus === 'spenden'
                    ? <>{h.spenden}× 🍰 {h.schichten > 0 && <span className="stat-rang-neben">· {zahl(h.stunden)} h</span>}</>
                    : topModus === 'stunden'
                    ? <>{zahl(h.stunden)} h <span className="stat-rang-neben">· {h.schichten} Sch.{h.spenden > 0 && <> · {h.spenden}× 🍰</>}</span></>
                    : <>{h.schichten} Sch. <span className="stat-rang-neben">· {zahl(h.stunden)} h{h.spenden > 0 && <> · {h.spenden}× 🍰</>}</span></>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ---- Jahrgänge ---- */}
      <section>
        <h3 className="feedback-section-title">👨‍👩‍👧 Beteiligung nach Jahrgang</h3>
        <p className="stat-hinweis">
          Die Spalte <strong>je Kind</strong> ist die vergleichbare Zahl: Ein grosser Jahrgang stellt
          selbstverständlich mehr Helfer, das sagt für sich genommen noch nichts über die Beteiligung.
          {jahrgaenge.mehrfachzaehlung && (
            <> Helfer mit Kindern in mehreren Jahrgängen zählen in jedem davon mit – die Summe der
            Helferzahlen ist deshalb höher als die Gesamtzahl.</>
          )}
        </p>
        <div className="stat-tabelle-huelle">
        <table className="stat-tabelle">
          <thead>
            <tr>
              <th>Jahrgang</th><th>Helfer</th><th>Schichten</th>
              <th className="stat-spalte-balken">Stunden</th><th>je Kind</th>
            </tr>
          </thead>
          <tbody>
            {jahrgaenge.liste.map(j => {
              const aufgeklappt = offeneJahrgaenge.has(j.id);
              const hatDetails = j.personen.length > 0 || j.ohneBeteiligung.length > 0;
              return (
              <Fragment key={j.id}>
              <tr>
                <td>
                  {hatDetails ? (
                    <button
                      type="button"
                      className="stat-jg-aufklappen"
                      onClick={() => setOffeneJahrgaenge(prev => {
                        const neu = new Set(prev);
                        neu.has(j.id) ? neu.delete(j.id) : neu.add(j.id);
                        return neu;
                      })}
                      aria-expanded={aufgeklappt}
                    >
                      <span className={`stat-jg-pfeil${aufgeklappt ? ' stat-jg-pfeil--offen' : ''}`}>›</span>
                      {j.name}
                    </button>
                  ) : j.name}
                </td>
                <td className="stat-zahl">{j.helfer}</td>
                <td className="stat-zahl">{j.schichten}</td>
                <td className="stat-spalte-balken">
                  <Balken anteil={(j.stunden / jgMax) * 100} />
                  <span className="stat-balken-wert">{zahl(j.stunden)} h</span>
                </td>
                <td className="stat-spalte-balken">
                  {j.stundenProKind !== null ? (
                    <>
                      <Balken anteil={(j.stundenProKind / jgMaxProKind) * 100} />
                      <span className="stat-balken-wert">{zahl(j.stundenProKind)} h</span>
                    </>
                  ) : <span className="stat-leer" title="Kein Kind dieses Jahrgangs erfasst">–</span>}
                </td>
              </tr>

              {aufgeklappt && (
                <tr className="stat-jg-detailzeile">
                  <td colSpan={5}>
                    <div className="stat-jg-detail">
                      <p className="stat-hinweis">
                        {j.lastAnteilObereHaelfte !== null && (
                          <>Die aktivere Hälfte dieses Jahrgangs trägt{' '}
                          <strong>{j.lastAnteilObereHaelfte} %</strong> der Stunden. </>
                        )}
                        {j.spenden > 0 && (
                          <>Dazu {j.spenden} Verpflegungsspende{j.spenden === 1 ? '' : 'n'} von{' '}
                          {j.spender} {j.spender === 1 ? 'Person' : 'Personen'}.</>
                        )}
                      </p>

                      <div className="stat-jg-spalten">
                        <div>
                          <h5 className="stat-jg-titel">Wer mitgemacht hat ({j.personen.length})</h5>
                          <p className="stat-hinweis" style={{ marginBottom: 6 }}>
                            Stunden und Spenden bleiben getrennt – vergleichbar sind sie nicht.
                          </p>
                          <ol className="stat-jg-liste">
                            {j.personen.map(pp => (
                              <li key={pp.userId}>
                                <span className="stat-jg-name">{pp.name}</span>
                                <span className="stat-jg-wert">
                                  {pp.stunden > 0 ? `${zahl(pp.stunden)} h` : '–'}
                                  <span className="stat-rang-neben">
                                    {pp.schichten > 0 && <> · {pp.schichten} Sch.</>}
                                    {pp.spenden > 0 && <> · {pp.spenden}× 🍰</>}
                                  </span>
                                </span>
                              </li>
                            ))}
                            {j.personen.length === 0 && <li className="stat-leer">niemand</li>}
                          </ol>
                        </div>

                        <div>
                          <h5 className="stat-jg-titel">Noch nicht dabei ({j.ohneBeteiligung.length})</h5>
                          {j.ohneBeteiligung.length === 0 ? (
                            <p className="stat-leer">
                              {j.personen.length > 0 ? 'Alle erfassten Familien haben etwas übernommen.' : '–'}
                            </p>
                          ) : (
                            <>
                              <ul className="stat-jg-liste stat-jg-liste--offen">
                                {j.ohneBeteiligung.map(pp => (
                                  <li key={pp.userId}><span className="stat-jg-name">{pp.name}</span></li>
                                ))}
                              </ul>
                              <p className="stat-hinweis">
                                Als Gesprächsgrundlage gedacht – wer hier steht, wurde vielleicht
                                schlicht noch nicht gefragt. Aufgeführt sind nur Familien mit Konto
                                und hinterlegtem Kind; wer beides nicht hat, fehlt in der Liste.
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      {/* ---- Zeitlicher Verlauf ---- */}
      {verlauf && verlauf.tage.length > 0 && (() => {
        // Höchster Tageswert bestimmt die Balkenhöhe. Beide Reihen teilen sich
        // die Skala, sonst wären fünf Spenden so hoch wie fünfzig Zusagen.
        const tagesMax = Math.max(1, ...verlauf.tage.map(t => t.zusagen + t.spenden));
        return (
        <section>
          <h3 className="feedback-section-title">📈 Wann kam die Hilfe zusammen</h3>
          <p className="stat-hinweis">
            Zusagen und Spenden je Tag. Die Markierungen sind versendete Aufrufe – was
            danach kam, steht darunter. Ein Anhaltspunkt für die Frage, was gewirkt hat,
            kein Beweis: Manches wäre auch ohne Aufruf gekommen.
            {verlauf.ohneZeitstempel > 0 && (
              <> Nicht enthalten sind <strong>{verlauf.ohneZeitstempel} Zusagen</strong> aus der
              Zeit vor der Zeiterfassung – für sie ist der Zeitpunkt nicht bekannt.</>
            )}
          </p>

          <div className="verlauf-diagramm">
            {verlauf.tage.map(t => {
              const gesamt = t.zusagen + t.spenden;
              return (
                <div key={t.datum} className="verlauf-tag" title={
                  `${new Date(t.datum).toLocaleDateString('de-DE')}: `
                  + `${t.zusagen} Zusagen, ${t.spenden} Spenden`
                  + (t.aufrufe.length ? ` · Aufruf: ${t.aufrufe.map(a => a.titel).join(', ')}` : '')
                }>
                  <div className="verlauf-saeule">
                    {t.spenden > 0 && (
                      <div
                        className="verlauf-teil verlauf-teil--spenden"
                        style={{ height: `${(t.spenden / tagesMax) * 100}%` }}
                      />
                    )}
                    {t.zusagen > 0 && (
                      <div
                        className="verlauf-teil verlauf-teil--zusagen"
                        style={{ height: `${(t.zusagen / tagesMax) * 100}%` }}
                      />
                    )}
                    {gesamt === 0 && <div className="verlauf-teil verlauf-teil--leer" />}
                  </div>
                  {t.aufrufe.length > 0 && <div className="verlauf-marker" aria-hidden="true">📣</div>}
                </div>
              );
            })}
          </div>
          <div className="verlauf-achse">
            <span>{new Date(verlauf.tage[0].datum).toLocaleDateString('de-DE')}</span>
            <span>{new Date(verlauf.tage[verlauf.tage.length - 1].datum).toLocaleDateString('de-DE')}</span>
          </div>

          <div className="verlauf-legende">
            <span><i className="verlauf-punkt verlauf-punkt--zusagen" /> Zusagen</span>
            <span><i className="verlauf-punkt verlauf-punkt--spenden" /> Spenden</span>
            <span>📣 Aufruf verschickt</span>
          </div>

          {verlauf.aufrufe.length > 0 && (
            <>
              <h4 className="stat-untertitel">
                Aufrufe und was in den {verlauf.fensterStunden} Stunden danach kam
              </h4>
              <div className="stat-tabelle-huelle">
                <table className="stat-tabelle">
                  <thead>
                    <tr><th>Wann</th><th>Aufruf</th><th>Erreicht</th><th>Zusagen</th><th>Spenden</th></tr>
                  </thead>
                  <tbody>
                    {verlauf.aufrufe.map(a => (
                      <tr key={a.id}>
                        <td>{new Date(a.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</td>
                        <td>{a.titel}</td>
                        <td className="stat-zahl">{a.erreicht}</td>
                        <td className="stat-zahl">{a.reaktion.zusagen}</td>
                        <td className="stat-zahl">{a.reaktion.spenden}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="stat-hinweis">
                „Erreicht“ ist die Zahl der tatsächlich zugestellten Push-Nachrichten – nicht
                die der Angeschriebenen. Wer die App nicht installiert hat, taucht hier nicht auf.
              </p>
            </>
          )}

          {/* Die Einzeleintraege hinter der Kurve. Die Kurve sagt "wann kam
              etwas zusammen", diese Liste sagt "wer". Bewusst chronologisch
              und nicht nach "wer war am spaetesten" sortiert: Das waere eine
              Liste der Saeumigen, und spaet eingetragen heisst oft nur, spaet
              gefragt worden zu sein. */}
          {verlauf.chronik && verlauf.chronik.length > 0 && (
            <>
              <button
                className="stat-chronik-schalter"
                onClick={() => setChronikOffen(o => !o)}
                aria-expanded={chronikOffen}
              >
                {chronikOffen ? '▾' : '▸'} Wer hat wann zugesagt? ({verlauf.chronik.length} Einträge)
              </button>

              {chronikOffen && (
                <>
                  <div className="stat-tabelle-huelle stat-chronik">
                    <table className="stat-tabelle">
                      <thead>
                        <tr><th>Wann</th><th>Wer</th><th>Was</th></tr>
                      </thead>
                      <tbody>
                        {verlauf.chronik.map((e, i) => (
                          <tr key={`${e.zeitpunkt}-${i}`}>
                            <td className="stat-chronik-zeit">
                              {new Date(e.zeitpunkt).toLocaleString('de-DE', {
                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                              })}
                            </td>
                            <td>{e.name}</td>
                            <td>
                              <span aria-hidden="true">{e.art === 'spende' ? '🍰' : '🧑‍🍳'}</span> {e.was}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {verlauf.ohneZeitstempel > 0 && (
                    <p className="stat-hinweis">
                      {verlauf.ohneZeitstempel} ältere Zusagen fehlen hier – sie stammen aus der
                      Zeit vor der Zeiterfassung und liessen sich nur raten.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </section>
        );
      })()}

      {/* ---- Lücken ---- */}
      <section>
        <h3 className="feedback-section-title">🕳️ Wo es eng wurde</h3>
        <div className="stat-tabelle-huelle">
        <table className="stat-tabelle">
          <thead>
            <tr><th>Tageszeit</th><th>Besetzt</th><th className="stat-spalte-balken">Anteil</th><th>Offen</th></tr>
          </thead>
          <tbody>
            {luecken.jeAbschnitt.map(a => (
              <tr key={a.abschnitt}>
                <td>{a.label}</td>
                <td className="stat-zahl">{a.besetzt} / {a.plaetze}</td>
                <td className="stat-spalte-balken">
                  <Balken anteil={a.besetzungsgrad ?? 0} ton={(a.besetzungsgrad ?? 100) < 80 ? 'warnung' : 'normal'} />
                  <span className="stat-balken-wert">{a.besetzungsgrad ?? '–'} %</span>
                </td>
                <td className={`stat-zahl${a.offen > 0 ? ' stat-zahl--warnung' : ''}`}>{a.offen}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {luecken.groessteLuecken.length > 0 && (
          <>
            <h4 className="stat-untertitel">Die grössten einzelnen Lücken</h4>
            <p className="stat-hinweis">Hier lohnt es sich, beim nächsten Turnier früher gezielt zu fragen.</p>
            <ul className="stat-luecken">
              {luecken.groessteLuecken.map(l => (
                <li key={l.shiftId} className="stat-luecke">
                  <span className="stat-luecke-offen">{l.offen}</span>
                  <span className="stat-luecke-text">
                    <strong>{l.icon} {l.bereich}</strong>
                    <span className="stat-luecke-zeit">
                      {datumKurz(l.datum)} · {hhmm(l.startMin)}–{hhmm(l.endMin)} · {l.besetzt} von {l.plaetze} besetzt
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ---- App-Nutzung ----
          Ganz unten und als eigener Abschnitt: Diese Zahlen sagen nichts über
          das Turnier, sondern über das Werkzeug. Sie beantworten die Frage,
          die vor jedem Aufruf steht - wie viele Menschen erreiche ich damit
          überhaupt. */}
      {nutzung && (
        <section>
          <h3 className="feedback-section-title">📱 App-Nutzung</h3>

          <div className="stat-kacheln">
            <Kachel wert={nutzung.eckdaten.konten} label="Teilnehmer insgesamt" />
            <Kachel wert={nutzung.eckdaten.aktivLetzte7Tage} label="in den letzten 7 Tagen aktiv" />
            <Kachel wert={nutzung.eckdaten.aktivLetzte30Tage} label="in den letzten 30 Tagen aktiv" />
            <Kachel
              wert={nutzung.eckdaten.nieAngemeldet}
              label="noch nie angemeldet"
              ton={nutzung.eckdaten.nieAngemeldet > 0 ? 'warnung' : undefined}
            />
          </div>

          <h4 className="stat-untertitel">Wen eine Nachricht erreicht</h4>
          <p className="stat-hinweis">
            Die vier Gruppen überschneiden sich nicht und ergeben zusammen alle Teilnehmer.
          </p>
          <div className="stat-tabelle-huelle">
            <table className="stat-tabelle">
              <thead>
                <tr><th>Weg</th><th>Personen</th><th>Was das heisst</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>🔔 Push aufs Gerät</td>
                  <td className="stat-zahl">{nutzung.erreichbarkeit.perPush}</td>
                  <td>
                    Merkt es sofort – auf {zahl(nutzung.erreichbarkeit.pushGeraete)} Gerät
                    {nutzung.erreichbarkeit.pushGeraete === 1 ? '' : 'en'}.
                  </td>
                </tr>
                <tr>
                  <td>📥 nur in der App</td>
                  <td className="stat-zahl">{nutzung.erreichbarkeit.nurInDerApp}</td>
                  <td>Sieht die Nachricht beim nächsten Öffnen.</td>
                </tr>
                <tr>
                  <td>👪 über die Kontaktperson</td>
                  <td className="stat-zahl">{nutzung.erreichbarkeit.ueberKontaktperson}</td>
                  <td>Helfer ohne eigenen Zugang – die Nachricht geht an die Eltern.</td>
                </tr>
                <tr>
                  <td>🚫 gar nicht</td>
                  <td className={`stat-zahl${nutzung.erreichbarkeit.garNicht > 0 ? ' stat-zahl--warnung' : ''}`}>
                    {nutzung.erreichbarkeit.garNicht}
                  </td>
                  <td>
                    Kein Zugang und keine Kontaktperson hinterlegt. Eine verschobene Schicht
                    erfährt diese Person nur, wenn jemand sie anruft.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4 className="stat-untertitel">Wie sich angemeldet wird</h4>
          <div className="stat-kacheln">
            <Kachel wert={nutzung.anmeldeart.mitPasskey} label="mit Face ID / Fingerabdruck" />
            <Kachel wert={nutzung.anmeldeart.nurPasswort} label="mit Passwort" />
            <Kachel wert={nutzung.anmeldeart.nieAngemeldet} label="noch nie angemeldet" />
          </div>

          {nutzung.tage.length > 0 && (() => {
            const max = Math.max(1, ...nutzung.tage.map(t => Math.max(t.aktive, t.registrierungen)));
            const abIdx = nutzung.aufzeichnungAb
              ? nutzung.tage.findIndex(t => t.datum >= nutzung.aufzeichnungAb!)
              : -1;
            return (
              <>
                <h4 className="stat-untertitel">Registrierungen und tägliche Nutzung</h4>
                <p className="stat-hinweis">
                  Registrierungen gibt es rückwirkend – sie stehen als Datum am Konto.
                  {nutzung.aufzeichnungAb ? (
                    <> Wer an welchem Tag <em>da war</em>, wird erst seit dem{' '}
                      <strong>{new Date(nutzung.aufzeichnungAb).toLocaleDateString('de-DE')}</strong>{' '}
                      festgehalten; davor steht dort null, weil nichts erfasst wurde – nicht,
                      weil niemand da war.</>
                  ) : (
                    <> Die tägliche Nutzung wird ab jetzt erfasst; bisher gibt es dazu nichts,
                      weil die Anmeldespalte am Konto bei jedem Mal überschrieben wird.</>
                  )}
                </p>

                <div className="verlauf-diagramm">
                  {nutzung.tage.map((t, i) => (
                    <div
                      key={t.datum}
                      className="verlauf-tag"
                      title={`${new Date(t.datum).toLocaleDateString('de-DE')}: `
                        + `${t.aktive} aktiv, ${t.anmeldungen} Anmeldungen, ${t.registrierungen} neue Konten`}
                    >
                      <div className="verlauf-saeule">
                        {t.aktive > 0 && (
                          <div
                            className="verlauf-teil verlauf-teil--aktive"
                            style={{ height: `${(t.aktive / max) * 100}%` }}
                          />
                        )}
                        {t.registrierungen > 0 && (
                          <div
                            className="verlauf-teil verlauf-teil--neu"
                            style={{ height: `${(t.registrierungen / max) * 100}%` }}
                          />
                        )}
                        {t.aktive === 0 && t.registrierungen === 0 && (
                          <div className={`verlauf-teil verlauf-teil--leer${
                            abIdx >= 0 && i < abIdx ? ' verlauf-teil--unerfasst' : ''}`} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="verlauf-achse">
                  <span>{new Date(nutzung.tage[0].datum).toLocaleDateString('de-DE')}</span>
                  <span>{new Date(nutzung.tage[nutzung.tage.length - 1].datum).toLocaleDateString('de-DE')}</span>
                </div>

                <div className="verlauf-legende">
                  <span><i className="verlauf-punkt verlauf-punkt--aktive" /> aktive Personen</span>
                  <span><i className="verlauf-punkt verlauf-punkt--neu" /> neue Konten</span>
                  <span><i className="verlauf-punkt verlauf-punkt--unerfasst" /> nicht erfasst</span>
                </div>
              </>
            );
          })()}
        </section>
      )}
    </div>
  );
}
