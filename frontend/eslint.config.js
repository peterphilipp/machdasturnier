import reactHooks from 'eslint-plugin-react-hooks';
import tsparser from '@typescript-eslint/parser';

/**
 * Bewusst schmal gehalten: nur Regeln, die echte Laufzeitfehler finden.
 *
 * Anlass war ein Absturz in Produktion (React #310) - ein useQuery stand
 * unterhalb eines vorzeitigen Returns und lief dadurch nicht bei jedem
 * Render. Derselbe Fehler war kurz zuvor schon einmal passiert. Beide Male
 * hätte `rules-of-hooks` ihn vor dem Deployment gemeldet.
 *
 * Ein vollständiges Regelwerk (Stil, Formatierung, ungenutzte Variablen)
 * würde im gewachsenen Bestand hunderte Treffer erzeugen und wäre damit
 * sofort wieder abgeschaltet. Diese Datei soll grün bleiben, damit ein roter
 * Lauf etwas bedeutet. Weitere Regeln lassen sich später einzeln ergänzen -
 * jeweils erst prüfen, ob der Bestand sie schon erfüllt.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'src/sw.js']
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Der eigentliche Grund für diese Konfiguration. Ein Hook hinter einem
      // vorzeitigen Return bringt die ganze Seite zum Absturz, und zwar erst
      // zur Laufzeit - TypeScript sieht davon nichts.
      'react-hooks/rules-of-hooks': 'error',

      // Fehlende Abhängigkeiten führen zu veralteten Werten in Effekten. Als
      // Warnung, weil der Bestand einige bewusste Ausnahmen enthält (mit
      // eslint-disable begründet) und ein Fehler hier nur dazu führen würde,
      // die Prüfung insgesamt zu umgehen.
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
];
