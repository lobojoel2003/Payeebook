import { Component, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { Layout } from './Layout';
import { Welcome } from './pages/Welcome';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Import } from './pages/Import';
import { Receipts } from './pages/Receipts';
import { Reconcile } from './pages/Reconcile';
import { Reports } from './pages/Reports';
import { Templates } from './pages/Templates';
import { Share } from './pages/Share';
import { Activity } from './pages/Activity';
import { Settings } from './pages/Settings';
import { More } from './pages/More';
import { REPO_URL } from '../buildInfo';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loading-screen">
        <div className="card stack" style={{ maxWidth: 560 }}>
          <h2>Something went wrong on this page</h2>
          <p className="text-2">
            Your books are safe: they are saved on this device after every change.
          </p>
          <pre className="code">{this.state.error.message}</pre>
          <div className="row">
            <button className="btn btn-primary" onClick={() => location.reload()}>
              Reload
            </button>
            <a className="btn" href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer">
              Report the problem
            </a>
          </div>
        </div>
      </div>
    );
  }
}

function Shell() {
  const { book, readOnly } = useApp();
  if (!book) {
    return (
      <Routes>
        <Route path="*" element={<Welcome />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route
        path="*"
        element={
          <Layout>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/import" element={readOnly ? <Navigate to="/" /> : <Import />} />
                <Route path="/receipts" element={<Receipts />} />
                <Route path="/reconcile" element={<Reconcile />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/share" element={readOnly ? <Navigate to="/" /> : <Share />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/settings" element={readOnly ? <Navigate to="/" /> : <Settings />} />
                <Route path="/more" element={<More />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </Layout>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ErrorBoundary>
  );
}
