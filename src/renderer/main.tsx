import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/base.css';
import './styles/pages.css';
import { App } from './App';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erreur de rendu dans FacturePro', error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="fatal-screen">
          <h1>Une erreur d'affichage est survenue</h1>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn btn-primary btn-md" onClick={() => window.location.reload()}>
            Recharger l'application
          </button>
          <p className="fatal-hint">
            Vos données restent intactes sur le disque. Si le problème persiste, consultez les journaux dans le
            dossier de données.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine introuvable.');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
