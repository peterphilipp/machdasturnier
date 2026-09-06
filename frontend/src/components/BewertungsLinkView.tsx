import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, apiPost, apiDelete } from '../api';
import { RatingSkala, RATING_FRAGEN } from './RatingSkala';
import '../styles/components/bewertungslink.css';

/**
 * Bewerten ohne Anmeldung - hier landet, wer in der Mail auf einen Stern tippt.
 *
 * Warum ohne Anmeldung: Im letzten Turnier kam genau EINE Bewertung zurueck.
 * Die Huerde war nicht der Wille, sondern der Weg - App oeffnen, anmelden,
 * Schicht suchen. Der Verein nimmt dafuer in Kauf, dass ein weitergegebener
 * Link eine Bewertung erlaubt; es geht um drei Sterne zu einer Schicht.
 *
 * Der erste Wert kommt schon aus der Mail mit (Parameter `f`) und wird beim
 * Laden abgeschickt. Das ist der Grund, warum die Mail auf diese Seite
 * verlinkt und nicht direkt auf einen schreibenden Endpunkt: Mailprogramme
 * und Sicherheitsscanner rufen Links teilweise von sich aus ab. Bei einem
 * schreibenden Link waere die Bewertung damit abgegeben, bevor der
 * Empfaenger die Mail geoeffnet hat.
 */

interface Kontext {
  name: string | null;
  bereich: string;
  icon: string | null;
  datum: string;
  slot: string;
  /** Vereinsfarbe - die Seite kann sie nicht selbst nachladen, siehe Controller. */
  farbe: string | null;
  /**
   * Die anderen noch unbewerteten Schichten derselben Person, je mit eigenem
   * Token. Damit wer drei Schichten hatte nicht in die Mail zurueckwechseln
   * muss, um die zweite zu finden.
   */
  weitere: { token: string; bereich: string; icon: string | null; datum: string; slot: string }[];
  bereits: {
    ratingWorkload: number | null;
    ratingOrganization: number | null;
    ratingFun: number | null;
    ratingComment: string | null;
  };
}

type Feld = 'ratingWorkload' | 'ratingOrganization' | 'ratingFun';

/** Die Kurznamen in der Mail-URL - lang genug waere unnoetig sperrig. */
const AUS_MAIL: Record<string, Feld> = {
  w: 'ratingWorkload',
  o: 'ratingOrganization',
  f: 'ratingFun'
};

