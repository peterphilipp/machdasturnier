import { useEffect } from 'react';

/**
 * Gemeinsame Bausteine für die Stammdatenseiten.
 *
 * Anlass: Auf jeder Stammdatenseite stand das Anlegen-Formular fest zwischen
 * Überschrift und Liste - ohne Beschriftung, ohne eigenen Rahmen. Man erkannte
 * erst am "+ Hinzufügen" am Zeilenende, dass das ein eigener Vorgang ist, und
 * es schob Suche und Liste weit auseinander.
 *
 * Angelegt wird aber selten; gesucht und gepflegt wird ständig. Deshalb wandert
 * das Anlegen in einen Dialog - denselben Ort, an dem seit jeher bearbeitet
 * wird - und hinterlässt auf der Seite nur einen benannten Knopf.
 */

/** Kopfzeile einer Stammdatenseite: Titel links, "Neu"-Knopf rechts. */
export function StammdatenKopf({ titel, untertitel, neuText, onNeu, farbe = '#6c757d' }: {
  titel: string;
  untertitel?: string;
  /** Beschriftung des Knopfes, z.B. "Neuer Benutzer" - nie nur "Neu". */
  neuText: string;
  onNeu: () => void;
  farbe?: string;
}) {
  return (
    <div className="stammdaten-kopf">
      <div className="stammdaten-kopf-text">
        <h3 className="stammdaten-kopf-titel">{titel}</h3>
        {untertitel && <p className="stammdaten-kopf-untertitel">{untertitel}</p>}
      </div>
      <button onClick={onNeu} className="stammdaten-neu-knopf" style={{ background: farbe }}>
        <span aria-hidden="true" className="stammdaten-neu-plus">+</span>
        <span>{neuText}</span>
      </button>
    </div>
  );
}

/**
 * Dialog zum Anlegen eines Stammdatensatzes.
 *
 * Der Fuß mit "Abbrechen" und "Anlegen" bleibt beim Scrollen stehen: Das
 * Helfer-Formular ist inzwischen so lang, dass der Knopf sonst unter dem
 * Bildschirmrand verschwindet.
 */
export function AnlegenDialog({ titel, onAbbrechen, onAnlegen, anlegenText = 'Anlegen', breite = 560, farbe = '#6c757d', children }: {
  titel: string;
  onAbbrechen: () => void;
  onAnlegen: () => void;
  anlegenText?: string;
  breite?: number;
  farbe?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => { if (e.key === 'Escape') onAbbrechen(); };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [onAbbrechen]);

  return (
    <div
      className="stammdaten-dialog-overlay"
      onClick={e => { if (e.target === e.currentTarget) onAbbrechen(); }}
    >
      <div className="stammdaten-dialog" style={{ maxWidth: breite }}>
        <div className="stammdaten-dialog-kopf">
          <h3 className="stammdaten-dialog-titel">{titel}</h3>
          <button onClick={onAbbrechen} className="stammdaten-dialog-schliessen" aria-label="Schließen">×</button>
        </div>
        <div className="stammdaten-dialog-inhalt">{children}</div>
        <div className="stammdaten-dialog-fuss">
          <button onClick={onAbbrechen} className="stammdaten-dialog-abbrechen">Abbrechen</button>
          <button onClick={onAnlegen} className="stammdaten-dialog-anlegen" style={{ background: farbe }}>
            {anlegenText}
          </button>
        </div>
      </div>
    </div>
  );
}
