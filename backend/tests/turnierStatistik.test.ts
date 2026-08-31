import { describe, it, expect } from 'vitest';
import {
  berechneTurnierStatistik,
  stundenAus,
  StatistikShift,
  StatistikEinplanung,
  StatistikJahrgang
} from '../src/utils/turnierStatistik.js';

const TAG = { id: 1, date: new Date('2026-09-05T00:00:00Z') };

/** Schicht mit eigener Zeit. */
const schicht = (id: number, startMin: number, endMin: number, max: number, bereich = 'Küche'): StatistikShift => ({
  id, startMin, endMin, maxVolunteers: max, day: TAG,
  workArea: { id: 1, name: bereich, icon: '🍳' }
});

const einplanung = (
  id: number, shiftId: number, userId: number, name: string,
  kinder: number[] = [], trainerVon: number[] = []
): StatistikEinplanung => ({
  id, shiftId, userId,
  user: {
    id: userId, name,
    children: kinder.map(childYear => ({ childYear })),
    trainedYearGroups: trainerVon.map(id => ({ id }))
  }
});

const JAHRGAENGE: StatistikJahrgang[] = [
  { id: 10, name: '2017', birthYearStart: 2017, birthYearEnd: 2017 },
  { id: 20, name: '2019', birthYearStart: 2019, birthYearEnd: 2019 }
];

describe('berechneTurnierStatistik – Eckdaten', () => {
  it('zählt Helfer, Schichten, Stunden und offene Plätze', () => {
    const shifts = [schicht(1, 480, 660, 2), schicht(2, 660, 840, 3)]; // 3h und 3h
    const eintraege = [
      einplanung(1, 1, 100, 'Anna'),
      einplanung(2, 1, 101, 'Bert'),
      einplanung(3, 2, 100, 'Anna')
    ];

    const s = berechneTurnierStatistik(shifts, eintraege, JAHRGAENGE);

    expect(s.eckdaten.helfer).toBe(2);        // Anna zählt einmal
    expect(s.eckdaten.schichten).toBe(3);
    expect(s.eckdaten.stunden).toBe(9);       // 3h + 3h + 3h
    expect(s.eckdaten.plaetze).toBe(5);
    expect(s.eckdaten.besetzt).toBe(3);
    expect(s.eckdaten.offen).toBe(2);
    expect(s.eckdaten.besetzungsgrad).toBe(60);
  });

  it('erbt die Zeit vom Tages-Slot, wenn die Schicht keine eigene hat', () => {
    const shifts: StatistikShift[] = [{
      id: 1, startMin: null, endMin: null, maxVolunteers: 1,
      daySlot: { startMin: 600, endMin: 720 }, day: TAG,
      workArea: { name: 'Grillstand', icon: '🔥' }
    }];
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Anna')], []);
    expect(s.eckdaten.stunden).toBe(2);
  });

  it('ignoriert Einplanungen ohne gültige Schicht', () => {
    const shifts = [schicht(1, 480, 540, 1)];
    const eintraege = [
      einplanung(1, 1, 100, 'Anna'),
      { id: 2, shiftId: null, userId: 101, user: { id: 101, name: 'Verwaist' } },
      einplanung(3, 999, 102, 'Fremd')  // Schicht gehoert nicht zu diesem Turnier
    ];
    const s = berechneTurnierStatistik(shifts, eintraege, []);
    expect(s.eckdaten.schichten).toBe(1);
    expect(s.eckdaten.helfer).toBe(1);
  });

  it('kommt mit einem Turnier ohne jede Schicht klar', () => {
    const s = berechneTurnierStatistik([], [], []);
    expect(s.eckdaten.helfer).toBe(0);
    expect(s.eckdaten.besetzungsgrad).toBeNull();   // nicht 0 % und nicht NaN
    expect(s.werHatGetragen.schnittStundenProHelfer).toBe(0);
  });
});

