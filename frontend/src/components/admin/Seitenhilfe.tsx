import { useState } from 'react';
import { SEITENHILFE, seitenSchluessel } from './hilfe';

/**
 * Kontexthilfe: ein „?" am Seitenkopf, das eine Erklärung zur aktuellen Seite
 * aufklappt – wofür sie da ist, wie der Ablauf geht, was man übersieht.
 *
 * Bewusst kein Tooltip: Die App wird am Turniertag auf iPad und Handy bedient,
 * dort gibt es kein Hover. Und bewusst keine geführte Tour mit Sprechblasen –
 * die bricht bei jeder Oberflächenänderung und wird ohnehin weggeklickt.
 *
 * Die Texte stehen in hilfe.ts, nicht hier: siehe Begründung dort.
 */
export default function Seitenhilfe({ pfad }: { pfad: string }) {
  const [offen, setOffen] = useState(false);
  const hilfe = SEITENHILFE[seitenSchluessel(pfad)];
  if (!hilfe) return null;

  return (
    <>
      <button
        onClick={() => setOffen(true)}
        aria-label="Hilfe zu dieser Seite"
        title="Wofür ist diese Seite da?"
        style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          border: '1px solid #badbcc', background: '#d1e7dd', color: '#0f5132',
          fontSize: 15, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
        }}
      >
        ?
      </button>

      {offen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOffen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9997, background: 'rgba(0,0,0,0.45)',
            display: 'flex', justifyContent: 'flex-end'
          }}
        >
          {/* Seitenleiste statt Dialog in der Mitte: So bleibt die Seite daneben
              sichtbar, über die gerade gesprochen wird. */}
          <div style={{
            background: '#fff', width: 'min(420px, 100%)', height: '100%',
            overflowY: 'auto', padding: 20, boxShadow: '-8px 0 30px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: '#212529' }}>
                Hilfe zu dieser Seite
              </div>
              <button
                onClick={() => setOffen(false)}
                aria-label="Schließen"
                style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#6c757d', lineHeight: 1, minHeight: 44, minWidth: 44 }}
              >
                ×
              </button>
            </div>

            <p style={{ margin: '0 0 18px', fontSize: 15, color: '#212529', lineHeight: 1.6 }}>
              {hilfe.zweck}
            </p>

            <div style={{ fontSize: 13, fontWeight: 700, color: '#495057', marginBottom: 8, letterSpacing: '0.03em' }}>
              SO GEHT DER ABLAUF
            </div>
            <ol style={{ margin: '0 0 20px', paddingLeft: 20, fontSize: 14, color: '#495057', lineHeight: 1.65 }}>
              {hilfe.ablauf.map((schritt, i) => (
                <li key={i} style={{ marginBottom: 7 }}>{schritt}</li>
              ))}
            </ol>

            {hilfe.hinweise && hilfe.hinweise.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#495057', marginBottom: 8, letterSpacing: '0.03em' }}>
                  GUT ZU WISSEN
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: '#495057', lineHeight: 1.65 }}>
                  {hilfe.hinweise.map((h, i) => (
                    <li key={i} style={{ marginBottom: 9 }}>{h}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
