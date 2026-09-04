import { useEffect, useState } from 'react';
import { VolunteerShift } from '../shared';

/**
 * Ansprechpartner fuer den Fuss der Stationszettel.
 *
 * Im Footer stand bisher "Notfall / Turnierleitung: Siehe Aushang". Das ist
 * genau dann nutzlos, wenn es gebraucht wird: Wer an der Station steht und ein
 * Problem hat, soll eine Nummer waehlen koennen und nicht erst einen Aushang
 * suchen muessen.
 *
 * Zwei Wege, weil beide vorkommen: Die Turnierleitung steht meist selbst im
 * Dienstplan und laesst sich dort auswaehlen - der Platzwart oder der
 * Hallenschluessel-Inhaber aber nicht, der braucht die freie Eingabe.
 *
 * Ausgewaehlte Eintraege bleiben danach editierbar. Eine im Profil hinterlegte
 * Nummer ist nicht zwingend die, unter der jemand am Turniertag erreichbar
 * ist, und der Zettel soll sich korrigieren lassen, ohne die Stammdaten
 * anzufassen.
 */

export interface Kontakt {
  id: string;
  name: string;
  telefon: string;
}

const neueId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const speicherSchluessel = (tournamentId: number | null | undefined) =>
  `stationszettel-kontakte-${tournamentId ?? 'ohne'}`;

/**
 * Die Kontakte ueberleben das Schliessen des Dialogs.
 *
 * Ein Turnier wird oft in mehreren Anlaeufen gedruckt - erst ein Testblatt,
 * spaeter alle Stationen. Die Ansprechpartner jedes Mal neu einzutippen waere
 * die sicherste Art, sie am Ende wegzulassen.
 *
 * Bewusst nur im Browser und nicht am Turnier gespeichert: Es sind
 * Telefonnummern fuer einen Ausdruck, keine Stammdaten. Sie serverseitig
 * abzulegen hiesse, eine weitere Kopie personenbezogener Daten zu fuehren,
 * die niemand mehr aufraeumt.
 */
export function useKontakte(tournamentId: number | null | undefined) {
  const [kontakte, setKontakte] = useState<Kontakt[]>([]);

  useEffect(() => {
    try {
      const roh = localStorage.getItem(speicherSchluessel(tournamentId));
      const gelesen = roh ? JSON.parse(roh) : [];
      setKontakte(Array.isArray(gelesen) ? gelesen : []);
    } catch {
      setKontakte([]);
    }
  }, [tournamentId]);

  useEffect(() => {
    try {
      localStorage.setItem(speicherSchluessel(tournamentId), JSON.stringify(kontakte));
    } catch {
      // Privater Modus oder volles Kontingent - der Ausdruck funktioniert trotzdem.
    }
  }, [kontakte, tournamentId]);

  return [kontakte, setKontakte] as const;
}

