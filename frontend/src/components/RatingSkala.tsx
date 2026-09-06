import '../styles/components/rating.css';

/**
 * Die drei Fragen und die Skala dazu.
 *
 * Herausgezogen aus DashboardView, weil es die Bewertung jetzt an zwei
 * Stellen gibt: im Dialog der angemeldeten App und auf der oeffentlichen
 * Seite, auf der man aus der Bewertungsmail landet. Der Wortlaut der Fragen
 * muss dabei identisch sein - nicht aus Ordnungsliebe, sondern weil die
 * Auswertung Antworten aus beiden Wegen in denselben Durchschnitt rechnet.
 * Zwei Formulierungen derselben Frage waeren zwei verschiedene Fragen.
 */

/** Eine Frage samt Beschriftung der fuenf Stufen. */
export interface RatingFrage {
  /** Feldname in der Datenbank - danach richtet sich auch der Mail-Link. */
  feld: 'ratingWorkload' | 'ratingOrganization' | 'ratingFun';
  frage: string;
  stufen: string[];
  symbole: string[];
}

export const RATING_FRAGEN: RatingFrage[] = [
  {
    feld: 'ratingWorkload',
    frage: 'Stress & Auslastung',
    stufen: ['Viel zu ruhig', 'Eher ruhig', 'Genau richtig', 'Stressig', 'Überlastet / zu wenig Helfer'],
    symbole: ['😴', '🙂', '😊', '🥵', '🚨']
  },
  {
    feld: 'ratingOrganization',
    frage: 'Organisation & Einweisung',
    stufen: ['Chaotisch', 'Lückenhaft', 'Okay', 'Gut', 'Perfekt organisiert'],
    symbole: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']
  },
  {
    feld: 'ratingFun',
    frage: 'Spaß & Stimmung',
    stufen: ['Kein Spaß', 'Eher zäh', 'In Ordnung', 'Gut', 'Super Stimmung!'],
    symbole: ['😞', '😐', '🙂', '😄', '🤩']
  }
];

/**
 * Eine Bewertungsstufe von 1 bis 5.
 *
 * Die Zahl allein sagt nicht, in welche Richtung sie zeigt - bei "Stress" ist
 * 5 das Warnsignal, bei "Spass" das Lob. Deshalb steht die gewaehlte Stufe
 * immer ausgeschrieben daneben, und jeder Knopf traegt seine Bedeutung als
 * title (fuer Maus und Screenreader).
 */
export function RatingSkala({ frage, stufen, symbole, wert, onChange }: {
  frage: string;
  stufen: string[];
  symbole: string[];
  wert: number | null;
  onChange: (stufe: number) => void;
}) {
  return (
    <div className="rating-feld">
      <label className="rating-feld-label">
        {frage}
        {wert != null && <span className="rating-feld-stufe"> — {stufen[wert - 1]}</span>}
      </label>
      <div className="rating-skala" role="group" aria-label={frage}>
        {[1, 2, 3, 4, 5].map(stufe => (
          <button
            key={stufe}
            type="button"
            onClick={() => onChange(stufe)}
            aria-pressed={wert === stufe}
            aria-label={`${stufe}: ${stufen[stufe - 1]}`}
            title={stufen[stufe - 1]}
            className={`rating-skala-btn${wert === stufe ? ' rating-skala-btn--aktiv' : ''}`}
          >
            {symbole[stufe - 1]}
          </button>
        ))}
      </div>
    </div>
  );
}
