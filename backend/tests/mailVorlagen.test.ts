import { describe, it, expect } from 'vitest';
import { baueVorlage, VORLAGEN } from '../src/utils/mailVorlagen.js';
import { maskiere, alsAbsaetze, kennzahlen, dunkler } from '../src/utils/mailLayout.js';

const MARKE = {
  vereinsname: 'TSV Holm',
  turniername: 'Rathje Junior Cup',
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
    expect(m.html).toContain('Alle offenen Schichten ansehen');
    expect(m.html).toContain('https://beispiel.test/');
    expect(m.text).toContain('https://beispiel.test/');
  });

  // Wer zu den genannten Zeiten nicht kann, soll nicht in einer Sackgasse
  // landen - eine Stunde ausserhalb des Rasters ist mehr als keine.
  it('bietet im Aufruf immer auch den Weg über ein Zeitangebot an', () => {
    const m = baueVorlage('appell', basis, MARKE);
    expect(m.html).toContain('https://beispiel.test/?zeitangebot=1');
    expect(m.text).toContain('https://beispiel.test/?zeitangebot=1');
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
    icon: 'G',
    datum: 'Samstag, 5. September',
    slot: '14:00-16:00'
  };
  const zweite = {
    token: 'zweites.token',
    bereich: 'Kuchentheke',
    icon: 'K',
    datum: 'Sonntag, 6. September',
    slot: '10:00-12:00'
  };

  // Alle drei Fragen mit je fuenf Stufen - der Empfaenger soll sehen, worauf
  // er sich einlaesst, bevor er klickt.
  it('baut für jede der drei Fragen fünf Links', () => {
    const html = baueVorlage('bewertung', { ...basis, schichten: [schicht] }, MARKE).html;
    for (const feld of ['w', 'o', 'f']) {
      for (const n of [1, 2, 3, 4, 5]) {
        expect(html).toContain(`https://beispiel.test/bewerten?t=nutzlast.signatur&amp;${feld}=${n}`);
      }
    }
  });

  it('stellt alle drei Kriterien mit Namen dar', () => {
    const html = baueVorlage('bewertung', { ...basis, schichten: [schicht] }, MARKE).html;
    expect(html).toContain('Stress &amp; Auslastung');
    expect(html).toContain('Organisation &amp; Einweisung');
    expect(html).toContain('Spaß &amp; Stimmung');
  });

  it('nennt die Schicht, um die es geht - in HTML und im Text', () => {
    const m = baueVorlage('bewertung', { ...basis, schichten: [schicht] }, MARKE);
    expect(m.html).toContain('Grillstand');
    expect(m.html).toContain('Samstag, 5. September');
    expect(m.html).toContain('14:00-16:00');
    expect(m.text).toContain('Grillstand');
  });

  it('führt den Knopf auf dieselbe Seite, aber ohne vorgegebenen Wert', () => {
    const m = baueVorlage('bewertung', { ...basis, schichten: [schicht] }, MARKE);
    expect(m.html).toContain('Bewertung im Browser öffnen');
    expect(m.text).toContain('https://beispiel.test/bewerten?t=nutzlast.signatur');
  });

  /**
   * Mehrere Schichten: Die erste bekommt die Fragen, die weiteren je einen
   * eigenen Link mit eigenem Token. Waeren es dieselben Token, landete die
   * zweite Bewertung auf der ersten Schicht - ein Fehler, den niemand sieht,
   * weil die Seite dann einfach die erste Schicht zeigt.
   */
  it('verlinkt weitere Schichten mit ihrem eigenen Token', () => {
    const m = baueVorlage('bewertung', { ...basis, schichten: [schicht, zweite] }, MARKE);
    expect(m.html).toContain('Du hattest noch eine Schicht:');
    expect(m.html).toContain('Kuchentheke');
    expect(m.html).toContain('https://beispiel.test/bewerten?t=zweites.token');
    expect(m.text).toContain('https://beispiel.test/bewerten?t=zweites.token');
    // Die Fragen gibt es nur einmal - drei Reihen, nicht sechs.
    expect(m.html.match(/Stress &amp; Auslastung/g)).toHaveLength(1);
  });

  it('zählt bei mehr als zwei Schichten richtig', () => {
    const dritte = { ...zweite, token: 'drittes.token', bereich: 'Kasse' };
    const html = baueVorlage('bewertung', { ...basis, schichten: [schicht, zweite, dritte] }, MARKE).html;
    expect(html).toContain('Du hattest noch 2 Schichten:');
  });

  it('erwähnt weitere Schichten nur, wenn es welche gibt', () => {
    const eine = baueVorlage('bewertung', { ...basis, schichten: [schicht] }, MARKE).html;
    expect(eine).not.toContain('Du hattest');
  });

  it('maskiert das Token, statt es ins HTML zu spucken', () => {
    const boese = { ...schicht, token: 'a"><script>x</script>' };
    const html = baueVorlage('bewertung', { ...basis, schichten: [boese] }, MARKE).html;
    expect(html).not.toContain('<script>');
  });

  // Bildblockade ist in Outlook und bei vielen Gmail-Konten die
  // Voreinstellung. Sterne als Bilder waeren dort fuenf leere Rahmen.
  it('benutzt keine Bilder für die Sterne', () => {
    const html = baueVorlage('bewertung', { ...basis, schichten: [schicht] }, MARKE).html;
    const bilder = html.match(/<img/g) ?? [];
    // Genau eines: das Logo im Kopf.
    expect(bilder).toHaveLength(1);
  });
});

