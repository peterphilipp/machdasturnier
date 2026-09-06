import { describe, it, expect } from 'vitest';
import { baueVorlage, VORLAGEN } from '../src/utils/mailVorlagen.js';
import { maskiere, alsAbsaetze, kennzahlen, dunkler } from '../src/utils/mailLayout.js';

const MARKE = {
  vereinsname: 'TSV Holm',
  farbe: '#e43d10',
  logoUrl: 'https://beispiel.test/api/logo/club/1.png',
  appUrl: 'https://beispiel.test'
};

describe('maskiere', () => {
  // Der Text kommt aus einem Eingabefeld im Adminbereich und landet in HTML,
  // das an alle Mitglieder geht. Ohne Maskierung waere das eine offene Tuer.
  it('entschärft HTML', () => {
    expect(maskiere('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(maskiere('Müller & Söhne "Zitat"')).toBe('Müller &amp; Söhne &quot;Zitat&quot;');
  });
});

describe('alsAbsaetze', () => {
  it('macht aus Leerzeilen Absätze und aus einfachen Umbrüchen <br>', () => {
    const html = alsAbsaetze('Erster Absatz\nzweite Zeile\n\nZweiter Absatz');
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('Erster Absatz<br />zweite Zeile');
  });

  it('lässt kein HTML durch', () => {
    expect(alsAbsaetze('<b>fett</b>')).toContain('&lt;b&gt;fett&lt;/b&gt;');
  });

  it('kommt mit leerem Text klar', () => {
    expect(alsAbsaetze('')).toBe('');
    expect(alsAbsaetze('\n\n\n')).toBe('');
  });
});

describe('kennzahlen', () => {
  // Bei ungerader Anzahl muss eine leere Zelle stehen, sonst zieht sich die
  // letzte Kachel auf die ganze Breite und die Reihe sieht anders aus.
  it('füllt die Reihe bei ungerader Anzahl auf', () => {
    const html = kennzahlen([
      { wert: '3', label: 'a' }, { wert: '4', label: 'b' }, { wert: '5', label: 'c' }
    ], '#000');
    // Drei Werte ergeben vier Zellen: die vierte ist leer und haelt die
    // Breite, damit die letzte Kachel nicht doppelt so breit wird.
    expect(html.match(/<td width="50%"/g)).toHaveLength(4);
    expect(html).toContain('<td width="50%"></td>');
  });

  it('braucht bei gerader Anzahl keine Füllzelle', () => {
    const html = kennzahlen([{ wert: '3', label: 'a' }, { wert: '4', label: 'b' }], '#000');
    expect(html.match(/<td width="50%"/g)).toHaveLength(2);
    expect(html).not.toContain('<td width="50%"></td>');
  });

  it('liefert nichts bei leerer Liste', () => {
    expect(kennzahlen([], '#000')).toBe('');
  });
});

describe('baueVorlage', () => {
  const basis = { betreff: 'Testbetreff', text: 'Erste Zeile.\n\nZweiter Absatz.', anrede: 'Anja' };

  it('setzt Betreff, Anrede und Text', () => {
    const m = baueVorlage('frei', basis, MARKE);
    expect(m.betreff).toBe('Testbetreff');
    expect(m.html).toContain('Hallo Anja,');
    expect(m.html).toContain('Zweiter Absatz.');
    expect(m.text).toContain('Hallo Anja,');
  });

  it('schickt immer eine Textfassung mit', () => {
    // Ohne Textteil stufen Spamfilter schlechter ein, und wer Bilder
    // blockiert, sieht sonst fast nichts.
    const m = baueVorlage('frei', basis, MARKE);
    expect(m.text.length).toBeGreaterThan(20);
    expect(m.text).not.toContain('<');
  });

  it('bringt Logo, Vereinsname und Farbe im Kopf unter', () => {
    const m = baueVorlage('frei', basis, MARKE);
    expect(m.html).toContain(MARKE.logoUrl);
    expect(m.html).toContain('TSV Holm');
    expect(m.html).toContain('#e43d10');
  });

  // Gmail rendert `data:`-Bilder in Mails nicht - das Logo MUSS ueber HTTPS
  // kommen. Ein Test, der genau das festhaelt, weil man es sonst beim
  // naechsten Umbau wieder einbaut.
  it('verwendet niemals ein data:-Bild', () => {
    const m = baueVorlage('danke', { ...basis, zahlen: { beteiligte: 1, stunden: 1, schichten: 1, spenden: 1 } }, MARKE);
    expect(m.html).not.toContain('src="data:');
  });

  it('fällt ohne Logo auf ein Symbol zurück statt auf eine leere Zelle', () => {
    const m = baueVorlage('frei', basis, { ...MARKE, logoUrl: null });
    expect(m.html).toContain('🏆');
  });

  it('gibt dem Aufruf einen Knopf in die App', () => {
    const m = baueVorlage('appell', basis, MARKE);
    expect(m.html).toContain('Offene Schichten ansehen');
    expect(m.html).toContain('https://beispiel.test/');
    expect(m.text).toContain('https://beispiel.test/');
  });

  it('führt bei der Bewertung ohne Schicht in die App', () => {
    // Der Fall der Vorschau: Ohne Empfaenger gibt es keine Schicht und damit
    // kein Token - dann darf die Vorlage nicht mit leeren Sternen dastehen.
    const m = baueVorlage('bewertung', basis, MARKE);
    expect(m.html).toContain('Schicht bewerten');
    expect(m.html).toContain('https://beispiel.test/');
  });

  it('setzt in der Dankesmail die Zahlen als Kacheln UND in den Text', () => {
    const m = baueVorlage('danke', {
      ...basis, zahlen: { beteiligte: 74, stunden: 288.4, schichten: 94, spenden: 67 }
    }, MARKE);
    expect(m.html).toContain('74');
    expect(m.html).toContain('288');   // gerundet
    expect(m.text).toContain('74 Menschen haben mitgeholfen');
    expect(m.text).toContain('288 Stunden');
  });

  it('lässt die Kacheln weg, wenn keine Zahlen vorliegen', () => {
    const m = baueVorlage('danke', { ...basis, zahlen: null }, MARKE);
    expect(m.html).not.toContain('Menschen haben mitgeholfen');
  });

  it('maskiert Betreff und Text auch im Titel', () => {
    const m = baueVorlage('frei', { ...basis, betreff: '<img onerror=x>', text: 'ok' }, MARKE);
    expect(m.html).not.toContain('<img onerror');
    expect(m.html).toContain('&lt;img onerror=x&gt;');
  });

  it('fällt bei leerem Betreff auf einen brauchbaren Titel zurück', () => {
    const m = baueVorlage('frei', { ...basis, betreff: '   ' }, MARKE);
    expect(m.betreff).toBe('Nachricht vom TSV Holm');
  });
});

describe('Sterne in der Bewertungsmail', () => {
  const basis = { betreff: 'Wie war deine Schicht?', text: 'Zwei Minuten, bitte.', anrede: 'Anja' };
  const schicht = {
    token: 'nutzlast.signatur',
    bereich: 'Grillstand',
    datum: 'Samstag, 5. September',
    slot: '14:00-16:00',
    offen: 1
  };

  it('baut fünf Links mit je einem Wert', () => {
    const html = baueVorlage('bewertung', { ...basis, schicht }, MARKE).html;
    for (const n of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`https://beispiel.test/bewerten?t=nutzlast.signatur&amp;f=${n}`);
    }
  });

  it('nennt die Schicht, um die es geht - in HTML und im Text', () => {
    const m = baueVorlage('bewertung', { ...basis, schicht }, MARKE);
    expect(m.html).toContain('Grillstand');
    expect(m.html).toContain('Samstag, 5. September');
    expect(m.html).toContain('14:00-16:00');
    expect(m.text).toContain('Grillstand');
  });

  it('führt den Knopf auf dieselbe Seite, aber ohne vorgegebenen Wert', () => {
    const m = baueVorlage('bewertung', { ...basis, schicht }, MARKE);
    expect(m.html).toContain('Alle drei Fragen beantworten');
    expect(m.text).toContain('https://beispiel.test/bewerten?t=nutzlast.signatur');
  });

  // Sonst liest man "Deine Schicht" und hatte drei - und weiss nicht, welche
  // gemeint ist oder ob die anderen unter den Tisch fallen.
  it('erwähnt weitere offene Schichten, aber nur wenn es welche gibt', () => {
    const mehrere = baueVorlage('bewertung', { ...basis, schicht: { ...schicht, offen: 3 } }, MARKE).html;
    expect(mehrere).toContain('Du hattest 3 Schichten');
    const eine = baueVorlage('bewertung', { ...basis, schicht }, MARKE).html;
    expect(eine).not.toContain('Du hattest');
  });

  it('maskiert das Token, statt es ins HTML zu spucken', () => {
    const boese = { ...schicht, token: 'a"><script>x</script>' };
    const html = baueVorlage('bewertung', { ...basis, schicht: boese }, MARKE).html;
    expect(html).not.toContain('<script>');
  });

  // Bildblockade ist in Outlook und bei vielen Gmail-Konten die
  // Voreinstellung. Sterne als Bilder waeren dort fuenf leere Rahmen.
  it('benutzt keine Bilder für die Sterne', () => {
    const html = baueVorlage('bewertung', { ...basis, schicht }, MARKE).html;
    const bilder = html.match(/<img/g) ?? [];
    // Genau eines: das Logo im Kopf.
    expect(bilder).toHaveLength(1);
  });
});

describe('dunkler', () => {
  it('macht die Farbe dunkler, nicht heller', () => {
    expect(dunkler('#808080', 0.5)).toBe('#404040');
  });

  it('verträgt fehlendes # und Großschreibung', () => {
    expect(dunkler('FFFFFF', 0.5)).toBe('#808080');
  });

  // Ein Verein koennte "red" oder "rgb(...)" hinterlegt haben. Dann ist die
  // Ausgangsfarbe die richtige Antwort - Schwarz waere ein sichtbarer Fehler
  // im Mailkopf.
  it('gibt bei unverständlichen Farben die Eingabe zurück', () => {
    expect(dunkler('rebeccapurple')).toBe('rebeccapurple');
    expect(dunkler('#abc')).toBe('#abc');
  });
});

describe('Kennzeichnung der Testumgebung', () => {
  const basis = { betreff: 'Wichtige Info', text: 'Bitte melden.', anrede: 'Anja' };
  const test = { ...MARKE, testumgebung: { bezeichnung: 'Testumgebung' } };

  it('setzt [TEST] vor den Betreff', () => {
    expect(baueVorlage('frei', basis, test).betreff).toBe('[TEST] Wichtige Info');
  });

  it('lässt den Betreff in der Produktion unverändert', () => {
    expect(baueVorlage('frei', basis, MARKE).betreff).toBe('Wichtige Info');
  });

  it('zeigt das Band oben in der Mail', () => {
    const html = baueVorlage('frei', basis, test).html;
    expect(html).toContain('TESTUMGEBUNG');
    expect(html).toContain('#BA7517');
    // Vor dem farbigen Kopf des Vereins - sonst ist es kein Band "oben".
    expect(html.indexOf('#BA7517')).toBeLessThan(html.indexOf(MARKE.farbe));
  });

  // Ein CSS-Gradient (wie das Streifenband in der App) kommt in Outlook und
  // mehreren Webmailern nicht an - dort bliebe ein weisser Balken, also genau
  // kein Warnhinweis.
  it('benutzt eine einfarbige Fläche, keinen Gradienten', () => {
    expect(baueVorlage('frei', basis, test).html).not.toContain('linear-gradient');
  });

  it('warnt auch in der Textfassung, und zwar zuerst', () => {
    const text = baueVorlage('frei', basis, test).text;
    expect(text).toContain('TESTUMGEBUNG');
    expect(text.indexOf('TESTUMGEBUNG')).toBeLessThan(text.indexOf('Wichtige Info'));
  });

  it('lässt in der Produktion beides weg', () => {
    const m = baueVorlage('frei', basis, MARKE);
    expect(m.html).not.toContain('#BA7517');
    expect(m.text).not.toContain('Spielwiese');
  });

  // Die Kennzeichnung sitzt im Layout, nicht in den Vorlagen - also muss sie
  // fuer jede einzelne gelten, auch fuer kuenftige.
  it('kennzeichnet jede Vorlage', () => {
    for (const id of ['frei', 'appell', 'bewertung', 'danke'] as const) {
      const m = baueVorlage(id, { ...basis, zahlen: { beteiligte:1, stunden:1, schichten:1, spenden:1 } }, test);
      expect(m.betreff).toMatch(/^\[TEST\] /);
      expect(m.html).toContain('TESTUMGEBUNG');
      expect(m.text).toContain('TESTUMGEBUNG');
    }
  });
});

describe('VORLAGEN', () => {
  it('bietet die vier vorgesehenen Vorlagen an', () => {
    expect(VORLAGEN.map(v => v.id)).toEqual(['frei', 'appell', 'bewertung', 'danke']);
  });

  it('hat für jede Vorlage außer der freien eine Vorbelegung', () => {
    for (const v of VORLAGEN.filter(v => v.id !== 'frei')) {
      expect(v.betreff.length).toBeGreaterThan(5);
      expect(v.text.length).toBeGreaterThan(40);
      expect(v.zweck.length).toBeGreaterThan(5);
    }
  });
});
