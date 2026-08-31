import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'

import './styles/design-tokens.css'
import './styles/base.css'
import './styles/components/auth.css'
import './styles/components/dashboard.css'
import './styles/components/admin.css'
import './styles/components/shared.css'
import './styles/components/admin-core.css'
import './styles/components/admin-data.css'
import './styles/components/station-print.css'

import App from './App'

if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Send custom event to notify layouts that an update is available
      window.dispatchEvent(new CustomEvent('pwa-update-available'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      /**
       * Auf eine neue Version pruefen.
       *
       * Fehler werden verschluckt: Offline schlaegt der Abruf fehl, und das
       * ist kein Zustand, ueber den die App berichten muesste - beim naechsten
       * Anlass wird es wieder versucht.
       */
      const pruefen = () => { registration.update().catch(() => {}) }

      // Beim Start sofort pruefen. Ohne das erfuhr man von einer neuen Version
      // erst, wenn zufaellig das Intervall unten zuschlug oder man die Seite
      // von Hand neu lud - und dann brauchte es zwei Klicks statt einem.
      pruefen()

      // Die App bleibt am Turniertag oft stundenlang in einem Tab offen
      // (Tablet als Hallen-Zentrale) und wird nie manuell neu geladen - ohne
      // periodischen Check würde ein neues Deployment erst sichtbar, wenn der
      // Browser zufällig sein eigenes ~24h-Intervall erreicht.
      setInterval(pruefen, 30 * 60 * 1000)

      /**
       * Und beim Zurueckkehren zur App.
       *
       * Der eigentlich haeufigste Fall auf dem Handy: Die installierte PWA
       * wird aus dem Hintergrund geholt. Das ist kein Seitenaufruf, es laeuft
       * kein Ladevorgang - ohne diesen Auslauf bliebe es beim 30-Minuten-Takt.
       *
       * Mit Mindestabstand, damit haeufiges Hin- und Herwechseln zwischen
       * Fenstern nicht bei jedem Wechsel eine Anfrage ausloest.
       */
      const MINDESTABSTAND_MS = 5 * 60 * 1000
      let zuletztGeprueft = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        if (Date.now() - zuletztGeprueft < MINDESTABSTAND_MS) return
        zuletztGeprueft = Date.now()
        pruefen()
      })
    }
  });
  (window as any).updatePWA = updateSW;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 1000 * 60 * 5, // 5 minutes
      // Nach einem Funkloch von selbst nachladen, statt bis zum naechsten
      // Fenster-Wechsel eine leere oder veraltete Ansicht zu zeigen.
      refetchOnReconnect: true,
      /**
       * Bei fehlender Verbindung lohnt ein zweiter Versuch fast immer, bei
       * einem echten Serverfehler selten - und bei 401/403 nie. Deshalb wird
       * hier nach Fehlerart entschieden statt pauschal dreimal zu wiederholen.
       */
      retry: (versuch: number, fehler: any) => {
        const status = fehler?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        if (status === 0) return versuch < 3;
        return versuch < 1;
      }
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