export default function BewertungsLinkView() {
  const [params] = useSearchParams();
  const token = params.get('t') || '';

  const [kontext, setKontext] = useState<Kontext | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [werte, setWerte] = useState<Record<Feld, number | null>>({
    ratingWorkload: null, ratingOrganization: null, ratingFun: null
  });
  const [kommentar, setKommentar] = useState('');
  const [speichert, setSpeichert] = useState(false);
  const [gespeichert, setGespeichert] = useState(false);
  const [kommentarGespeichert, setKommentarGespeichert] = useState(false);
  const [zurueckziehenBestaetigen, setZurueckziehenBestaetigen] = useState(false);
  const [ziehtZurueck, setZiehtZurueck] = useState(false);
  const [zurueckgenommen, setZurueckgenommen] = useState(false);

  /**
   * Der Wert aus der Mail darf nur einmal abgeschickt werden.
   *
   * React fuehrt Effekte im Entwicklungsmodus doppelt aus, und ohne diese
   * Sperre schickte die Seite den Stern aus der Mail zweimal - harmlos in der
   * Wirkung, aber es macht das Nachvollziehen unmoeglich.
   */
  const ausMailGesendet = useRef(false);

  const speichere = useCallback(async (daten: Record<string, number | string | null>) => {
    setSpeichert(true);
    try {
      const antwort = await apiPost<Record<string, unknown>, { bereits: Kontext['bereits'] }>(
        '/api/bewertung-link', { token, ...daten }
      );
      // Die Antwort traegt den Stand aus der Datenbank - damit die Anzeige
      // nicht von dem abweicht, was tatsaechlich gespeichert wurde.
      setWerte({
        ratingWorkload: antwort.bereits.ratingWorkload,
        ratingOrganization: antwort.bereits.ratingOrganization,
        ratingFun: antwort.bereits.ratingFun
      });
      setGespeichert(true);
      return true;
    } catch (err) {
      setFehler((err as Error).message || 'Die Bewertung konnte nicht gespeichert werden.');
      return false;
    } finally {
      setSpeichert(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setFehler('Dieser Link ist unvollständig.');
      return;
    }
    let abgebrochen = false;

    (async () => {
      try {
        const k = await apiFetch<Kontext>(`/api/bewertung-link/kontext?token=${encodeURIComponent(token)}`);
        if (abgebrochen) return;
        setKontext(k);
        setWerte({
          ratingWorkload: k.bereits.ratingWorkload,
          ratingOrganization: k.bereits.ratingOrganization,
          ratingFun: k.bereits.ratingFun
        });
        setKommentar(k.bereits.ratingComment ?? '');

        // Jetzt erst den Wert aus der Mail - vorher wuesste die Seite nicht,
        // ob der Link ueberhaupt gilt.
        for (const [kurz, feld] of Object.entries(AUS_MAIL)) {
          const rohwert = params.get(kurz);
          if (!rohwert) continue;
          const stufe = Number(rohwert);
          if (!Number.isInteger(stufe) || stufe < 1 || stufe > 5) continue;
          if (ausMailGesendet.current) break;
          ausMailGesendet.current = true;
          await speichere({ [feld]: stufe });
          break;
        }
      } catch (err) {
        if (!abgebrochen) setFehler((err as Error).message || 'Dieser Link ist nicht mehr gültig.');
      }
    })();

    return () => { abgebrochen = true; };
  }, [token, params, speichere]);

  const setzeStufe = (feld: Feld, stufe: number) => {
    // Sofort anzeigen, dann speichern: Ein Knopf, der erst nach der Antwort
    // reagiert, fuehlt sich auf dem Handy kaputt an.
    setWerte(v => ({ ...v, [feld]: stufe }));
    void speichere({ [feld]: stufe });
  };

  const speichereKommentar = async () => {
    const ok = await speichere({ ratingComment: kommentar.trim() || null });
    if (ok) setKommentarGespeichert(true);
  };

  /**
   * Ein eigener Endpunkt (DELETE), keine Sterne auf null setzen.
   *
   * `speichere()` schickt nur an, was sich gerade aendert - ein Aufruf mit
   * lauter null wuerde von der Serverseite als "nichts angegeben" verworfen
   * (siehe bewertungsLink.controller.ts), und selbst wenn nicht, waere ein
   * pauschales null-Setzen ueber denselben Weg wie das Speichern zu leicht
   * aus Versehen ausloesbar. Das Zuruecknehmen ist deshalb ein bewusster,
   * eigener Schritt mit Bestaetigung davor.
   */
  const nimmZurueck = async () => {
    setZiehtZurueck(true);
    try {
      await apiDelete(`/api/bewertung-link?token=${encodeURIComponent(token)}`);
      setWerte({ ratingWorkload: null, ratingOrganization: null, ratingFun: null });
      setKommentar('');
      setKommentarGespeichert(false);
      setGespeichert(false);
      setZurueckziehenBestaetigen(false);
      setZurueckgenommen(true);
    } catch (err) {
      setFehler((err as Error).message || 'Die Bewertung konnte nicht zurückgenommen werden.');
    } finally {
      setZiehtZurueck(false);
    }
  };

  if (fehler && !kontext) {
    return (
      <div className="bewertung-seite">
        <div className="bewertung-karte bewertung-karte--zentriert">
          <div className="bewertung-symbol">⌛</div>
          <h1 className="bewertung-titel">Link nicht mehr gültig</h1>
          <p className="bewertung-text">{fehler}</p>
          <p className="bewertung-text">
            Bewerten geht weiterhin in der App unter „Deine Jobs“.
          </p>
          <a className="bewertung-knopf" href="/">Zur App</a>
        </div>
      </div>
    );
  }

  if (!kontext) {
    return (
      <div className="bewertung-seite">
        <div className="bewertung-karte bewertung-karte--zentriert">
          <p className="bewertung-text">Wird geladen …</p>
        </div>
      </div>
    );
  }

  const alleBeantwortet = RATING_FRAGEN.every(f => werte[f.feld] != null);
  const etwasVorhanden = RATING_FRAGEN.some(f => werte[f.feld] != null) || kommentar.trim() !== '';

  return (
    // Die Vereinsfarbe als CSS-Variable: Dieselbe Variable benutzt die
    // angemeldete App, die Skala uebernimmt sie damit unveraendert.
    <div
      className="bewertung-seite"
      style={kontext.farbe ? ({ '--club-primary': kontext.farbe } as React.CSSProperties) : undefined}
    >
      <div className="bewertung-karte">
        <div className="bewertung-kopf">
          <div className="bewertung-kopf-symbol">{kontext.icon || '🏆'}</div>
          <div>
            <div className="bewertung-kopf-label">Deine Schicht</div>
            <div className="bewertung-kopf-bereich">{kontext.bereich}</div>
            <div className="bewertung-kopf-zeit">
              {new Date(kontext.datum).toLocaleDateString('de-DE', {
                weekday: 'long', day: 'numeric', month: 'long'
              })}
              {kontext.slot ? ` · ${kontext.slot}` : ''}
            </div>
          </div>
        </div>

        <h1 className="bewertung-titel">
          {kontext.name ? `Danke, ${kontext.name}!` : 'Danke fürs Mithelfen!'}
        </h1>
        <p className="bewertung-text">
          Drei Fragen, drei Klicks. Jede Antwort ist sofort gespeichert – du kannst
          jederzeit aufhören oder etwas ändern.
        </p>

        <div className="bewertung-fragen">
          {RATING_FRAGEN.map(f => (
            <RatingSkala
              key={f.feld}
              frage={f.frage}
              stufen={f.stufen}
              symbole={f.symbole}
              wert={werte[f.feld]}
              onChange={stufe => setzeStufe(f.feld, stufe)}
            />
          ))}

          <div className="rating-feld">
            <label className="rating-feld-label" htmlFor="bewertung-kommentar">
              Was können wir besser machen? (optional)
            </label>
            <textarea
              id="bewertung-kommentar"
              className="rating-kommentar"
              value={kommentar}
              onChange={e => { setKommentar(e.target.value); setKommentarGespeichert(false); }}
              placeholder="z. B. fehlendes Material, Uhrzeit, Einweisung …"
              rows={3}
              maxLength={1000}
            />
            <button
              type="button"
              className="bewertung-knopf"
              onClick={speichereKommentar}
              disabled={speichert || kommentarGespeichert}
            >
              {kommentarGespeichert ? 'Gespeichert ✓' : 'Notiz speichern'}
            </button>
          </div>
        </div>

        {/* Der Fehler steht unten und ersetzt nicht das Formular: Wenn der
            dritte Klick nicht durchkam, sollen die ersten zwei nicht
            verschwinden. */}
        {fehler && <p className="bewertung-fehler">{fehler}</p>}

        {gespeichert && !fehler && (
          <p className="bewertung-bestaetigung">
            {alleBeantwortet
              ? kontext.weitere.length > 0
                ? '✓ Diese Schicht ist durch. Danke!'
                : '✓ Alles gespeichert – das war’s. Danke!'
              : '✓ Gespeichert. Die restlichen Fragen kannst du noch beantworten.'}
          </p>
        )}

        {zurueckgenommen && !fehler && (
          <p className="bewertung-bestaetigung">
            ✓ Zurückgenommen. Die Sterne oben sind wieder leer – du kannst jederzeit neu bewerten.
          </p>
        )}

        {/* Nur anbieten, wenn es ueberhaupt etwas zurueckzunehmen gibt - sonst
            stuende ein Knopf da, der nichts tut. Zwischenschritt statt eines
            einzelnen Klicks: Das loescht alle drei Antworten und die Notiz
            auf einmal, das soll nicht aus Versehen passieren. */}
        {etwasVorhanden && !zurueckziehenBestaetigen && (
          <button
            type="button"
            className="bewertung-zuruecknehmen-link"
            onClick={() => setZurueckziehenBestaetigen(true)}
          >
            Bewertung zurücknehmen
          </button>
        )}
        {zurueckziehenBestaetigen && (
          <div className="bewertung-zuruecknehmen-bestaetigung">
            <p>Wirklich zurücknehmen? Alle drei Antworten und deine Notiz werden gelöscht.</p>
            <div className="bewertung-zuruecknehmen-aktionen">
              <button type="button" className="bewertung-knopf-sekundaer" onClick={() => setZurueckziehenBestaetigen(false)}>
                Doch nicht
              </button>
              <button type="button" className="bewertung-knopf-gefahr" onClick={nimmZurueck} disabled={ziehtZurueck}>
                {ziehtZurueck ? 'Wird zurückgenommen …' : 'Ja, zurücknehmen'}
              </button>
            </div>
          </div>
        )}

        {/* Der Weg zur naechsten Schicht steht immer da, nicht erst nach dem
            Absenden: Wer sieht, dass es zwei weitere gibt, entscheidet selbst,
            ob er sie gleich mitmacht - eine Kette, die sich erst nach dem
            letzten Klick zeigt, wirkt wie ein Nachhaken. */}
        {kontext.weitere.length > 0 && (
          <div className="bewertung-weitere">
            <div className="bewertung-weitere-titel">
              {kontext.weitere.length === 1
                ? 'Du hattest noch eine Schicht:'
                : `Du hattest noch ${kontext.weitere.length} Schichten:`}
            </div>
            {kontext.weitere.map(w => (
              // Ein echter Link und kein Zustandswechsel: Die Seite baut sich
              // damit vollstaendig fuer die neue Schicht auf, ohne dass hier
              // Reste der alten stehen bleiben koennen.
              <a key={w.token} className="bewertung-weitere-zeile" href={`/bewerten?t=${encodeURIComponent(w.token)}`}>
                <span className="bewertung-weitere-symbol">{w.icon || '📍'}</span>
                <span className="bewertung-weitere-text">
                  <strong>{w.bereich}</strong>
                  <span>
                    {new Date(w.datum).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}
                    {w.slot ? ` · ${w.slot}` : ''}
                  </span>
                </span>
                <span className="bewertung-weitere-pfeil">→</span>
              </a>
            ))}
          </div>
        )}

        <p className="bewertung-fuss">
          Die Antworten entscheiden, wie wir das nächste Turnier planen – wo eine Person
          mehr eingeplant wird und wo es zu ruhig war.
        </p>
      </div>
    </div>
  );
}
