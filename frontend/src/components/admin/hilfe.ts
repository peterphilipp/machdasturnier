/**
 * Texte der Kontexthilfe ("?" im Seitenkopf).
 *
 * Bewusst ALLE an einer Stelle statt verteilt in den Komponenten: Verstreute
 * Hilfetexte veralten unbemerkt, weil niemand sie je am Stück liest. Hier
 * lassen sie sich in einem Rutsch gegenlesen, wenn sich ein Ablauf ändert.
 *
 * Aus derselben Quelle speist sich auch der Untertitel der Seite - so gibt es
 * die Kurzfassung nur einmal und kann nicht auseinanderlaufen.
 *
 * Ton: die Begriffe der Anwender, nicht die des Codes. Also "Dienstplan",
 * "Stationszettel", "Arbeitsbereich" - nicht "Shift", "Slot", "WorkArea".
 */
export interface Seitenhilfe {
  /** Ein Satz. Beantwortet: wofür ist diese Seite da? Taugt auch als Untertitel. */
  zweck: string;
  /** Der typische Ablauf, in der Reihenfolge, in der man ihn geht. */
  ablauf: string[];
  /** Was Leute hier erfahrungsgemäß falsch machen oder übersehen. */
  hinweise?: string[];
}

export const SEITENHILFE: Record<string, Seitenhilfe> = {
  uebersicht: {
    zweck: 'Hier steht, wer wann wo arbeitet – der Dienstplan des Turniers.',
    ablauf: [
      'Unter „Dienstplan-Generierung" die Arbeitsbereiche für dieses Turnier festlegen und den Plan aus den Tagesvorlagen erzeugen.',
      'Im Diagramm die Zeiten zurechtziehen: „Zeiten bearbeiten" einschalten, Ränder verschieben, dann oben übernehmen. Alle Änderungen gehen zusammen raus.',
      'Auf einen Balken tippen, um Helfer einzuplanen oder auszuplanen.',
      'Zum Schluss „PDF" – die Stationszettel zum Aushängen an den Ständen.'
    ],
    hinweise: [
      'Die Farbe der Balken zeigt die Besetzung, nicht den Arbeitsbereich: rot = niemand eingeplant, gelb = teilweise, grün = voll. Die schmale Kante links ist die Farbe des Bereichs.',
      'Ein Bereich kann mehrfach gleichzeitig laufen – zwei Verkaufsstände etwa. Dafür im Schicht-Dialog „➕ Parallele Schicht". Die Zeile bekommt dann mehrere Spuren übereinander.',
      'Wer eingeplant wird, bekommt eine Nachricht. Auch beim Verschieben und beim Entfernen einer Schicht. Wer die App nicht nutzt, wird über seine Kontaktperson erreicht.',
      'Am Handy zeigt jede Karte einen „⏰ Zeit"-Knopf, weil es dort kein Diagramm zum Ziehen gibt.'
    ]
  },

  'food-donation-slots': {
    zweck: 'Hier planst du, welche Lebensmittel-Spenden gebraucht werden – aufgeteilt nach Jahrgang.',
    ablauf: [
      'Je Jahrgang festlegen, welcher Artikel in welcher Menge gebraucht wird.',
      'Die Eltern sehen im Self-Service nur die Spenden ihres eigenen Jahrgangs und sagen dort zu.',
      'Der Fortschritt je Artikel zeigt, was noch fehlt.'
    ],
    hinweise: [
      'Die Zuordnung läuft über das Geburtsjahr der hinterlegten Kinder. Wer keine Kinder eingetragen hat, sieht keine Jahrgangs-Spenden.'
    ]
  },

  'shopping-list': {
    zweck: 'Was der Verein selbst einkaufen muss – im Unterschied zu den Spenden der Eltern.',
    ablauf: [
      'Artikel aus dem Katalog übernehmen oder neu anlegen; per Barcode geht es am schnellsten.',
      'Geplante Menge eintragen.',
      'Beim Einkauf die tatsächlich gekaufte Menge nachtragen.'
    ],
    hinweise: [
      'Die Liste eines vergangenen Turniers lässt sich übernehmen – das spart das meiste Tippen.'
    ]
  },

  'push-broadcast': {
    zweck: 'Eine Nachricht an mehrere Helfer gleichzeitig schicken.',
    ablauf: [
      'Empfängerkreis wählen: alle im Turnier, nur bestimmte Schichten oder einzelne Personen.',
      'Titel und Text schreiben, dann absenden.'
    ],
    hinweise: [
      'Push erreicht nur, wer die App installiert und Benachrichtigungen erlaubt hat – das sind erfahrungsgemäß wenige. Für Wichtiges zusätzlich einen anderen Weg wählen.',
      'Änderungen am Dienstplan musst du hier nicht ankündigen: Wer betroffen ist, wird automatisch benachrichtigt.'
    ]
  },

  verlauf: {
    zweck: 'Wer hat wann was am Dienstplan geändert.',
    ablauf: [
      'Neueste Änderung steht oben, gruppiert nach Tagen.',
      'Über die Filter nach Art oder Person einschränken.',
      '„Ältere anzeigen" lädt weiter zurück.'
    ],
    hinweise: [
      'Gedacht für den Fall, dass mehrere Organisatoren gleichzeitig planen und sich fragen, wer etwas verändert hat.',
      'Einträge älter als 90 Tage werden automatisch entfernt.',
      'Im Schicht-Dialog steht zusätzlich, wer die Schicht zuletzt angefasst hat – dort siehst du es, bevor du selbst etwas änderst.'
    ]
  }
};

/** Letztes Segment des Pfads, also der Schlüssel oben. */
export function seitenSchluessel(pfad: string): string {
  return pfad.replace(/\/+$/, '').split('/').pop() || '';
}
