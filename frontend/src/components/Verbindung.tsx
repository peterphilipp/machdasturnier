import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';

/**
 * Sichtbarer Verbindungszustand.
 *
 * Anlass: Wenn der Server nicht erreichbar war, blieben Listen einfach leer.
 * Ein Helfer sah "keine Schichten" und schloss daraus, er sei nicht
 * eingeteilt. Ein Fehler, der wie Leere aussieht, ist schlimmer als ein
 * Fehler - deshalb muss der Zustand sichtbar sein, egal auf welcher Seite.
 */

/** Band am oberen Rand, solange keine Verbindung besteht. */
export function Verbindungsband() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const queryClient = useQueryClient();
  const laeuft = useIsFetching() > 0;

  useEffect(() => {
    const wiederDa = () => {
      setOffline(false);
      // Sofort nachladen statt auf das nächste Intervall zu warten - der
      // Nutzer steht in aller Regel genau deshalb wieder vor dem Gerät.
      queryClient.invalidateQueries();
    };
    const weg = () => setOffline(true);
    window.addEventListener('online', wiederDa);
    window.addEventListener('offline', weg);
    return () => {
      window.removeEventListener('online', wiederDa);
      window.removeEventListener('offline', weg);
    };
  }, [queryClient]);

  if (!offline) return null;

  return (
    <div style={{
      background: '#FCEBEB', borderBottom: '1px solid #F09595',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', position: 'relative', zIndex: 9996
    }}>
      <span style={{ fontSize: 15 }} aria-hidden="true">📡</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#791F1F', lineHeight: 1.4, flex: 1 }}>
        Keine Verbindung – angezeigte Daten können unvollständig sein.
      </span>
      {laeuft && <span style={{ fontSize: 12, color: '#A32D2D' }}>versuche erneut …</span>}
    </div>
  );
}

/**
 * Fehleranzeige für eine Liste, die nicht geladen werden konnte.
 *
 * Bewusst NICHT als leere Liste: Drei Zustände müssen unterscheidbar bleiben -
 * lädt gerade, konnte nicht geladen werden, ist tatsächlich leer.
 */
export function Ladefehler({ fehler, erneut, was = 'Die Daten' }: {
  fehler: unknown;
  erneut?: () => void;
  /** Was konnte nicht geladen werden, z.B. "Deine Schichten". */
  was?: string;
}) {
  const text = fehler instanceof Error && fehler.message
    ? fehler.message
    : 'Unbekannter Fehler.';

  return (
    <div style={{
      background: '#FCEBEB', border: '1px solid #F09595', borderRadius: 12,
      padding: 16, display: 'flex', gap: 10, alignItems: 'flex-start'
    }}>
      <span style={{ fontSize: 18 }} aria-hidden="true">⚠️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#791F1F', marginBottom: 3 }}>
          {was} konnten nicht geladen werden
        </div>
        <div style={{ fontSize: 13, color: '#A32D2D', lineHeight: 1.5, marginBottom: erneut ? 10 : 0 }}>
          {text}
        </div>
        {erneut && (
          <button
            onClick={erneut}
            style={{
              background: '#A32D2D', color: '#fff', border: 'none', borderRadius: 8,
              padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 40
            }}
          >
            Erneut versuchen
          </button>
        )}
      </div>
    </div>
  );
}
