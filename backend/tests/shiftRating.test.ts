import { describe, it, expect } from 'vitest';
import { aggregateFeedbackByWorkArea, FeedbackItem } from '../src/utils/ratingUtils.js';

describe('aggregateFeedbackByWorkArea', () => {
  it('aggregates ratings and comments correctly by work area', () => {
    const mockFeedbacks: FeedbackItem[] = [
      {
        id: 1,
        ratingWorkload: 5,
        ratingOrganization: 4,
        ratingFun: 5,
        ratingComment: 'Zu stressig ab 14 Uhr, wir brauchten 1 Helfer mehr',
        shift: { workArea: { name: 'Kaffee & Kuchen', icon: '🍰' } }
      },
      {
        id: 2,
        ratingWorkload: 3,
        ratingOrganization: 4,
        ratingFun: 4,
        ratingComment: '',
        shift: { workArea: { name: 'Kaffee & Kuchen', icon: '🍰' } }
      },
      {
        id: 3,
        ratingWorkload: 2,
        ratingOrganization: 5,
        ratingFun: 5,
        ratingComment: 'Alles top organisiert',
        shift: { workArea: { name: 'Turnierleitung', icon: '🏆' } }
      }
    ];

    const aggregated = aggregateFeedbackByWorkArea(mockFeedbacks);

    expect(Object.keys(aggregated)).toHaveLength(2);
    
    const kaffee = aggregated['Kaffee & Kuchen'];
    expect(kaffee.totalRatings).toBe(2);
    expect(kaffee.avgWorkload).toBe(4); // (5+3)/2
    expect(kaffee.avgOrganization).toBe(4); // (4+4)/2
    expect(kaffee.avgFun).toBe(4.5); // (5+4)/2
    expect(kaffee.comments).toHaveLength(1);
    expect(kaffee.comments[0].comment).toBe('Zu stressig ab 14 Uhr, wir brauchten 1 Helfer mehr');

    const leitung = aggregated['Turnierleitung'];
    expect(leitung.totalRatings).toBe(1);
    expect(leitung.avgWorkload).toBe(2);
    expect(leitung.avgOrganization).toBe(5);
    expect(leitung.avgFun).toBe(5);
    expect(leitung.comments).toHaveLength(1);
    expect(leitung.comments[0].comment).toBe('Alles top organisiert');
  });

  it('handles empty feedbacks array', () => {
    const aggregated = aggregateFeedbackByWorkArea([]);
    expect(aggregated).toEqual({});
  });

  // Der Regelfall in der Praxis: Wer schnell durchklickt, laesst Fragen aus.
  // Jede Dimension muss dann nur ihre eigenen Werte mitteln - eine laufende
  // Mittelung ueber einen gemeinsamen Zaehler verschob hier die Schnitte.
  it('mittelt jede Dimension unabhaengig, wenn Bewertungen unvollstaendig sind', () => {
    const feedbacks: FeedbackItem[] = [
      {
        id: 1,
        ratingWorkload: 5,
        ratingOrganization: null,
        ratingFun: null,
        shift: { workArea: { name: 'Grillstand', icon: '🔥' } }
      },
      {
        id: 2,
        ratingWorkload: null,
        ratingOrganization: 2,
        ratingFun: null,
        shift: { workArea: { name: 'Grillstand', icon: '🔥' } }
      },
      {
        id: 3,
        ratingWorkload: 1,
        ratingOrganization: null,
        ratingFun: 4,
        shift: { workArea: { name: 'Grillstand', icon: '🔥' } }
      }
    ];

    const grill = aggregateFeedbackByWorkArea(feedbacks)['Grillstand'];

    expect(grill.avgWorkload).toBe(3);      // (5+1)/2 - Eintrag 2 zaehlt hier nicht
    expect(grill.avgOrganization).toBe(2);  // nur Eintrag 2
    expect(grill.avgFun).toBe(4);           // nur Eintrag 3
    expect(grill.totalRatings).toBe(3);     // alle drei haben etwas angegeben
  });

  it('ignoriert Stufen ausserhalb von 1 bis 5', () => {
    const feedbacks: FeedbackItem[] = [
      { id: 1, ratingWorkload: 4, shift: { workArea: { name: 'Küche', icon: '🍳' } } },
      { id: 2, ratingWorkload: 9, shift: { workArea: { name: 'Küche', icon: '🍳' } } }
    ];

    const kueche = aggregateFeedbackByWorkArea(feedbacks)['Küche'];
    expect(kueche.avgWorkload).toBe(4);
  });

  it('liefert null statt NaN, wenn nur ein Kommentar ohne Sterne kommt', () => {
    const feedbacks: FeedbackItem[] = [
      { id: 1, ratingComment: 'Nur ein Hinweis', shift: { workArea: { name: 'Abbau', icon: '📦' } } }
    ];

    const abbau = aggregateFeedbackByWorkArea(feedbacks)['Abbau'];
    expect(abbau.avgWorkload).toBeNull();
    expect(abbau.avgOrganization).toBeNull();
    expect(abbau.avgFun).toBeNull();
    expect(abbau.totalRatings).toBe(0);
    expect(abbau.comments).toHaveLength(1);
  });
});
