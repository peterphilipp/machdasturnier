import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPatch } from '../../../api';
import { modal } from '../Modal';
import '../../../styles/components/statistik.css';

/**
 * Zeitangebote von Helfern, über die zu entscheiden ist.
 *
 * Sitzt eingebettet im Dienstplan (Uebersicht.tsx) statt als eigener Reiter -
 * genau wie die "Zusätzliche Verpflegung ohne Ziel" bei den Spenden: beides
 * ist ein Vorschlag, der zum Dienstplan gehört, nicht ein eigenständiger
 * Themenbereich. Zeigt sich deshalb nur, wenn es tatsächlich etwas gibt -
 * eine leere Karte auf jeder Turnierseite waere nur Ballast.
 *
 * Ein angenommenes Angebot plant NIEMANDEN ein - es ist eine
 * Willensbekundung. Nach dem Annehmen schneidet ihr die Schicht im
 * Dienstplan zu und plant den Helfer dort regulär ein. Automatisch
 * einzuplanen hiesse, Einträge anzulegen, deren Zeit von der Schichtzeit
 * abweicht, und genau das soll nicht wieder passieren.
 */

interface Angebot {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  note: string | null;
  status: 'OFFEN' | 'ANGENOMMEN' | 'ABGELEHNT';
  decisionNote: string | null;
  decidedAt: string | null;
  user?: { id: number; name: string; email?: string | null } | null;
  shift?: { id: number; workArea?: { name?: string; icon?: string } | null } | null;
  workAreas?: { name?: string; icon?: string }[];
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const tagKurz = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

export default function Zeitangebote({
  selectedTournament,
  nurTageOhneDiagramm
}: {
  selectedTournament: number | null;
  /**
   * Tage, die bereits ein Gantt haben. Deren Angebote werden dort direkt
   * entschieden und hier weggelassen - sonst stuende dasselbe zweimal auf
   * der Seite. Ohne diese Angabe (oder auf dem Handy, wo es kein Diagramm
   * gibt) zeigt die Liste alles.
   */
  nurTageOhneDiagramm?: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  // Optionale Rueckmeldung je Angebot. Direkt in der Karte statt im Dialog:
  // so steht beim Schreiben noch da, worauf man antwortet.
  const [notizen, setNotizen] = useState<Record<number, string>>({});
  // Entschiedene Angebote sind Historie, keine Aufgabe - eingeklappt, damit
  // sie die eigentlichen Aufgaben (offene Angebote) nicht verdraengen.
  const [historieOffen, setHistorieOffen] = useState(false);

  const { data: angebote = [] } = useQuery<Angebot[]>({
    queryKey: ['shiftOffers', selectedTournament],
    queryFn: () => apiFetch(`/api/shift-offers?tournamentId=${selectedTournament}`),
    enabled: !!selectedTournament
  });

  // Was im Diagramm des jeweiligen Tages steht, braucht hier keine zweite Zeile.
  const sichtbar = nurTageOhneDiagramm
    ? angebote.filter(a => !nurTageOhneDiagramm.has(new Date(a.date).toLocaleDateString('de-DE')))
    : angebote;

  const offene = sichtbar.filter(a => a.status === 'OFFEN');
  const erledigte = sichtbar.filter(a => a.status !== 'OFFEN');

  const entscheide = async (a: Angebot, status: 'ANGENOMMEN' | 'ABGELEHNT') => {
    const wann = `${tagKurz(a.date)} ${hhmm(a.startMin)}–${hhmm(a.endMin)}`;
    const bestaetigt = await modal.confirm({
      title: status === 'ANGENOMMEN' ? 'Angebot annehmen' : 'Angebot ablehnen',
      message: status === 'ANGENOMMEN'
        ? `${a.user?.name} bekommt eine Zusage für ${wann}. Die Schicht trägst du anschliessend `
          + 'im Dienstplan ein – das passiert nicht automatisch.'
        : `${a.user?.name} bekommt eine Absage für ${wann}.`,
      variant: status === 'ABGELEHNT' ? 'danger' : undefined
    });
    if (!bestaetigt) return;

    setBusyId(a.id);
    try {
      await apiPatch(`/api/shift-offers/${a.id}/entscheidung`, {
        status,
        decisionNote: notizen[a.id]?.trim() || null
      });
      queryClient.invalidateQueries({ queryKey: ['shiftOffers', selectedTournament] });
    } catch (err: unknown) {
      await modal.alert({ title: 'Fehler', message: (err as Error).message || 'Die Entscheidung konnte nicht gespeichert werden.' });
    } finally {
      setBusyId(null);
    }
  };

  // Nichts zu zeigen: kein Turnier, oder schlicht keine Angebote - beides
  // heisst hier "keine Ausgabe", die "leer, aber sichtbar"-Karte lohnt sich
  // nur, wenn tatsaechlich etwas ansteht oder anstand.
  if (!selectedTournament || sichtbar.length === 0) return null;

  /** Der Bezug zur Schicht ist praeziser als die Wunschliste - er gewinnt. */
  const bereicheVon = (a: Angebot): string =>
    a.shift?.workArea?.name
      ? `${a.shift.workArea.icon ?? ''} ${a.shift.workArea.name}`.trim()
      : (a.workAreas ?? []).map(w => `${w.icon ?? ''} ${w.name}`.trim()).join(', ');

  const karte = (a: Angebot, mitAktionen: boolean) => {
    const bereiche = bereicheVon(a);
    return (
      <div key={a.id} className={`angebot-admin-karte angebot-admin-karte--${a.status.toLowerCase()}`}>
        <div className="angebot-admin-kopf">
          <strong>{a.user?.name || 'Unbekannt'}</strong>
          <span className="angebot-admin-zeit">
            {tagKurz(a.date)} · {hhmm(a.startMin)}–{hhmm(a.endMin)}
            {bereiche && <> · {bereiche}</>}
          </span>
        </div>
        {a.note && <div className="angebot-admin-notiz">„{a.note}"</div>}

        {mitAktionen ? (
          <div className="angebot-admin-antwort">
            <input
              className="angebot-admin-notizfeld"
              placeholder="Rückmeldung an den Helfer (optional)"
              maxLength={500}
              value={notizen[a.id] ?? ''}
              onChange={e => setNotizen(prev => ({ ...prev, [a.id]: e.target.value }))}
              aria-label={`Rückmeldung an ${a.user?.name || 'den Helfer'}`}
            />
            <div className="angebot-admin-aktionen">
              <button
                className="angebot-admin-btn angebot-admin-btn--ja"
                disabled={busyId === a.id}
                onClick={() => entscheide(a, 'ANGENOMMEN')}
              >
                Annehmen
              </button>
              <button
                className="angebot-admin-btn angebot-admin-btn--nein"
                disabled={busyId === a.id}
                onClick={() => entscheide(a, 'ABGELEHNT')}
              >
                Ablehnen
              </button>
            </div>
          </div>
        ) : (
          <div className="angebot-admin-erledigt">
            {a.status === 'ANGENOMMEN' ? '👍 angenommen' : 'abgelehnt'}
            {a.decidedAt && <> am {new Date(a.decidedAt).toLocaleDateString('de-DE')}</>}
            {a.decisionNote && <> · „{a.decisionNote}"</>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="angebot-admin-karte-aussen">
      <div className="angebot-admin-kopfzeile">
        <h3 className="angebot-admin-titel">
          🙋 Zeitangebote{offene.length > 0 && <span className="angebot-admin-badge">{offene.length}</span>}
        </h3>
        {erledigte.length > 0 && (
          <button
            type="button"
            className="angebot-admin-historie-btn"
            onClick={() => setHistorieOffen(o => !o)}
            aria-expanded={historieOffen}
          >
            {historieOffen ? 'Verlauf ausblenden' : `Verlauf anzeigen (${erledigte.length})`}
          </button>
        )}
      </div>

      {offene.length > 0 && (
        <>
          <p className="stat-hinweis">
            Ein angenommenes Angebot ist eine Zusage, aber noch keine Einplanung: Trage die Schicht
            danach im Dienstplan ein – bei Bedarf mit passend zugeschnittener Zeit.
          </p>
          <div className="angebot-admin-liste">{offene.map(a => karte(a, true))}</div>
        </>
      )}

      {historieOffen && erledigte.length > 0 && (
        <div className="angebot-admin-liste angebot-admin-liste--historie">
          {erledigte.map(a => karte(a, false))}
        </div>
      )}
    </div>
  );
}
