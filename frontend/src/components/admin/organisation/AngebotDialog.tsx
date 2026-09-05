import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiPatch, apiDelete } from '../../../api';
import { modal } from '../Modal';
import { minToTime, TournamentWorkArea } from '../shared';
import type { TimelineAngebot } from './AngeboteTimeline';
import '../../../styles/components/statistik.css';

/**
 * Entscheiden über ein Zeitangebot - aufgerufen aus dem Gantt.
 *
 * Vorher gab es dafür eine eigene Liste unter dem Dienstplan. Das hiess:
 * Balken im Diagramm suchen, dann denselben Eintrag in der Liste
 * wiederfinden. Hier ist der Balken selbst der Einstieg.
 *
 * Annehmen plant NIEMANDEN ein - es ist eine Zusage. Die Schicht wird
 * anschliessend von Hand eingetragen, bei Bedarf mit zugeschnittener Zeit.
 * Automatisch einzuplanen hiesse, einen Eintrag mit einer Zeit anzulegen, die
 * von der Schichtzeit abweicht, und genau das soll nicht wieder passieren.
 *
 * Der Bereich, den der Organisator hier beim Annehmen waehlt, aendert daran
 * nichts - er ordnet die Zusage nur zu, damit sie als Balken in der Zeile
 * dieses Bereichs im Dienstplan auftaucht, statt nur in diesem getrennten
 * Angebots-Diagramm. Optional: eine Zusage "egal wo gebraucht" bleibt ohne
 * Bereich moeglich.
 */

const hhmm = (m: number) => minToTime(m);
const tagLang = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });

export default function AngebotDialog({
  angebot,
  tournamentId,
  areas,
  onClose
}: {
  angebot: TimelineAngebot;
  tournamentId: number | null;
  /** Aktive Arbeitsbereiche des Turniers - zur Auswahl beim Annehmen. */
  areas: TournamentWorkArea[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notiz, setNotiz] = useState(angebot.decisionNote ?? '');
  const [busy, setBusy] = useState(false);
  // Vorbelegt mit dem Wunschbereich, wenn es genau einen gibt - dann ist die
  // Entscheidung bereits offensichtlich und der Organisator muss nichts
  // eintippen. Bei mehreren Wuenschen oder keinem bleibt es eine bewusste Wahl.
  const wunschBereichIds = (angebot.workAreas ?? []).map(w => w.id).filter((id): id is number => id != null);
  const [bereichId, setBereichId] = useState<number | ''>(
    angebot.entschiedenerBereich?.id ?? (wunschBereichIds.length === 1 ? wunschBereichIds[0] : '')
  );

  const aktualisieren = () => {
    queryClient.invalidateQueries({ queryKey: ['shiftOffers', tournamentId] });
    onClose();
  };

  const fehler = async (err: unknown) => {
    await modal.alert({
      title: 'Fehler',
      message: (err as Error).message || 'Die Aktion konnte nicht ausgeführt werden.'
    });
  };

  const wann = `${tagLang(angebot.date)}, ${hhmm(angebot.startMin)}–${hhmm(angebot.endMin)}`;
  const bereiche = angebot.shift?.workArea?.name
    ? `${angebot.shift.workArea.icon ?? ''} ${angebot.shift.workArea.name}`.trim()
    : (angebot.workAreas ?? []).map(w => `${w.icon ?? ''} ${w.name}`.trim()).join(', ');

  const entscheide = async (status: 'ANGENOMMEN' | 'ABGELEHNT') => {
    const gewaehlterBereich = areas.find(a => a.id === bereichId);
    const bestaetigt = await modal.confirm({
      title: status === 'ANGENOMMEN' ? 'Angebot annehmen' : 'Angebot ablehnen',
      message: status === 'ANGENOMMEN'
        ? `${angebot.user?.name} bekommt eine Zusage für ${wann}`
          + (gewaehlterBereich ? `, zugeordnet zu ${gewaehlterBereich.icon} ${gewaehlterBereich.name}` : '')
          + '. Die Schicht trägst du anschliessend im Dienstplan ein – das passiert nicht automatisch.'
        : `${angebot.user?.name} bekommt eine Absage für ${wann}.`,
      variant: status === 'ABGELEHNT' ? 'danger' : undefined
    });
    if (!bestaetigt) return;

    setBusy(true);
    try {
      await apiPatch(`/api/shift-offers/${angebot.id}/entscheidung`, {
        status,
        decisionNote: notiz.trim() || null,
        bereichId: status === 'ANGENOMMEN' && bereichId !== '' ? bereichId : null
      });
      aktualisieren();
    } catch (err) { await fehler(err); } finally { setBusy(false); }
  };

  const zuruecknehmen = async () => {
    setBusy(true);
    try {
      await apiPatch(`/api/shift-offers/${angebot.id}/oeffnen`, {});
      aktualisieren();
    } catch (err) { await fehler(err); } finally { setBusy(false); }
  };

  const entfernen = async () => {
    const bestaetigt = await modal.confirm({
      title: 'Angebot entfernen',
      message: angebot.status === 'ANGENOMMEN'
        ? `Das angenommene Angebot von ${angebot.user?.name} wird gelöscht. `
          + 'Eine bereits eingetragene Schicht bleibt davon unberührt.'
        : `Das Angebot von ${angebot.user?.name} wird gelöscht.`,
      variant: 'danger'
    });
    if (!bestaetigt) return;

    setBusy(true);
    try {
      await apiDelete(`/api/shift-offers/${angebot.id}`);
      aktualisieren();
    } catch (err) { await fehler(err); } finally { setBusy(false); }
  };

  // Verfallene lassen sich nicht mehr annehmen - der Zeitraum ist vorbei.
  // Zurueckziehen einer Entscheidung und Loeschen bleiben moeglich.
  const offen = angebot.status === 'OFFEN' && !angebot.verfallen;

  return (
    <div className="feedback-modal-overlay" onClick={onClose}>
      <div
        className="feedback-modal-content feedback-modal-content--schmal"
        onClick={e => e.stopPropagation()}
      >
        <div className="feedback-modal-header">
          <div>
            <h3 className="feedback-modal-title">🙋 {angebot.user?.name || 'Zeitangebot'}</h3>
            <div className="feedback-modal-subtitle">{wann}</div>
          </div>
          <button className="feedback-modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        <div className="feedback-modal-body">
          <dl className="angebot-dialog-daten">
            <dt>Zeitraum</dt>
            <dd>{hhmm(angebot.startMin)}–{hhmm(angebot.endMin)}</dd>
            <dt>Wunschbereiche</dt>
            <dd>{bereiche || <span className="stat-leer">egal, wo gebraucht</span>}</dd>
            {angebot.note && (<><dt>Anmerkung</dt><dd>„{angebot.note}"</dd></>)}
            <dt>Status</dt>
            <dd>
              {angebot.status === 'OFFEN' ? (angebot.verfallen ? '⌛ Zeitraum vorbei' : '⏳ offen')
                : angebot.status === 'ANGENOMMEN' ? '👍 angenommen'
                : 'abgelehnt'}
              {angebot.decidedAt && <> am {new Date(angebot.decidedAt).toLocaleDateString('de-DE')}</>}
              {angebot.umgesetzt && <> · Schicht ist eingetragen</>}
            </dd>
            {!offen && angebot.status === 'ANGENOMMEN' && angebot.entschiedenerBereich && (
              <>
                <dt>Bereich</dt>
                <dd>{angebot.entschiedenerBereich.icon} {angebot.entschiedenerBereich.name}</dd>
              </>
            )}
          </dl>

          {offen ? (
            <>
              <div className="rating-feld">
                <label className="rating-feld-label" htmlFor="angebot-bereich">
                  Bereich zuordnen (optional)
                </label>
                <select
                  id="angebot-bereich"
                  className="rating-kommentar"
                  value={bereichId}
                  onChange={e => setBereichId(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">egal, wo gebraucht</option>
                  {areas.map(a => (
                    <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                  ))}
                </select>
                <p className="stat-hinweis" style={{ marginTop: 4 }}>
                  Nur bei „Annehmen" wirksam. Die Zusage erscheint dann als Balken in der
                  Dienstplan-Zeile dieses Bereichs – eingetragen ist sie damit noch nicht.
                </p>
              </div>

              <div className="rating-feld">
                <label className="rating-feld-label" htmlFor="angebot-rueckmeldung">
                  Rückmeldung an den Helfer (optional)
                </label>
                <input
                  id="angebot-rueckmeldung"
                  className="rating-kommentar"
                  maxLength={500}
                  value={notiz}
                  onChange={e => setNotiz(e.target.value)}
                  placeholder="z. B. „wir tragen dich für den Grillstand ein“"
                />
              </div>
            </>
          ) : (
            <p className="stat-hinweis">
              {angebot.decisionNote && <>Rückmeldung: „{angebot.decisionNote}"<br /></>}
              {angebot.status === 'OFFEN' && angebot.verfallen
                ? 'Der Zeitraum ist vorbei – annehmen lässt sich das nicht mehr. Löschen räumt es weg.'
                : 'Die Entscheidung lässt sich zurücknehmen – das Angebot ist dann wieder offen.'}
            </p>
          )}
        </div>

        <div className="feedback-modal-footer angebot-dialog-fuss">
          {/* Löschen links und optisch zurückhaltend: Es ist die einzige
              Aktion hier, die nichts rückgängig macht. */}
          <button className="angebot-dialog-loeschen" onClick={entfernen} disabled={busy}>
            Löschen
          </button>
          <span style={{ flex: 1 }} />
          {offen ? (
            <>
              <button
                className="angebot-admin-btn angebot-admin-btn--nein"
                onClick={() => entscheide('ABGELEHNT')}
                disabled={busy}
              >
                Ablehnen
              </button>
              <button
                className="angebot-admin-btn angebot-admin-btn--ja"
                onClick={() => entscheide('ANGENOMMEN')}
                disabled={busy}
              >
                Annehmen
              </button>
            </>
          ) : (
            angebot.status !== 'OFFEN' && (
              <button
                className="angebot-admin-btn angebot-admin-btn--nein"
                onClick={zuruecknehmen}
                disabled={busy}
              >
                Entscheidung zurücknehmen
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