/** Die eingeplanten Helfer, jeder einmal, alphabetisch. */
function helferListe(volunteerShifts: VolunteerShift[]) {
  const proPerson = new Map<number, { id: number; name: string; telefon: string }>();
  for (const vs of volunteerShifts) {
    if (!vs.user?.id || proPerson.has(vs.user.id)) continue;
    proPerson.set(vs.user.id, {
      id: vs.user.id,
      name: vs.user.name,
      telefon: vs.user.phone || ''
    });
  }
  return [...proPerson.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function KontakteEditor({
  kontakte,
  setKontakte,
  volunteerShifts
}: {
  kontakte: Kontakt[];
  setKontakte: (k: Kontakt[]) => void;
  volunteerShifts: VolunteerShift[];
}) {
  const helfer = helferListe(volunteerShifts);

  const uebernehmen = (userId: string) => {
    const person = helfer.find(h => String(h.id) === userId);
    if (!person) return;
    setKontakte([...kontakte, { id: neueId(), name: person.name, telefon: person.telefon }]);
  };

  const aendern = (id: string, feld: 'name' | 'telefon', wert: string) =>
    setKontakte(kontakte.map(k => (k.id === id ? { ...k, [feld]: wert } : k)));

  return (
    <div className="station-print-kontakte">
      <div className="station-print-kontakte-kopf">
        <label>📞 Ansprechpartner im Fußzeilen-Bereich</label>
        <span className="station-print-kontakte-hinweis">
          Steht auf jedem Blatt. Name und Nummer sind für alle sichtbar, die den Zettel an der
          Station lesen – bitte nur mit Einverständnis der Person.
        </span>
      </div>

      {kontakte.length > 0 && (
        <div className="station-print-kontakte-liste">
          {kontakte.map(k => (
            <div key={k.id} className="station-print-kontakt-zeile">
              <input
                className="station-print-input"
                value={k.name}
                onChange={e => aendern(k.id, 'name', e.target.value)}
                placeholder="Name oder Funktion, z. B. Turnierleitung"
                aria-label="Name des Ansprechpartners"
              />
              <input
                className="station-print-input"
                value={k.telefon}
                onChange={e => aendern(k.id, 'telefon', e.target.value)}
                placeholder="Telefonnummer"
                inputMode="tel"
                aria-label="Telefonnummer des Ansprechpartners"
              />
              <button
                className="station-print-kontakt-weg"
                onClick={() => setKontakte(kontakte.filter(x => x.id !== k.id))}
                aria-label={`${k.name || 'Eintrag'} entfernen`}
                title="Entfernen"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="station-print-kontakte-aktionen">
        {/* value bleibt leer: die Auswahl ist ein Befehl ("diesen hinzufuegen"),
            kein Zustand - sonst stuende dort dauerhaft ein Name, der nichts
            mehr ueber die Liste darunter aussagt. */}
        <select
          className="station-print-select"
          value=""
          onChange={e => { uebernehmen(e.target.value); e.target.value = ''; }}
          disabled={helfer.length === 0}
        >
          <option value="">
            {helfer.length === 0 ? 'Keine eingeplanten Helfer' : '＋ Aus dem Dienstplan übernehmen …'}
          </option>
          {helfer.map(h => (
            <option key={h.id} value={String(h.id)}>
              {h.name}{h.telefon ? ` · ${h.telefon}` : ' · keine Nummer hinterlegt'}
            </option>
          ))}
        </select>

        <button
          className="station-print-kontakt-neu"
          onClick={() => setKontakte([...kontakte, { id: neueId(), name: '', telefon: '' }])}
        >
          ＋ Freier Eintrag
        </button>
      </div>
    </div>
  );
}

/**
 * Die Ansprechpartner, wie sie im Fuss jedes Blattes erscheinen.
 *
 * Eigene Zeile ueber den Herkunftsangaben, nicht als mittlere Spalte
 * dazwischen: In einer Dreierreihe bekommen die Kontakte nur den Rest der
 * Breite, und der Umbruch trennt dann mitten im Eintrag Name von Nummer -
 * "Sven Koinecke:" oben, die Nummer eine Zeile tiefer. Fuer den, der an der
 * Station steht und waehlen will, ist genau das die unbrauchbare Variante.
 *
 * Jeder Eintrag ist deshalb ein eigenes, in sich unteilbares Element in einer
 * umbrechenden Reihe. Damit traegt die Zeile einen Kontakt genauso wie fuenf:
 * es kommen Zeilen dazu, aber nie ein Umbruch innerhalb eines Eintrags.
 */
export function KontakteFooter({ kontakte }: { kontakte: Kontakt[] }) {
  // Halbfertige Zeilen gehoeren nicht auf den Ausdruck: ein Name ohne Nummer
  // hilft niemandem, eine Nummer ohne Name auch nicht.
  const fertig = kontakte.filter(k => k.name.trim() && k.telefon.trim());

  if (fertig.length === 0) {
    return (
      <div className="station-print-kontaktzeile">
        <span className="station-print-kontaktzeile-titel">📞 Notfall / Turnierleitung:</span>
        <span className="station-print-kontakt">Siehe Aushang</span>
      </div>
    );
  }

  return (
    <div className="station-print-kontaktzeile">
      <span className="station-print-kontaktzeile-titel">📞 Ansprechpartner:</span>
      {fertig.map(k => (
        <span key={k.id} className="station-print-kontakt">
          {k.name}: <span className="station-print-kontakt-nummer">{k.telefon}</span>
        </span>
      ))}
    </div>
  );
}
