/**
 * Meldestelle für den Verbindungszustand.
 *
 * Eigenes kleines Modul, damit sowohl api.ts als auch die Anzeige darauf
 * zugreifen können, ohne sich gegenseitig zu importieren.
 *
 * Gemeldet wird in apiFetch - also an der einen Stelle, durch die jeder
 * Serveraufruf der App läuft. Bewusst dort und nicht an den einzelnen
 * Abfragen: Es gibt über hundert davon, und ein Teil lädt ganz ohne React
 * Query (das Self-Service-Dashboard etwa). Eine Regel, an die sich jeder
 * erinnern muss, hätte beim nächsten neuen Aufruf schon wieder eine Lücke.
 */
let letzterFehler: unknown = null;
const hoerer = new Set<() => void>();

/** Ein Serveraufruf ist an fehlender Erreichbarkeit gescheitert. */
export function verbindungGestoert(fehler: unknown): void {
  letzterFehler = fehler;
  hoerer.forEach(h => h());
}

/**
 * Ein Aufruf kam durch. Entwarnung schon beim ersten Erfolg: Sobald irgendetwas
 * antwortet, war es eine Störung und keine Trennung - das Band hat dann seinen
 * Zweck erfüllt und soll nicht stehenbleiben.
 */
export function verbindungWiederDa(): void {
  if (letzterFehler !== null) {
    letzterFehler = null;
    hoerer.forEach(h => h());
  }
}

export function aktuellerVerbindungsfehler(): unknown {
  return letzterFehler;
}

export function beiAenderung(h: () => void): () => void {
  hoerer.add(h);
  return () => { hoerer.delete(h); };
}
