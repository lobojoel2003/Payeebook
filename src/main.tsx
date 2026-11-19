import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AppProvider } from './state/AppContext';
import { ToastProvider } from './state/toast';
import { applyTheme } from './ui/theme';
import { registerServiceWorker } from './pwa';
import { installDesktopLinkHandler } from './ui/desktop';
import './styles.css';

applyTheme();
void registerServiceWorker();
installDesktopLinkHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AppProvider
        fallback={(s) =>
          s.status === 'error' ? (
            <div className="loading-screen">
              <div className="card stack" style={{ maxWidth: 520 }}>
                <h2>Payeebook could not start</h2>
                <p className="text-2">{s.message}</p>
                <p className="small muted">
                  Payeebook needs a recent browser with WebAssembly and IndexedDB. Private browsing
                  windows sometimes block storage.
                </p>
              </div>
            </div>
          ) : (
            <div className="loading-screen">
              <div>
                <div className="spinner" />
                Opening your books…
              </div>
            </div>
          )
        }
      >
        <App />
      </AppProvider>
    </ToastProvider>
  </StrictMode>,
);
