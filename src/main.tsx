import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { I18nProvider } from './i18n';
import { SessionProvider } from './lib/session';
import './styles.css';

// GitHub Pages : 404.html (copie de index.html) sert toutes les adresses ; le routeur prend le relais.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
