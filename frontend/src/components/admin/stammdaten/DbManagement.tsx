import { useState } from 'react';
import { modal } from '../Modal';

/**
 * Die Begründung des Servers lesen, nicht nur seinen Statuscode.
 *
 * Vorher warf der Export bei einem Fehler schlicht `HTTP 500` - der Server
 * hatte den Grund mitgeschickt ("Der Pfad zur Datenbank liess sich nicht
 * ermitteln"), die Oberfläche warf ihn weg. Eine Fehlermeldung, die nur die
 * Nummer nennt, macht aus einem Zweiminutenfehler eine Suche.
 *
 * Robust gegen Antworten ohne JSON-Körper: Bei einer zu grossen Datei
 * antwortet Express mit 413 und einer HTML-Seite, und ein `response.json()`
 * darauf würde selbst werfen und den eigentlichen Grund verdecken.
 */
async function fehlerText(response: Response): Promise<string> {
  try {
    const daten = await response.json();
    if (daten?.error) return String(daten.error);
  } catch {
    // Kein JSON - dann bleibt es beim Statuscode unten.
  }
  if (response.status === 413) {
    return 'Die Datei ist zu gross für den Upload (Grenze: 10 MB inklusive Kodierung, '
      + 'also rund 7 MB Datenbank).';
  }
  return `HTTP ${response.status} ${response.statusText}`.trim();
}

interface DumpResponse {
  success: boolean;
  databaseSize: number;
  timestamp: string;
  database: string;
  anonymisiert?: boolean;
  /** Klartext, was die Anonymisierung getan hat - kommt vom Server. */
  eingriffe?: string[];
  /** Womit sich der Exportierende in der Zielumgebung anmelden kann. */
  anmeldung?: { email: string; hinweis: string } | null;
}

