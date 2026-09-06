import { describe, it, expect } from 'vitest';
import { baueBenachrichtigungsMail } from '../src/utils/transaktionsMail.js';

const MARKE = {
  vereinsname: 'TSV Holm',
  turniername: 'Rathje Junior Cup',
  farbe: '#e43d10',
  logoUrl: 'https://beispiel.test/api/logo/club/1.png',
  appUrl: 'https://beispiel.test'
};

describe('baueBenachrichtigungsMail', () => {
  it('setzt Titel und Text', () => {
    const m = baueBenachrichtigungsMail('Schicht verschoben', 'Deine Schicht ist jetzt 16-20 Uhr.', '/', MARKE);
    expect(m.betreff).toBe('Schicht verschoben');
    expect(m.html).toContain('Deine Schicht ist jetzt 16-20 Uhr.');
    expect(m.text).toContain('Deine Schicht ist jetzt 16-20 Uhr.');
  });

  it('baut die Aktion aus appUrl und dem übergebenen Pfad', () => {
    const m = baueBenachrichtigungsMail('Titel', 'Text', '/profile', MARKE);
    expect(m.html).toContain('https://beispiel.test/profile');
    expect(m.text).toContain('https://beispiel.test/profile');
  });

  it('maskiert den Text, statt HTML durchzulassen', () => {
    const m = baueBenachrichtigungsMail('Titel', '<script>alert(1)</script>', '/', MARKE);
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('nennt in der Fußzeile, wie man es abschaltet', () => {
    const m = baueBenachrichtigungsMail('Titel', 'Text', '/', MARKE);
    expect(m.html).toContain('Profil');
    expect(m.text).toContain('Profil');
  });

  it('kennzeichnet die Testumgebung wie jede andere Mail', () => {
    const m = baueBenachrichtigungsMail('Titel', 'Text', '/', { ...MARKE, testumgebung: { bezeichnung: 'Testumgebung' } });
    expect(m.betreff).toBe('[TEST] Titel');
    expect(m.html).toContain('TESTUMGEBUNG');
  });
});
