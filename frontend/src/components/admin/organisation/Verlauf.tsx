import { useState, useMemo, CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAenderungen } from '../../../api';

/**
 * Sichtbarer Änderungsverlauf des Dienstplans.
 *
 * Mehrere Organisatoren planen gleichzeitig und überschreiben sich dabei
 * gelegentlich, ohne dass es auffällt. Hier steht, wer wann was getan hat -
 * bewusst als Zeitstrahl und mobil-tauglich, weil am Turniertag niemand am
 * Rechner sitzt.
 */
interface Eintrag {
  id: number;
  userId: number | null;
  userName: string;
  art: string;
  beschreibung: string;
  objektTyp: string | null;
  objektId: number | null;
  createdAt: string;
}

interface Beteiligter { userId: number | null; name: string; anzahl: number }

const ARTEN: Record<string, { bg: string; fg: string; label: string }> = {
  schicht: { bg: '#E6F1FB', fg: '#0C447C', label: 'Schicht' },
  helfer: { bg: '#E1F5EE', fg: '#085041', label: 'Helfer' },
  stammdaten: { bg: '#EEEDFE', fg: '#3C3489', label: 'Stammdaten' },
  geloescht: { bg: '#FCEBEB', fg: '#791F1F', label: 'Gelöscht' }
};
const UNBEKANNT = { bg: '#F1EFE8', fg: '#2C2C2A', label: 'Änderung' };

/** "Heute" / "Gestern" / "Mittwoch, 12.8." - Tagesüberschrift im Zeitstrahl. */
function tagesTitel(iso: string): string {
  const d = new Date(iso);
  const heute = new Date();
  const tag = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((tag(heute) - tag(d)) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

/** Initialen für den Punkt am Zeitstrahl - zwei Zeichen reichen zum Unterscheiden. */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return '?';
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

export default function Verlauf({ selectedTournament }: { selectedTournament: number | null }) {
  const [art, setArt] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  // Blätternd geladen: jede Seite hängt hinten an, statt die vorige zu ersetzen.
  const [seiten, setSeiten] = useState<number[]>([]);
  const [gesammelt, setGesammelt] = useState<Eintrag[]>([]);

  const { data, isLoading } = useQuery<{ eintraege: Eintrag[]; gibtMehr: boolean; beteiligte: Beteiligter[] }>({
    queryKey: ['aenderungen', selectedTournament, art, userId, seiten.length],
    queryFn: () => getAenderungen(selectedTournament as number, {
      art, userId, vor: seiten[seiten.length - 1] ?? null, limit: 30
    }),
    enabled: !!selectedTournament,
    refetchInterval: 30000
  });

  const eintraege = useMemo(() => {
    if (!data) return gesammelt;
    if (seiten.length === 0) return data.eintraege;
    const bekannt = new Set(gesammelt.map(e => e.id));
    return [...gesammelt, ...data.eintraege.filter(e => !bekannt.has(e.id))];
  }, [data, gesammelt, seiten.length]);

  /** Beim Filterwechsel von vorn beginnen - sonst mischten sich alte Seiten dazu. */
  const mitZuruecksetzen = (aendern: () => void) => {
    setSeiten([]);
    setGesammelt([]);
    aendern();
  };

  if (!selectedTournament) {
    return <div style={{ padding: 24, color: '#6c757d' }}>Bitte oben ein Turnier auswählen.</div>;
  }

  const chip = (aktiv: boolean): CSSProperties => ({
    fontSize: 12, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', minHeight: 32,
    border: `1px solid ${aktiv ? '#0d6efd' : '#dee2e6'}`,
    background: aktiv ? '#e7f1ff' : '#fff',
    color: aktiv ? '#0d6efd' : '#6c757d',
    fontWeight: aktiv ? 600 : 400
  });

  let letzterTag: string | null = null;

  return (
    <div style={{ padding: 16, maxWidth: 760 }}>
      <div style={{ marginBottom: 6, fontSize: 15, fontWeight: 600, color: '#212529' }}>🕓 Verlauf</div>
      <div style={{ fontSize: 13, color: '#6c757d', lineHeight: 1.6, marginBottom: 12 }}>
        Wer hat wann was am Dienstplan geändert. Einträge älter als 90 Tage werden automatisch entfernt.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={chip(!art && !userId)} onClick={() => mitZuruecksetzen(() => { setArt(null); setUserId(null); })}>
          Alle
        </button>
        {Object.entries(ARTEN).map(([schluessel, a]) => (
          <button
            key={schluessel}
            style={chip(art === schluessel)}
            onClick={() => mitZuruecksetzen(() => setArt(art === schluessel ? null : schluessel))}
          >
            {a.label}
          </button>
        ))}
        {(data?.beteiligte || []).map(b => (
          <button
            key={String(b.userId)}
            style={chip(userId === b.userId)}
            onClick={() => mitZuruecksetzen(() => setUserId(userId === b.userId ? null : b.userId))}
          >
            {b.name} ({b.anzahl})
          </button>
        ))}
      </div>

      {isLoading && eintraege.length === 0 && (
        <div style={{ color: '#6c757d', fontSize: 14 }}>Wird geladen …</div>
      )}

      {!isLoading && eintraege.length === 0 && (
        <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 20, color: '#6c757d', fontSize: 14, lineHeight: 1.6 }}>
          Noch keine Änderungen aufgezeichnet. Sobald jemand Schichten anlegt, verschiebt oder Helfer
          einplant, erscheint das hier.
        </div>
      )}

      {eintraege.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e9ecef', overflow: 'hidden' }}>
          {eintraege.map(e => {
            const a = ARTEN[e.art] || UNBEKANNT;
            const titel = tagesTitel(e.createdAt);
            const neuerTag = titel !== letzterTag;
            letzterTag = titel;
            return (
              <div key={e.id}>
                {neuerTag && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', padding: '12px 14px 5px', letterSpacing: '0.04em' }}>
                    {titel}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, padding: '9px 14px', position: 'relative' }}>
                  {/* Verbindungslinie des Zeitstrahls */}
                  <div style={{ position: 'absolute', left: 27, top: 0, bottom: 0, width: 1, background: '#e9ecef' }} />
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', flex: '0 0 28px', zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, background: a.bg, color: a.fg
                  }}>
                    {initialen(e.userName)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#adb5bd', marginBottom: 2 }}>
                      {new Date(e.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 14, color: '#212529', lineHeight: 1.5 }}>
                      <span style={{
                        display: 'inline-block', fontSize: 11, borderRadius: 4, padding: '1px 6px',
                        marginRight: 6, background: a.bg, color: a.fg, verticalAlign: 1
                      }}>
                        {a.label}
                      </span>
                      <strong style={{ fontWeight: 600 }}>{e.userName}</strong> {e.beschreibung}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {data?.gibtMehr && (
            <button
              onClick={() => {
                setGesammelt(eintraege);
                setSeiten([...seiten, eintraege[eintraege.length - 1].id]);
              }}
              style={{
                width: '100%', border: 'none', borderTop: '1px solid #e9ecef', background: '#fff',
                color: '#0d6efd', fontSize: 13, padding: 13, cursor: 'pointer', minHeight: 44
              }}
            >
              Ältere anzeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