describe('berechneTurnierStatistik – wer hat getragen', () => {
  it('sortiert nach Stunden und nach Schichten getrennt', () => {
    // Kurt hat mehr Schichten, Lang hat mehr Stunden - die Listen muessen
    // sich unterscheiden, sonst waere die zweite ueberfluessig.
    const shifts = [schicht(1, 480, 510, 5), schicht(2, 540, 570, 5), schicht(3, 600, 840, 5)];
    const eintraege = [
      einplanung(1, 1, 100, 'Kurt'),
      einplanung(2, 2, 100, 'Kurt'),
      einplanung(3, 3, 101, 'Lang')
    ];
    const s = berechneTurnierStatistik(shifts, eintraege, []);

    expect(s.werHatGetragen.nachSchichten[0].name).toBe('Kurt');
    expect(s.werHatGetragen.nachSchichten[0].schichten).toBe(2);
    expect(s.werHatGetragen.nachStunden[0].name).toBe('Lang');
    expect(s.werHatGetragen.nachStunden[0].stunden).toBe(4);
  });

  it('zeigt, auf wie vielen Schultern die Arbeit liegt', () => {
    const shifts = [1, 2, 3, 4].map(i => schicht(i, 480 + i * 60, 540 + i * 60, 5));
    const eintraege = [
      einplanung(1, 1, 100, 'Viel'), einplanung(2, 2, 100, 'Viel'), einplanung(3, 3, 100, 'Viel'),
      einplanung(4, 1, 101, 'Zwei'), einplanung(5, 2, 101, 'Zwei'),
      einplanung(6, 3, 102, 'Einmal')
    ];
    const s = berechneTurnierStatistik(shifts, eintraege, []);
    expect(s.werHatGetragen.verteilung).toEqual({ eine: 1, zwei: 1, dreiOderMehr: 1 });
  });

  it('begrenzt die Top-Listen auf zehn', () => {
    const shifts = [schicht(1, 480, 540, 20)];
    const eintraege = Array.from({ length: 15 }, (_, i) => einplanung(i + 1, 1, 100 + i, `Helfer ${i}`));
    const s = berechneTurnierStatistik(shifts, eintraege, []);
    expect(s.werHatGetragen.nachStunden).toHaveLength(10);
  });
});

describe('berechneTurnierStatistik – Jahrgänge', () => {
  it('ordnet über die Kinder zu und rechnet Stunden je Kind', () => {
    const shifts = [schicht(1, 480, 600, 5)]; // 2h
    const eintraege = [
      einplanung(1, 1, 100, 'Eltern A', [2017]),
      einplanung(2, 1, 101, 'Eltern B', [2017])
    ];
    const s = berechneTurnierStatistik(shifts, eintraege, JAHRGAENGE);
    const jg2017 = s.jahrgaenge.liste.find(j => j.name === '2017')!;

    expect(jg2017.helfer).toBe(2);
    expect(jg2017.stunden).toBe(4);        // 2 Helfer x 2h
    expect(jg2017.kinder).toBe(2);
    expect(jg2017.stundenProKind).toBe(2); // 4h / 2 Kinder
  });

  // Der Grund, warum stundenProKind ueberhaupt existiert: Ohne die Normierung
  // steht der groessere Jahrgang immer besser da, obwohl je Kind weniger kommt.
  it('dreht das Bild, wenn der grössere Jahrgang je Kind weniger leistet', () => {
    const shifts = [schicht(1, 480, 600, 10)]; // 2h je Einplanung
    const eintraege = [
      einplanung(1, 1, 100, 'Gross 1', [2017]),
      einplanung(2, 1, 101, 'Gross 2', [2017]),
      einplanung(3, 1, 102, 'Gross 3', [2017]),
      einplanung(4, 1, 200, 'Klein 1', [2019])
    ];
    const s = berechneTurnierStatistik(shifts, eintraege, JAHRGAENGE);
    const gross = s.jahrgaenge.liste.find(j => j.name === '2017')!;
    const klein = s.jahrgaenge.liste.find(j => j.name === '2019')!;

    expect(gross.stunden).toBeGreaterThan(klein.stunden); // absolut vorn
    expect(gross.stundenProKind).toBe(2);
    expect(klein.stundenProKind).toBe(2);                  // je Kind gleichauf
  });

  it('zählt Trainer zu ihrem Jahrgang, auch ohne eigenes Kind', () => {
    const shifts = [schicht(1, 480, 540, 3)];
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Trainer', [], [20])], JAHRGAENGE);
    const jg = s.jahrgaenge.liste.find(j => j.name === '2019')!;
    expect(jg.helfer).toBe(1);
    expect(jg.stundenProKind).toBeNull(); // kein Kind als Bezugsgroesse
  });

  it('sammelt Helfer ohne Zuordnung getrennt und stellt sie ans Ende', () => {
    const shifts = [schicht(1, 480, 540, 3)];
    const eintraege = [einplanung(1, 1, 100, 'Ohne Kind'), einplanung(2, 1, 101, 'Mit Kind', [2017])];
    const s = berechneTurnierStatistik(shifts, eintraege, JAHRGAENGE);
    expect(s.jahrgaenge.liste.at(-1)!.name).toBe('Ohne Zuordnung');
    expect(s.jahrgaenge.liste.at(-1)!.helfer).toBe(1);
  });

  it('meldet Mehrfachzählung, wenn ein Helfer zu zwei Jahrgängen gehört', () => {
    const shifts = [schicht(1, 480, 540, 3)];
    // Ein Elternteil mit Kindern in beiden Jahrgaengen.
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Zwei Kinder', [2017, 2019])], JAHRGAENGE);
    expect(s.eckdaten.helfer).toBe(1);
    expect(s.jahrgaenge.liste.reduce((n, j) => n + j.helfer, 0)).toBe(2);
    expect(s.jahrgaenge.mehrfachzaehlung).toBe(true);
  });

  it('meldet keine Mehrfachzählung, wenn jeder nur einmal zählt', () => {
    const shifts = [schicht(1, 480, 540, 3)];
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Ein Kind', [2017])], JAHRGAENGE);
    expect(s.jahrgaenge.mehrfachzaehlung).toBe(false);
  });
});

