import { minToTime } from '../shared';
import { GanttTimeline, GanttRow } from '../ganttTimeline';

/**
 * Die Zeitangebote eines Tages als Gantt - eine Zeile je Helfer.
 *
 * Bewusst ein eigenes Diagramm statt einer Sonderzeile im Dienstplan: Der
 * Dienstplan zeigt den Ist-Zustand, ein Angebot ist ein Vorschlag. In einem
 * gemeinsamen Diagramm waere auf den ersten Blick nicht mehr zu unterscheiden,
 * was schon gilt und was erst werden koennte. Ausserdem sind die Zeilen dort
 * Arbeitsbereiche - ein Angebot hat oft gar keinen.
 *
 * Es steht direkt unter dem Tages-Dienstplan und teilt dessen Zeitachse
 * (globalStartMin/globalEndMin). Dadurch liegen Luecke und Angebot senkrecht
 * uebereinander: "Grillstand 14:00-16:30 unbesetzt" und darunter "Jens bietet
 * 14:00-17:00" - der Abgleich ist ein Blick statt einer Rechnung.
 */

export interface TimelineAngebot {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  note: string | null;
  status: 'OFFEN' | 'ANGENOMMEN' | 'ABGELEHNT';
  user?: { id: number; name: string } | null;
  shift?: { workArea?: { name?: string; icon?: string } | null } | null;
  workAreas?: { name?: string; icon?: string }[];
}

/** Farbe des Balkens nach Status - hier drueckt die Flaeche keine Besetzung aus. */
const STATUS_STIL: Record<TimelineAngebot['status'], { flaeche: string; rand: string; wort: string }> = {
  OFFEN:      { flaeche: '#fff3cd', rand: '#ffe69c', wort: 'offen' },
  ANGENOMMEN: { flaeche: '#d1e7dd', rand: '#badbcc', wort: 'angenommen' },
  ABGELEHNT:  { flaeche: '#f1f3f5', rand: '#dee2e6', wort: 'abgelehnt' }
};

/** Zeilenfarbe: dieselbe Aussage wie die Flaeche, damit die Kante links passt. */
const ZEILEN_FARBE: Record<TimelineAngebot['status'], string> = {
  OFFEN: '#ffc107',
  ANGENOMMEN: '#198754',
  ABGELEHNT: '#adb5bd'
};

export default function AngeboteTimeline({
  angebote,
  globalStartMin,
  globalEndMin,
  onAngebotClick
}: {
  angebote: TimelineAngebot[];
  globalStartMin: number;
  globalEndMin: number;
  onAngebotClick?: (a: TimelineAngebot) => void;
}) {
  if (angebote.length === 0) return null;

  // Eine Zeile je Helfer. Wer zweimal angeboten hat, bekommt beide Balken in
  // seiner Zeile - die Spurenverteilung des Gantt faengt Ueberschneidungen ab.
  const proHelfer = new Map<number, { name: string; items: TimelineAngebot[] }>();
  for (const a of angebote) {
    const key = a.user?.id ?? -1;
    if (!proHelfer.has(key)) proHelfer.set(key, { name: a.user?.name || 'Unbekannt', items: [] });
    proHelfer.get(key)!.items.push(a);
  }

  /** Der Bezug zur Schicht ist praeziser als die Wunschliste - er gewinnt. */
  const bereicheVon = (a: TimelineAngebot): string =>
    a.shift?.workArea?.name
      ? `${a.shift.workArea.icon ?? ''} ${a.shift.workArea.name}`.trim()
      : (a.workAreas ?? []).map(w => `${w.icon ?? ''} ${w.name}`.trim()).join(', ');

  const rows: GanttRow[] = [...proHelfer.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'))
    .map(([userId, helfer]) => {
      // Farbe der Zeile nach dem "dringendsten" Status seiner Angebote:
      // ein offenes Angebot ist die Aufgabe, eine Absage nur Historie.
      const rang = (s: TimelineAngebot['status']) => (s === 'OFFEN' ? 0 : s === 'ANGENOMMEN' ? 1 : 2);
      const fuehrend = [...helfer.items].sort((x, y) => rang(x.status) - rang(y.status))[0];

      return {
        id: userId,
        label: helfer.name,
        icon: '🙋',
        color: ZEILEN_FARBE[fuehrend.status],
        items: helfer.items.map(a => {
          const stil = STATUS_STIL[a.status];
          const bereiche = bereicheVon(a);
          const dauer = a.endMin - a.startMin;
          const zeit = `${minToTime(a.startMin)}–${minToTime(a.endMin)}`;

          return {
            id: a.id,
            startMin: a.startMin,
            endMin: a.endMin,
            // Auf schmalen Balken ist fuer den Bereich kein Platz - die Zeit
            // steht ohnehin auf der Achse, der Name links in der Zeile.
            label: dauer > 60 && bereiche ? bereiche : '',
            tooltip: `${helfer.name} · ${zeit} · ${stil.wort}`
              + (bereiche ? ` · Wunsch: ${bereiche}` : ' · ohne Bereichswunsch')
              + (a.note ? ` · „${a.note}"` : ''),
            background: stil.flaeche,
            border: `1px solid ${stil.rand}`
          };
        })
      };
    });

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 15, color: '#212557' }}>🙋 Zeitangebote an diesem Tag</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>
          Gleiche Zeitachse wie oben – was hier liegt, könnte die Lücke darüber füllen.
        </span>
      </div>

      <GanttTimeline
        globalStartMin={globalStartMin}
        globalEndMin={globalEndMin}
        rows={rows}
        onItemClick={id => {
          const a = angebote.find(x => x.id === id);
          if (a) onAngebotClick?.(a);
        }}
      />

      <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: '#64748b', alignItems: 'center' }}>
        {(Object.keys(STATUS_STIL) as TimelineAngebot['status'][]).map(status => (
          <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-block', width: 20, height: 12, borderRadius: 3,
              background: STATUS_STIL[status].flaeche,
              border: `1px solid ${STATUS_STIL[status].rand}`,
              borderLeft: `4px solid ${ZEILEN_FARBE[status]}`
            }} />
            = {STATUS_STIL[status].wort}
          </span>
        ))}
      </div>
    </div>
  );
}
