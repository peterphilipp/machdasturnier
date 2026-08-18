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
  },

  // ---------------- Stammdaten ----------------
  // Hier gilt durchgehend: Es geht weniger darum, WIE man ein Feld ausfüllt,
  // als darum, WAS anderswo davon abhängt. Wer Stammdaten pflegt, sieht die
  // Folgen sonst erst, wenn sie eintreten.

  vereine: {
    zweck: 'Der eigene Verein und die Gastvereine – Grundlage für Teams und das Erscheinungsbild.',
    ablauf: [
      'Den eigenen Verein mit Logo und den beiden Vereinsfarben anlegen.',
      'Gastvereine ergänzen, sobald die Zusagen für ein Turnier stehen.'
    ],
    hinweise: [
      'Logo und Farben des eigenen Vereins erscheinen in der ganzen App und im Kopf jedes Stationszettels.',
      'An einem Verein hängen die Teams. Wird er gelöscht, verschwinden sie mit – prüfe vorher, ob noch ein Turnier darauf verweist.'
    ]
  },

  turniere: {
    zweck: 'Der Rahmen, an dem alles andere hängt: Spielplan, Dienstplan, Spenden.',
    ablauf: [
      'Turnier mit Zeitraum anlegen und dem Verein zuordnen.',
      'Status auf „aktiv" setzen, sobald Helfer es sehen sollen.',
      'Nach dem Turnier auf „archiviert" setzen.'
    ],
    hinweise: [
      'Der Status steuert, was Helfer im Self-Service sehen: „Entwurf" bleibt für sie unsichtbar, während du planst.',
      'Der Zeitraum begrenzt, welche Turniertage sich anlegen lassen. Verschiebt sich das Turnier, zuerst hier korrigieren.',
      'Löschen entfernt den kompletten Plan samt Schichten, Zusagen und Spenden. Archivieren erhält alles und nimmt es nur aus dem Blickfeld.'
    ]
  },

  jahrgaenge: {
    zweck: 'Geburtsjahr-Bereiche wie „Jahrgang 2016" – sie steuern, wer was zu sehen bekommt.',
    ablauf: [
      'Je Jahrgang den Bereich von/bis Geburtsjahr festlegen.',
      'Nicht mehr benötigte Jahrgänge inaktiv setzen statt löschen.'
    ],
    hinweise: [
      'Eltern sehen im Self-Service genau die Spenden-Ziele der Jahrgänge, in die das Geburtsjahr ihrer hinterlegten Kinder fällt. Wer keine Kinder eingetragen hat, sieht keine.',
      'Verschiebst du die Grenzen, verschiebt sich diese Zuordnung rückwirkend – auch für bereits zugesagte Spenden.',
      'Trainer werden Jahrgängen zugeordnet und sehen in ihrer Ansicht nur die eigenen.'
    ]
  },

  'work-areas': {
    zweck: 'Der Katalog aller Arbeitsbereiche – Küche, Grillstand, Aufbau und so weiter.',
    ablauf: [
      'Bereich mit Symbol, Farbe und der üblichen Helferzahl anlegen.',
      'Betriebszeiten hinterlegen, falls der Bereich nicht den ganzen Tag läuft.',
      'Beim Einrichten eines Turniers werden die Bereiche dorthin übernommen.'
    ],
    hinweise: [
      'Wichtig: Ein Turnier arbeitet mit einer KOPIE des Katalogs. Änderungen hier wirken deshalb NICHT rückwirkend in laufende Turniere – dort passt du den Bereich direkt im Dienstplan an.',
      'Min- und Max-Helfer sind die Vorgabe für neu erzeugte Schichten, nicht für bestehende.',
      'Statt zu löschen, einen Bereich lieber als veraltet markieren: Gelöschte Bereiche reißen Lücken in ausgewertete Turniere.'
    ]
  },

  'global-time-slots': {
    zweck: 'Bauplan eines Turniertags: welcher Arbeitsbereich von wann bis wann arbeitet.',
    ablauf: [
      'Vorlage anlegen, z.B. „Turniersamstag".',
      'Je Arbeitsbereich die Zeitfenster eintragen – im Diagramm mit der Maus.',
      'Beim Anlegen eines Turniertags die Vorlage auswählen; daraus entstehen die Zeitfenster und Schichten.'
    ],
    hinweise: [
      'Änderungen wirken erst beim NÄCHSTEN Turniertag, der aus der Vorlage entsteht. Bereits angelegte Tage bleiben, wie sie sind.',
      'Umgekehrt geht es auch: Einen fertig geplanten Tag kannst du im Dienstplan über „✨ Als Vorlage" hierher zurückspeichern.',
      'Mehrere Bereiche dürfen dasselbe Zeitfenster haben – daraus wird ein gemeinsames Fenster mit mehreren Schichten.'
    ]
  },

  lebensmittel: {
    zweck: 'Artikel und Kategorien für Verpflegung – die Grundlage für Spenden und Einkauf.',
    ablauf: [
      'Kategorien anlegen (Kuchen, Getränke, Grillgut …).',
      'Artikel mit Einheit und Preis darin einsortieren.'
    ],
    hinweise: [
      'Aus diesen Artikeln baust du später die Spenden-Ziele je Jahrgang und die Einkaufsliste.',
      'Wird ein Artikel gelöscht, verlieren bestehende Zusagen ihren Bezug. Umbenennen ist meist die bessere Wahl.'
    ]
  },

  helfer: {
    zweck: 'Alle Personen – wer sich anmelden kann, wer welche Rechte hat, wer wie erreichbar ist.',
    ablauf: [
      'Helfer legen sich in der Regel selbst an; hier ergänzt du Rollen und Kinder.',
      'Rolle vergeben: Helfer, Trainer, Organisator oder Admin – mehrere gleichzeitig sind möglich.',
      'Über 🔑 ein Passwort setzen, wenn jemand nicht mehr hineinkommt.'
    ],
    hinweise: [
      'Die hinterlegten Kinder steuern, welche Jahrgangs-Spenden ein Elternteil zu sehen bekommt – ohne Kind keine Spendenansicht.',
      '„Helfer ohne App-Zugang" ist für Jugendliche ohne eigenes Konto gedacht. Trage dort unbedingt eine Kontaktperson ein, sonst erreicht eine verschobene Schicht niemanden.',
      'Rollen wirken sofort, auch bei bereits angemeldeten Personen – die Rechte werden bei jeder Anfrage neu geprüft.',
      'Löschen entfernt auch alle Zusagen und Spenden dieser Person.'
    ]
  },

  'db-management': {
    zweck: 'Export und Import der gesamten Datenbank – für Sicherungen und Umzüge.',
    ablauf: [
      'Export lädt den kompletten Datenbestand als Datei herunter.',
      'Import spielt eine solche Datei wieder ein.'
    ],
    hinweise: [
      'Ein Import überschreibt den vorhandenen Bestand. Vorher exportieren, sonst gibt es keinen Weg zurück.',
      'Die Datei enthält alle Personendaten des Vereins. Sie gehört nicht in eine Cloud und nicht in einen E-Mail-Anhang.',
      'Für den Normalbetrieb brauchst du das nicht: Der Server sichert die Datenbank bei jedem Start automatisch.'
    ]
  }
};

/** Letztes Segment des Pfads, also der Schlüssel oben. */
export function seitenSchluessel(pfad: string): string {
  return pfad.replace(/\/+$/, '').split('/').pop() || '';
}