describe('berechneTurnierStatistik – Lücken', () => {
  it('führt die grössten Lücken auf und lässt volle Schichten weg', () => {
    const shifts = [
      schicht(1, 480, 540, 4, 'Grillstand'),  // 3 offen
      schicht(2, 600, 660, 1, 'Küche')        // voll
    ];
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'A'), einplanung(2, 2, 101, 'B')], []);

    expect(s.luecken.groessteLuecken).toHaveLength(1);
    expect(s.luecken.groessteLuecken[0].bereich).toBe('Grillstand');
    expect(s.luecken.groessteLuecken[0].offen).toBe(3);
  });

  it('gruppiert die Lücken nach Tageszeit', () => {
    const shifts = [schicht(1, 480, 540, 3), schicht(2, 1140, 1200, 2)]; // Vormittag, Abend
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'A')], []);

    const abend = s.luecken.jeAbschnitt.find(a => a.abschnitt === 'abend')!;
    const morgen = s.luecken.jeAbschnitt.find(a => a.abschnitt === 'morgen')!;
    expect(abend.offen).toBe(2);
    expect(morgen.offen).toBe(2);
    expect(abend.label).toMatch(/Abend/);
  });
});

describe('stundenAus', () => {
  it('rundet auf eine Nachkommastelle', () => {
    expect(stundenAus(90)).toBe(1.5);
    expect(stundenAus(100)).toBe(1.7);
    expect(stundenAus(0)).toBe(0);
  });
});

