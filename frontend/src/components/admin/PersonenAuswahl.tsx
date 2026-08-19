import { useState, useMemo, useRef, useEffect } from 'react';

/**
 * Suchbare Auswahl einer Person.
 *
 * Ersetzt das einfache Auswahlfeld überall dort, wo aus dem gesamten
 * Helferkreis gewählt wird. Mit inzwischen über fünfzig Personen ist eine
 * reine Scroll-Liste nicht mehr bedienbar - besonders nicht am Handy, wo das
 * native Auswahlfeld einen Bildschirm voller Namen zeigt, durch den man sich
 * blind wischt.
 *
 * Gesucht wird über Name UND E-Mail: Bei gleichen Vornamen ist die Adresse
 * oft das einzige Unterscheidungsmerkmal.
 */
export interface AuswahlPerson {
  id: number;
  name: string;
  email?: string | null;
  /** Optionale Überschrift, unter der die Person einsortiert wird. */
  gruppe?: string;
}

export default function PersonenAuswahl({
  personen,
  wert,
  onWaehlen,
  platzhalter = 'Name oder E-Mail eingeben …',
  leerText = '-- niemand --',
  erlaubeLeer = true,
  variante = 'feld',
  startetOffen = false
}: {
  personen: AuswahlPerson[];
  wert: number | '';
  onWaehlen: (id: number | '') => void;
  platzhalter?: string;
  leerText?: string;
  erlaubeLeer?: boolean;
  /**
   * 'feld'   - unauffälliges Auswahlfeld in einem Formular.
   * 'aktion' - eigenständige Handlung. Der zugeklappte Zustand sieht dann wie
   *            ein Knopf aus und die Trefferliste steht im Textfluss statt
   *            darüber zu schweben.
   *
   * Anlass für 'aktion': Im Schicht-Dialog übersah man das blasse Feld, weil
   * daneben ein kräftiger Knopf stand und die modale Box direkt danach zu Ende
   * war. Eine schwebende Liste wäre dort zusätzlich vom Dialogrand
   * abgeschnitten worden.
   */
  variante?: 'feld' | 'aktion';
  /** Startet aufgeklappt - z.B. wenn die Schicht noch unbesetzt ist. */
  startetOffen?: boolean;
}) {
  const [offen, setOffen] = useState(startetOffen);
  const [suche, setSuche] = useState('');
  const huelle = useRef<HTMLDivElement>(null);

  const aktion = variante === 'aktion';
  const gewaehlt = personen.find(p => p.id === wert) || null;

  // Klick nach außen schließt - sonst bliebe die Liste über dem Formular
  // stehen, sobald man woanders weiterarbeitet.
  useEffect(() => {
    // Die Liste der Variante 'aktion' steht im Fluss und ist Teil des Layouts -
    // sie darf nicht verschwinden, nur weil man daneben tippt.
    if (!offen || aktion) return;
    const beiKlick = (e: MouseEvent) => {
      if (huelle.current && !huelle.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener('mousedown', beiKlick);
    return () => document.removeEventListener('mousedown', beiKlick);
  }, [offen, aktion]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return personen;
    return personen.filter(p =>
      p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q)
    );
  }, [personen, suche]);

  /** Nach Gruppen sortiert, Reihenfolge der Gruppen wie im Eingabe-Array. */
  const gruppiert = useMemo(() => {
    const map = new Map<string, AuswahlPerson[]>();
    for (const p of treffer) {
      const g = p.gruppe || '';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return [...map.entries()];
  }, [treffer]);

  const waehlen = (id: number | '') => {
    onWaehlen(id);
    setSuche('');
    setOffen(false);
  };

  return (
    <div ref={huelle} style={{ position: 'relative' }}>
      {!offen ? (
        <button
          type="button"
          onClick={() => setOffen(true)}
          style={{
            width: '100%', textAlign: 'left', padding: '12px 14px', minHeight: 44,
            border: aktion ? '1px solid #0d6efd' : '1px solid #ced4da',
            borderRadius: 8, background: aktion ? '#e7f1ff' : '#fff',
            fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          <span aria-hidden="true" style={{ color: aktion ? '#0d6efd' : '#6c757d' }}>🔍</span>
          <span style={{
            flex: 1,
            color: aktion ? '#0a58ca' : (gewaehlt ? '#212529' : '#6c757d'),
            fontWeight: aktion ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {gewaehlt ? `${gewaehlt.name}${gewaehlt.email ? ` (${gewaehlt.email})` : ''}` : leerText}
          </span>
        </button>
      ) : (
        <>
          <input
            autoFocus
            value={suche}
            onChange={e => setSuche(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setSuche(''); setOffen(false); }
              if (e.key === 'Enter' && treffer.length > 0) { e.preventDefault(); waehlen(treffer[0].id); }
            }}
            placeholder={platzhalter}
            style={{
              width: '100%', padding: '12px 14px', minHeight: 44, boxSizing: 'border-box',
              border: '1px solid #0d6efd', borderRadius: 8, fontSize: 16
            }}
          />

          <div style={aktion ? {
            // Im Fluss: Der Schicht-Dialog scrollt selbst und schneidet alles
            // ab, was über seinen Rand hinausragt.
            background: '#fff', border: '1px solid #dee2e6', borderRadius: 8,
            marginTop: 6, maxHeight: 260, overflowY: 'auto'
          } : {
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
            background: '#fff', border: '1px solid #dee2e6', borderRadius: 8,
            marginTop: 4, maxHeight: 280, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
          }}>
            {erlaubeLeer && (
              <button
                type="button"
                onClick={() => waehlen('')}
                style={eintragStil(false)}
              >
                {leerText}
              </button>
            )}

            {treffer.length === 0 && (
              <div style={{ padding: '14px', fontSize: 13, color: '#6c757d', lineHeight: 1.5 }}>
                Niemand gefunden, der zu „{suche}" passt.
              </div>
            )}

            {gruppiert.map(([gruppe, leute]) => (
              <div key={gruppe || '_'}>
                {gruppe && (
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: '#6c757d', letterSpacing: '0.03em',
                    padding: '9px 14px 4px', background: '#f8f9fa'
                  }}>
                    {gruppe}
                  </div>
                )}
                {leute.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => waehlen(p.id)}
                    style={eintragStil(p.id === wert)}
                  >
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    {p.email && <span style={{ color: '#6c757d', fontSize: 12 }}> {p.email}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function eintragStil(aktiv: boolean): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '11px 14px', minHeight: 44, border: 'none',
    borderBottom: '1px solid #f1f3f5',
    background: aktiv ? '#e7f1ff' : '#fff',
    fontSize: 14, cursor: 'pointer', lineHeight: 1.4
  };
}