describe('Helferaufruf mit offenen Schichten', () => {
  const basis = { betreff: 'Wir brauchen noch Helfer', text: 'Ein paar Schichten sind offen.', anrede: 'Anja' };
  const offeneSchichten = [
    { shiftId: 12, bereich: 'Grillstand', icon: 'G', wann: 'Sa, 5. September, 14:00-16:00', plaetze: 5, besetzt: 1, offen: 4 },
    { shiftId: 13, bereich: 'Kasse', icon: 'K', wann: 'So, 6. September, 10:00-12:00', plaetze: 2, besetzt: 1, offen: 1 }
  ];

  it('verlinkt jede Schicht einzeln in die App', () => {
    const m = baueVorlage('appell', { ...basis, offeneSchichten }, MARKE);
    expect(m.html).toContain('https://beispiel.test/?schicht=12');
    expect(m.html).toContain('https://beispiel.test/?schicht=13');
    expect(m.text).toContain('https://beispiel.test/?schicht=12');
  });

  /**
   * Ein Helfer kann in mehreren Turnieren stehen. Ohne das Turnier im Link
   * landet er in der Liste des falschen - und dort fehlt die Schicht, auf die
   * er geklickt hat.
   */
  it('nimmt das Turnier in die Links mit, wenn es bekannt ist', () => {
    const m = baueVorlage('appell', { ...basis, offeneSchichten }, { ...MARKE, turnierId: 7 });
    expect(m.html).toContain('?schicht=12&amp;turnier=7');
    expect(m.text).toContain('?schicht=12&turnier=7');
    expect(m.text).toContain('?zeitangebot=1&turnier=7');
  });

  it('lässt den Turnierteil weg, wenn kein Turnier bekannt ist', () => {
    const m = baueVorlage('appell', { ...basis, offeneSchichten }, MARKE);
    expect(m.html).not.toContain('turnier=');
  });

  it('nennt Bereich, Zeit und wie viele fehlen', () => {
    const m = baueVorlage('appell', { ...basis, offeneSchichten }, MARKE);
    expect(m.html).toContain('Grillstand');
    expect(m.html).toContain('Sa, 5. September, 14:00-16:00');
    expect(m.html).toContain('noch 4 Plätze frei');
    // Einer im Singular - "noch 1 Plätze frei" liest sich wie ein Fehler.
    expect(m.html).toContain('noch 1 Platz frei');
  });

  it('nennt im Text die Belegung, damit die Zahl nicht nur im HTML steht', () => {
    const m = baueVorlage('appell', { ...basis, offeneSchichten }, MARKE);
    expect(m.text).toContain('1 von 5 besetzt');
  });

  // Ohne Luecken bleibt der Aufruf trotzdem sinnvoll: Der Weg ueber ein
  // Zeitangebot und der Knopf in die App stehen weiter da.
  it('kommt ohne offene Schichten klar', () => {
    const m = baueVorlage('appell', { ...basis, offeneSchichten: [] }, MARKE);
    expect(m.html).not.toContain('Hier fehlen gerade die meisten Leute');
    expect(m.html).toContain('?zeitangebot=1');
  });
});