describe('berechneTurnierStatistik – Aufschlüsselung je Jahrgang', () => {
  const shifts = [schicht(1, 480, 600, 10), schicht(2, 600, 720, 10)]; // je 2h

  it('listet die Aktiven eines Jahrgangs nach Stunden absteigend', () => {
    const eintraege = [
      einplanung(1, 1, 100, 'Viel Helferin', [2017]),
      einplanung(2, 2, 100, 'Viel Helferin', [2017]),
      einplanung(3, 1, 101, 'Wenig Helfer', [2017])
    ];
    const jg = berechneTurnierStatistik(shifts, eintraege, JAHRGAENGE)
      .jahrgaenge.liste.find(j => j.name === '2017')!;

    expect(jg.personen.map(p => p.name)).toEqual(['Viel Helferin', 'Wenig Helfer']);
    expect(jg.personen[0].stunden).toBe(4);
    expect(jg.personen[1].stunden).toBe(2);
  });

  // Der eigentliche Zweck: Wen kann der Jahrgangsvertreter noch ansprechen?
  it('nennt Mitglieder des Jahrgangs, die nichts übernommen haben', () => {
    const eintraege = [einplanung(1, 1, 100, 'Aktiv', [2017])];
    const mitglieder = [
      { id: 100, name: 'Aktiv', children: [{ childYear: 2017 }] },
      { id: 101, name: 'Bisher nicht dabei', children: [{ childYear: 2017 }] },
      { id: 102, name: 'Anderer Jahrgang', children: [{ childYear: 2019 }] }
    ];
    const s = berechneTurnierStatistik(shifts, eintraege, JAHRGAENGE, mitglieder);
    const jg2017 = s.jahrgaenge.liste.find(j => j.name === '2017')!;

    expect(jg2017.ohneBeteiligung.map(p => p.name)).toEqual(['Bisher nicht dabei']);
    // Wer geholfen hat, steht nicht in der Liste der Unbeteiligten
    expect(jg2017.ohneBeteiligung.some(p => p.name === 'Aktiv')).toBe(false);
  });

  it('führt jemanden nur beim eigenen Jahrgang als unbeteiligt', () => {
    const mitglieder = [{ id: 101, name: 'Nur 2019', children: [{ childYear: 2019 }] }];
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Aktiv', [2017])], JAHRGAENGE, mitglieder);

    const jg2017 = s.jahrgaenge.liste.find(j => j.name === '2017')!;
    expect(jg2017.ohneBeteiligung).toHaveLength(0);
  });

  it('lässt die Liste leer, wenn keine Mitgliederdaten übergeben werden', () => {
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Aktiv', [2017])], JAHRGAENGE);
    expect(s.jahrgaenge.liste.find(j => j.name === '2017')!.ohneBeteiligung).toEqual([]);
  });

  // Zeigt, wie stark ein Jahrgang an wenigen Schultern hängt.
  it('berechnet den Lastanteil der aktiveren Hälfte', () => {
    const vieleShifts = [1, 2, 3, 4].map(i => schicht(i, 480 + i * 30, 600 + i * 30, 10));
    const eintraege = [
      einplanung(1, 1, 100, 'A', [2017]), einplanung(2, 2, 100, 'A', [2017]),
      einplanung(3, 3, 100, 'A', [2017]),
      einplanung(4, 4, 101, 'B', [2017]),
      einplanung(5, 1, 102, 'C', [2017])
    ];
    const jg = berechneTurnierStatistik(vieleShifts, eintraege, JAHRGAENGE)
      .jahrgaenge.liste.find(j => j.name === '2017')!;

    // A (6h) + B (2h) von insgesamt 10h = 80 %
    expect(jg.lastAnteilObereHaelfte).toBe(80);
  });

  it('lässt den Lastanteil offen, wenn zu wenige mitgemacht haben', () => {
    const jg = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Allein', [2017])], JAHRGAENGE)
      .jahrgaenge.liste.find(j => j.name === '2017')!;
    expect(jg.lastAnteilObereHaelfte).toBeNull();
  });
});