export default function DbManagement() {
  const [loading, setLoading] = useState(false);
  const [dumpInfo, setDumpInfo] = useState<{ size: number; timestamp: string; anonymisiert: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  // Anonymisiert ist die Voreinstellung: Der haeufigere Anlass fuer einen
  // Export ist das Fuellen einer Testumgebung, und der gefaehrlichere Fall
  // soll der sein, den man ausdruecklich waehlt.
  const [anonymisieren, setAnonymisieren] = useState(true);

  /** Datenbank exportieren (Download als .db file) */
  const handleExport = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/db/dump${anonymisieren ? '?anonymisieren=1' : ''}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });

      if (!response.ok) {
        throw new Error(await fehlerText(response));
      }

      const data: DumpResponse = await response.json();

      if (!data.success || !data.database) {
        throw new Error('Export fehlgeschlagen');
      }

      // Base64 → Blob → Download
      const byteCharacters = atob(data.database);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      // Die Art steht im Dateinamen: Eine Woche später sieht man einer Datei
      // sonst nicht mehr an, ob echte Namen darin stehen.
      const art = data.anonymisiert ? 'anonym' : 'vollstaendig';
      a.download = `turnier-planer-db-${art}-${new Date().toISOString().split('T')[0]}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDumpInfo({
        size: data.databaseSize,
        timestamp: data.timestamp,
        anonymisiert: !!data.anonymisiert
      });

      await modal.alert({
        title: 'Export erfolgreich',
        message: data.anonymisiert
          ? `Anonymisierte Datenbank exportiert (${(data.databaseSize / 1024).toFixed(1)} KB).\n\n`
            + `Durchgeführt:\n${(data.eingriffe ?? []).map(e => `• ${e}`).join('\n')}\n\n`
            + (data.anmeldung
              ? `Anmeldung in der Zielumgebung:\n${data.anmeldung.email}\n${data.anmeldung.hinweis}`
              : 'Achtung: In dieser Kopie ist kein Passwort mehr gesetzt – dort kann sich niemand anmelden.')
          : `Vollständige Datenbank exportiert (${(data.databaseSize / 1024).toFixed(1)} KB) am `
            + `${new Date(data.timestamp).toLocaleString('de-DE')}.\n\n`
            + 'Diese Datei enthält personenbezogene Daten aller Mitglieder. Bitte entsprechend aufbewahren.'
      });
    } catch (error) {
      await modal.alert({
        title: 'Export fehlgeschlagen',
        message: String(error)
      });
    } finally {
      setLoading(false);
    }
  };

  /** Datenbank importieren (Upload .db file) */
  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      // Datei als Base64 lesen
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Data URL entfernen (nur Base64 behalten)
      const base64Data = base64.split(',')[1];

      const response = await fetch('/api/admin/db/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ database: base64Data })
      });

      if (!response.ok) {
        throw new Error(await fehlerText(response));
      }

      const result = await response.json();
      
      await modal.alert({
        title: 'Import erfolgreich',
        message: `Datenbank importiert (${(result.databaseSize / 1024).toFixed(1)} KB).\n\nEin Backup wurde erstellt unter:\n${result.backupPath || '(siehe Logs)'}`
      });

      // Seite neu laden um neue DB zu aktivieren
      window.location.reload();
    } catch (error) {
      await modal.alert({
        title: 'Import fehlgeschlagen',
        message: String(error)
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="db-management-container">
      <h2 className="db-management-title">🗄️ Datenbank-Management</h2>

      {/* EXPORT */}
      <div className="db-management-export-card">
        <h3 className="db-management-card-title">📤 Datenbank exportieren</h3>
        <p className="db-management-card-desc">
          Erstellt einen Schnappschuss der SQLite-Datenbank als Download.
          <br />Für Backups oder um eine Testumgebung mit echten Strukturen zu füllen.
        </p>

        {/* Die Wahl steht bewusst VOR dem Knopf und nicht als Häkchen daneben:
            Es sind zwei verschiedene Dinge, die man exportiert, nicht eine
            Einstellung an derselben Sache. */}
        <div className="db-management-wahl">
          <label className="db-management-wahl-option">
            <input
              type="radio"
              name="db-export-art"
              checked={anonymisieren}
              onChange={() => setAnonymisieren(true)}
            />
            <span>
              <strong>Anonymisiert</strong> – für Testumgebungen empfohlen
              <span className="db-management-wahl-text">
                Namen werden zu „Testperson 12", Mailadressen zu Adressen auf <code>.invalid</code>,
                Telefonnummern und Kindernamen entfernt. Push-Abos, Passkeys und der
                Änderungsverlauf werden gelöscht. Dienstpläne, Schichten, Bewertungszahlen und
                Statistiken bleiben vollständig – zum Testen taugt die Kopie also weiterhin.
              </span>
            </span>
          </label>

          <label className="db-management-wahl-option">
            <input
              type="radio"
              name="db-export-art"
              checked={!anonymisieren}
              onChange={() => setAnonymisieren(false)}
            />
            <span>
              <strong>Vollständig</strong> – echte Daten, nur für Backups
              <span className="db-management-wahl-text">
                Enthält alle Namen, Mailadressen, Telefonnummern, Kindernamen und
                Feedback-Kommentare im Wortlaut.
              </span>
            </span>
          </label>
        </div>

        {!anonymisieren && (
          <div className="db-management-warnung">
            ⚠️ <strong>Dieser Export enthält personenbezogene Daten aller Mitglieder.</strong>
            {' '}Wird er in eine Testumgebung importiert, werden echte Menschen dort zu Testdaten –
            in einer Umgebung, die meist lockerer zugänglich ist als die Produktion. Und weil die
            Push-Abos mitkommen, kann ein Testklick auf „Aufruf senden" echte Handys erreichen.
            Für Testumgebungen bitte die anonymisierte Variante wählen.
          </div>
        )}

        {dumpInfo && (
          <div className="db-management-success-msg">
            ✅ Letzter Export: {(dumpInfo.size / 1024).toFixed(1)} KB am {new Date(dumpInfo.timestamp).toLocaleString('de-DE')}
            {dumpInfo.anonymisiert ? ' · anonymisiert' : ' · vollständig (echte Daten)'}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={loading}
          className={`db-management-export-btn ${loading ? 'loading' : ''}`}
        >
          {loading
            ? 'Exportiere...'
            : anonymisieren ? '📥 Anonymisiert herunterladen' : '📥 Vollständig herunterladen'}
        </button>
      </div>

      {/* IMPORT */}
      <div className="db-management-import-card">
        <h3 className="db-management-import-title">📥 Datenbank importieren</h3>
        <p className="db-management-import-desc">
          ⚠️ Achtung: Die aktuelle Datenbank wird durch den Import überschrieben!
          <br />Ein Backup wird automatisch erstellt.
        </p>

        {/* Drei Folgen, die nach einem Import regelmäßig für Verwirrung sorgen
            und keine davon ist offensichtlich. Sie stehen hier, weil man sie
            VOR dem Import wissen muss - hinterher kommt man an die Umgebung
            womöglich nicht mehr heran. */}
        <div className="db-management-hinweis">
          <strong>Was sich nach dem Import ändert:</strong>
          <ul>
            <li>
              <strong>Es gelten die Passwörter aus der importierten Datenbank.</strong> Wer aus
              der Produktion importiert, meldet sich hier mit seinem Produktionspasswort an – das
              bisherige Passwort dieser Umgebung gilt nicht mehr.
            </li>
            <li>
              <strong>Passkeys funktionieren nicht.</strong> Face ID und Fingerabdruck sind an
              den Hostnamen gebunden, unter dem sie eingerichtet wurden. Nach einem Import aus
              einer anderen Umgebung führt nur der Weg über Name und Passwort hinein.
            </li>
            <li>
              <strong>Alte Sitzungen zeigen ins Leere oder auf fremde Konten.</strong> Ein noch
              offenes Anmelde-Token enthält nur eine Nutzer-ID, und die gehört in der neuen
              Datenbank zu einer anderen Person. Am besten in allen Browsern einmal abmelden.
            </li>
          </ul>
        </div>

        <div className="db-management-import-row">
          <input
            type="file"
            accept=".db,.sqlite"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                const confirmed = await modal.confirm({
                  title: 'Import bestätigen',
                  message: `Möchtest du "${file.name}" importieren?\n\nDie aktuelle Datenbank wird überschrieben!`,
                  variant: 'warning'
                });

                if (confirmed) {
                  await handleImport(file);
                }
              }
            }}
            disabled={importing}
            className={`db-management-import-input ${importing ? 'importing' : ''}`}
          />
          {importing && (
            <span className="db-management-importing-text">Importiere...</span>
          )}
        </div>
      </div>

      {/* HINWEIS */}
      <div className="db-management-tip">
        💡 <strong>Tipp:</strong> Für regelmäßige Syncs zwischen Produktion und Test kannst du den Export herunterladen und die Datei manuell in die Testumgebung kopieren.
      </div>
    </div>
  );
}
