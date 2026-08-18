import { useEffect, useState } from 'react';

/**
 * Kennzeichnung der Testumgebung.
 *
 * Anlass: Ein Helfer bekam den Link zur Testumgebung geschickt, sah eine
 * Anmeldemaske, die von der echten nicht zu unterscheiden war, und probierte
 * dort vergeblich sein richtiges Passwort - bis er nach zu vielen Versuchen
 * gesperrt war. Weder er noch die Turnierleitung kamen darauf, dass er
 * schlicht am falschen Ort war.
 *
 * Zwei Stufen:
 *  - ein dauerhaftes Streifenband ganz oben, das nichts blockiert
 *  - ein blockierender Hinweis, solange niemand angemeldet ist - denn genau
 *    dort landet der Fehlgeleitete, und dort konkurriert ein schlankes Band
 *    mit dem Formular, auf das er gerade schaut
 *
 * Schwarz-Gelb statt Rot: Rot heisst in dieser App "etwas ist kaputt". Die
 * Testumgebung ist nicht kaputt, sie ist die falsche.
 */
export interface UmgebungsInfo {
  istTest: boolean;
  bezeichnung: string | null;
  produktivUrl: string | null;
}

const STREIFEN = 'repeating-linear-gradient(135deg, #EF9F27 0 10px, #BA7517 10px 20px)';

/** Fragt einmalig beim Server nach. Bei Fehlern gilt "keine Testumgebung". */
export function useUmgebung(): UmgebungsInfo {
  const [info, setInfo] = useState<UmgebungsInfo>({ istTest: false, bezeichnung: null, produktivUrl: null });

  useEffect(() => {
    let abgebrochen = false;
    fetch('/api/environment')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && !abgebrochen) setInfo(d); })
      .catch(() => { /* Ohne Auskunft bleibt es bei "Produktion" - siehe Kommentar im Router. */ });
    return () => { abgebrochen = true; };
  }, []);

  // Titel, Themenfarbe und App-Name mitzeichnen. Wichtig fuer den Fall, dass
  // jemand die Testversion auf den Startbildschirm legt: sonst stehen dort
  // zwei nicht unterscheidbare Symbole nebeneinander.
  useEffect(() => {
    if (!info.istTest) return;
    const vorher = document.title;
    if (!document.title.startsWith('[TEST]')) document.title = `[TEST] ${document.title}`;
    const meta = document.querySelector('meta[name="theme-color"]');
    const farbeVorher = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', '#BA7517');
    return () => {
      document.title = vorher;
      if (farbeVorher) meta?.setAttribute('content', farbeVorher);
    };
  }, [info.istTest]);

  return info;
}

/** Schlankes Band ganz oben. Blockiert nichts, verschwindet nie. */
export function TestumgebungsBand({ info }: { info: UmgebungsInfo }) {
  if (!info.istTest) return null;
  return (
    <div style={{
      background: STREIFEN, display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 10px', position: 'relative', zIndex: 9998
    }}>
      <span style={{ fontSize: 15, color: '#412402' }} aria-hidden="true">⚠️</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#412402', lineHeight: 1.3, flex: 1 }}>
        {info.bezeichnung || 'Testumgebung'} – Daten sind nicht echt
      </span>
      {info.produktivUrl && (
        <a
          href={info.produktivUrl}
          style={{
            fontSize: 12, fontWeight: 700, background: '#412402', color: '#FAEEDA',
            borderRadius: 5, padding: '5px 9px', whiteSpace: 'nowrap', textDecoration: 'none'
          }}
        >
          Zur echten App
        </a>
      )}
    </div>
  );
}

/**
 * Blockierender Hinweis. Wird nur eingebunden, wo niemand angemeldet ist
 * (Anmelden, Registrieren, Passwort zuruecksetzen).
 *
 * Bewusst kein "nie wieder zeigen": Wer hier landet, ist in aller Regel genau
 * einmal hier - und wer wirklich testet, ist nach dem Anmelden ohnehin durch.
 */
export function TestumgebungsHinweis({ info }: { info: UmgebungsInfo }) {
  const [weg, setWeg] = useState(false);
  if (!info.istTest || weg) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#FAEEDA', border: '2px solid #BA7517', borderRadius: 14,
        padding: 20, maxWidth: 420, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.35)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }} aria-hidden="true">⚠️</span>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#412402', letterSpacing: '0.06em' }}>
            {(info.bezeichnung || 'Testumgebung').toUpperCase()}
          </div>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#633806', lineHeight: 1.6 }}>
          Das hier ist die Spielwiese zum Ausprobieren. Deine Anmeldedaten aus der echten App
          funktionieren hier nicht, und nichts, was du einträgst, zählt für das Turnier.
        </p>
        {info.produktivUrl && (
          <a
            href={info.produktivUrl}
            style={{
              display: 'block', textAlign: 'center', background: '#BA7517', color: '#fff',
              fontSize: 15, fontWeight: 700, borderRadius: 8, padding: '13px 16px',
              textDecoration: 'none', minHeight: 44, boxSizing: 'border-box'
            }}
          >
            Zur echten App wechseln
          </a>
        )}
        <button
          onClick={() => setWeg(true)}
          style={{
            display: 'block', width: '100%', textAlign: 'center', background: 'none',
            border: 'none', color: '#854F0B', fontSize: 13, padding: '12px 0 0',
            cursor: 'pointer', minHeight: 44
          }}
        >
          Ich will wirklich testen
        </button>
      </div>
    </div>
  );
}
