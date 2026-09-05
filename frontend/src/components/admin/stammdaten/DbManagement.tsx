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
}

export default function DbManagement() {
  const [loading, setLoading] = useState(false);
  const [dumpInfo, setDumpInfo] = useState<{ size: number; timestamp: string } | null>(null);
  const [importing, setImporting] = useState(false);

  /** Datenbank exportieren (Download als .db file) */
  const handleExport = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/db/dump', {
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
      a.download = `turnier-planer-db-${new Date().toISOString().split('T')[0]}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDumpInfo({ size: data.databaseSize, timestamp: data.timestamp });
      await modal.alert({
        title: 'Export erfolgreich',
        message: `Datenbank exportiert (${(data.databaseSize / 1024).toFixed(1)} KB) am ${new Date(data.timestamp).toLocaleString('de-DE')}`
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
          Erstellt einen vollständigen Dump der SQLite-Datenbank als Download.
          <br />Nützlich für Backups oder Sync mit Testumgebungen.
        </p>

        {dumpInfo && (
          <div className="db-management-success-msg">
            ✅ Letzter Export: {(dumpInfo.size / 1024).toFixed(1)} KB am {new Date(dumpInfo.timestamp).toLocaleString('de-DE')}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={loading}
          className={`db-management-export-btn ${loading ? 'loading' : ''}`}
        >
          {loading ? 'Exportiere...' : '📥 Datenbank herunterladen'}
        </button>
      </div>

      {/* IMPORT */}
      <div className="db-management-import-card">
        <h3 className="db-management-import-title">📥 Datenbank importieren</h3>
        <p className="db-management-import-desc">
          ⚠️ Achtung: Die aktuelle Datenbank wird durch den Import überschrieben!
          <br />Ein Backup wird automatisch erstellt.
        </p>

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
