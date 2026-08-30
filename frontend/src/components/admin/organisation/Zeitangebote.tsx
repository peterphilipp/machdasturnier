import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPatch } from '../../../api';
import { modal } from '../Modal';
import '../../../styles/components/statistik.css';

/**
 * Zeitangebote von Helfern, über die zu entscheiden ist.
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
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const tagKurz = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

export default function Zeitangebote({ selectedTournament }: { selectedTournament: number | null }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  // Optionale Rueckmeldung je Angebot. Direkt in der Karte statt im Dialog:
  // so steht beim Schreiben noch da, worauf man antwortet.
  const [notizen, setNotizen] = useState<Record<number, string>>({});

  const { data: angebote = [], isLoading } = useQuery<Angebot[]>({
    queryKey: ['shiftOffers', selectedTournament],
    queryFn: () => apiFetch(`/api/shift-offers?tournamentId=${selectedTournament}`),
    enabled: !!selectedTournament
  });

  const offene = angebote.filter(a => a.status === 'OFFEN');
  const erledigte = angebote.filter(a => a.status !== 'OFFEN');

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

  if (!selectedTournament) {
    return (
      <div className="feedback-empty">
        <div className="feedback-empty-icon">🙋</div>
        <div className="feedback-empty-title">Kein Turnier ausgewählt</div>
      </div>
    );
  }
  if (isLoading) return <div className="feedback-loading">Lade Angebote …</div>;

  if (angebote.length === 0) {
    return (
      <div className="feedback-empty">
        <div className="feedback-empty-icon">🙋</div>
        <div className="feedback-empty-title">Keine Zeitangebote</div>
        <div className="feedback-empty-desc">
          Helfer, für die keine Schicht passt, können im Self-Service ihre Zeit anbieten.
          Diese Vorschläge erscheinen hier.
        </div>
      </div>
    );
  }

  const karte = (a: Angebot, mitAktionen: boolean) => (
    <div key={a.id} className={`angebot-admin-karte angebot-admin-karte--${a.status.toLowerCase()}`}>
      <div className="angebot-admin-kopf">
        <strong>{a.user?.name || 'Unbekannt'}</strong>
        <span className="angebot-admin-zeit">
          {tagKurz(a.date)} · {hhmm(a.startMin)}–{hhmm(a.endMin)}
          {a.shift?.workArea?.name && <> · {a.shift.workArea.icon} {a.shift.workArea.name}</>}
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

  return (
    <div className="stat-seite">
      <section>
        <h3 className="feedback-section-title">🙋 Zu entscheiden ({offene.length})</h3>
        {offene.length === 0 ? (
          <p className="stat-hinweis">Nichts offen – alle Angebote sind beantwortet.</p>
        ) : (
          <>
            <p className="stat-hinweis">
              Ein angenommenes Angebot ist eine Zusage, aber noch keine Einplanung: Trage die
              Schicht danach im Dienstplan ein – bei Bedarf mit passend zugeschnittener Zeit.
            </p>
            <div className="angebot-admin-liste">{offene.map(a => karte(a, true))}</div>
          </>
        )}
      </section>

      {erledigte.length > 0 && (
        <section>
          <h3 className="feedback-section-title">Bereits entschieden ({erledigte.length})</h3>
          <div className="angebot-admin-liste">{erledigte.map(a => karte(a, false))}</div>
        </section>
      )}
    </div>
  );
}
