import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { I18nProvider } from './i18n';
import { SessionProvider } from './lib/session';
import { isConfigured } from './lib/supabase';
import { Setup } from './pages/Setup';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './styles.css';

// Après une mise en ligne, une page restée ouverte (ou en cache) réclame d'anciens fichiers qui n'existent plus :
// on recharge une fois la page pour prendre la nouvelle version, au lieu d'afficher « Connexion au serveur impossible ».
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('cap-reload') || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('cap-reload', String(Date.now()));
  } catch { /* stockage indisponible : on recharge quand même */ }
  e.preventDefault();
  window.location.reload();
});

// GitHub Pages : 404.html (copie de index.html) sert toutes les adresses ; le routeur prend le relais.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {isConfigured ? (
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      ) : <Setup />}
    </I18nProvider>
  </StrictMode>,
);