describe('Dankesmail', () => {
  const basis = { betreff: 'Danke!', text: 'Das Turnier ist vorbei.', anrede: 'Anja' };
  const zahlen = { beteiligte: 74, stunden: 288.4, schichten: 94, spenden: 67 };
  const schicht = {
    token: 'nutzlast.signatur', bereich: 'Grillstand', icon: 'G',
    datum: 'Samstag, 5. September', slot: '14:00-16:00'
  };

  it('beginnt mit dem Jubelband, nicht mit einer Textwand', () => {
    const html = baueVorlage('danke', { ...basis, zahlen }, MARKE).html;
    expect(html).toContain('Danke fürs Mithelfen!');
    // Vor der Anrede - sonst ist es kein Aufmacher.
    expect(html.indexOf('Danke fürs Mithelfen!')).toBeLessThan(html.indexOf('Hallo Anja,'));
  });

  /**
   * Die Bitte um Bewertung haengt an der Dankesmail - aber nur fuer die, die
   * noch nicht bewertet haben. Eine Erinnerung an etwas Erledigtes ist der
   * schnellste Weg, ueberlesen zu werden.
   */
  it('fragt nach einer Bewertung, wenn noch etwas offen ist', () => {
    const m = baueVorlage('danke', { ...basis, zahlen, schichten: [schicht] }, MARKE);
    expect(m.html).toContain('Stress &amp; Auslastung');
    expect(m.html).toContain('https://beispiel.test/bewerten?t=nutzlast.signatur');
    expect(m.text).toContain('https://beispiel.test/bewerten?t=nutzlast.signatur');
  });

  it('lässt die Bitte weg, wenn schon alles bewertet ist', () => {
    const m = baueVorlage('danke', { ...basis, zahlen, schichten: [] }, MARKE);
    expect(m.html).not.toContain('Stress &amp; Auslastung');
    expect(m.html).not.toContain('/bewerten?t=');
    // Gedankt wird trotzdem - die Mail bleibt vollständig.
    expect(m.html).toContain('Danke fürs Mithelfen!');
    expect(m.html).toContain('74');
  });
});

describe('Kopfzeile', () => {
  const basis = { betreff: 'Wichtige Info', text: 'Bitte melden.', anrede: 'Anja' };

  // Der Kopf soll aussehen wie der in der App: Turniername unter der
  // Ueberschrift, so wie dort die Begruessung unter dem Turniernamen steht.
  it('nennt das Turnier unter der Überschrift', () => {
    const html = baueVorlage('frei', basis, MARKE).html;
    expect(html).toContain('Rathje Junior Cup');
    expect(html.indexOf('Wichtige Info')).toBeLessThan(html.indexOf('Rathje Junior Cup'));
  });

  it('fällt ohne Turnier auf den Vereinsnamen zurück', () => {
    const html = baueVorlage('frei', basis, { ...MARKE, turniername: null }).html;
    expect(html).toContain('TSV Holm');
  });

  /**
   * Der Verlauf im Kopf braucht eine einfache Farbe daneben: Outlook rendert
   * mit der Word-Engine und ignoriert background-image. Ohne bgcolor waere
   * der Kopf dort weiss - und weisse Schrift auf weiss ist kein Kopf.
   */
  it('hinterlegt den Verlauf mit einer einfachen Farbe', () => {
    const html = baueVorlage('frei', basis, MARKE).html;
    expect(html).toContain('linear-gradient(135deg, #e43d10');
    expect(html).toContain('bgcolor="#e43d10"');
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
  // kein Warnhinweis. Das Band traegt deshalb ein bgcolor-Attribut, das auch
  // die Word-Engine auswertet.
  it('trägt die Warnfarbe als bgcolor, nicht nur als CSS', () => {
    const html = baueVorlage('frei', basis, test).html;
    expect(html).toContain('bgcolor="#BA7517"');
    // Und im Band selbst steht kein Verlauf, auf den es sich verlassen würde.
    const band = html.slice(html.indexOf('#BA7517'), html.indexOf('TESTUMGEBUNG'));
    expect(band).not.toContain('linear-gradient');
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