describe('berechneTurnierStatistik – Verpflegung zählt als Beteiligung', () => {
  const shifts = [schicht(1, 480, 600, 10)];
  const spende = (userId: number, jahr: number) => ({
    userId,
    user: { id: userId, children: [{ childYear: jahr }], trainedYearGroups: [] }
  });

  // Der eigentliche Punkt: Wer Kuchen backt, gehört nicht auf die Liste der
  // Unbeteiligten - auch wenn er keine Schicht übernommen hat.
  it('führt jemanden mit Spende nicht als unbeteiligt', () => {
    const mitglieder = [
      { id: 100, name: 'Schicht', children: [{ childYear: 2017 }] },
      { id: 101, name: 'Nur Kuchen', children: [{ childYear: 2017 }] },
      { id: 102, name: 'Gar nichts', children: [{ childYear: 2017 }] }
    ];
    const s = berechneTurnierStatistik(
      shifts, [einplanung(1, 1, 100, 'Schicht', [2017])], JAHRGAENGE, mitglieder,
      [spende(101, 2017)]
    );
    const jg = s.jahrgaenge.liste.find(j => j.name === '2017')!;

    expect(jg.ohneBeteiligung.map(p => p.name)).toEqual(['Gar nichts']);
  });

  it('nimmt reine Spender in die Personenliste auf', () => {
    const mitglieder = [{ id: 101, name: 'Nur Kuchen', children: [{ childYear: 2017 }] }];
    const s = berechneTurnierStatistik(
      shifts, [einplanung(1, 1, 100, 'Schicht', [2017])], JAHRGAENGE, mitglieder,
      [spende(101, 2017), spende(101, 2017)]
    );
    const jg = s.jahrgaenge.liste.find(j => j.name === '2017')!;
    const kuchen = jg.personen.find(p => p.name === 'Nur Kuchen')!;

    expect(kuchen.spenden).toBe(2);
    expect(kuchen.stunden).toBe(0);
    // Wer Stunden hat, steht weiter oben - Spender hängen sich hinten an.
    expect(jg.personen[0].name).toBe('Schicht');
  });

  it('zählt Spenden je Jahrgang', () => {
    const s = berechneTurnierStatistik(
      shifts, [], JAHRGAENGE, [],
      [spende(101, 2017), spende(102, 2017), spende(103, 2019)]
    );
    const jg2017 = s.jahrgaenge.liste.find(j => j.name === '2017')!;
    expect(jg2017.spenden).toBe(2);
    expect(jg2017.spender).toBe(2);
  });

  it('weist Beteiligte getrennt von Helfern aus', () => {
    const s = berechneTurnierStatistik(
      shifts, [einplanung(1, 1, 100, 'Schicht', [2017])], JAHRGAENGE, [],
      [spende(101, 2017)]
    );
    expect(s.eckdaten.helfer).toBe(1);       // nur die mit Schicht
    expect(s.eckdaten.beteiligte).toBe(2);   // plus die Spenderin
    expect(s.eckdaten.spender).toBe(1);
  });

  it('zählt jemanden mit Schicht UND Spende nur einmal als beteiligt', () => {
    const s = berechneTurnierStatistik(
      shifts, [einplanung(1, 1, 100, 'Beides', [2017])], JAHRGAENGE, [],
      [spende(100, 2017)]
    );
    expect(s.eckdaten.beteiligte).toBe(1);
  });
});

describe('berechneTurnierStatistik – Spender in den Top-Listen', () => {
  const shifts = [schicht(1, 480, 720, 10)]; // 4h
  const spende = (userId: number) => ({ userId, user: { id: userId, children: [], trainedYearGroups: [] } });

  // Ohne eigene Liste wäre jemand, der nur spendet, unsichtbar: In den
  // Stunden-Listen stünde er mit 0 h ganz unten oder gar nicht.
  it('führt reine Spender in einer eigenen Rangfolge', () => {
    const mitglieder = [{ id: 200, name: 'Kuchen-Königin', children: [] }];
    const s = berechneTurnierStatistik(
      shifts, [einplanung(1, 1, 100, 'Schicht')], [], mitglieder,
      [spende(200), spende(200), spende(200), spende(100)]
    );

    expect(s.werHatGetragen.nachSpenden[0].name).toBe('Kuchen-Königin');
    expect(s.werHatGetragen.nachSpenden[0].spenden).toBe(3);
    // Wer beides macht, erscheint in beiden Listen mit beiden Werten
    const schichtPerson = s.werHatGetragen.nachStunden[0];
    expect(schichtPerson.stunden).toBe(4);
    expect(schichtPerson.spenden).toBe(1);
  });

  it('lässt die Spenden-Liste leer, wenn niemand gespendet hat', () => {
    const s = berechneTurnierStatistik(shifts, [einplanung(1, 1, 100, 'Schicht')], []);
    expect(s.werHatGetragen.nachSpenden).toEqual([]);
  });

  it('begrenzt auch die Spenden-Liste auf zehn', () => {
    const viele = Array.from({ length: 15 }, (_, i) => spende(300 + i));
    const s = berechneTurnierStatistik(shifts, [], [], [], viele);
    expect(s.werHatGetragen.nachSpenden).toHaveLength(10);
  });
});
