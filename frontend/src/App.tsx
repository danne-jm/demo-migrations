import { useEffect, useMemo, useState } from 'react';

import { getHealth, getPublicConfig, type HealthResponse, type PublicConfigResponse } from './api/client';
import { JsonPreview } from './components/JsonPreview';
import { StatusCard } from './components/StatusCard';
import { HomePage } from './pages/HomePage'; // <-- added import

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export const App = () => {
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string>('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [config, setConfig] = useState<PublicConfigResponse | null>(null);

  const appTitle = import.meta.env.VITE_APP_TITLE ?? 'Demo Fullstack Platform';

  useEffect(() => {
    const run = async () => {
      setState('loading');
      setError('');

      try {
        const [healthData, configData] = await Promise.all([getHealth(), getPublicConfig()]);
        setHealth(healthData);
        setConfig(configData);
        setState('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load backend data');
        setState('error');
      }
    };

    void run();
  }, []);

  const supportedLocales = useMemo(() => config?.frontend.supportedLocales.join(', ') ?? '-', [config]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>{appTitle}</h1>
        <p>React + TypeScript frontend connected to a Koa backend.</p>
      </header>

      <section className="stats-grid">
        <StatusCard
          title="API Status"
          value={health?.status ?? (state === 'error' ? 'offline' : 'checking')}
          subtitle={health ? `Uptime: ${health.uptimeSeconds}s` : 'Waiting for response'}
        />
        <StatusCard
          title="Environment"
          value={config?.app.env ?? '-'}
          subtitle={`Region: ${config?.app.region ?? '-'}`}
        />
        <StatusCard
          title="Locales"
          value={supportedLocales}
          subtitle="From backend public config"
        />
      </section>

      {state === 'loading' ? <p className="loading">Loading backend data…</p> : null}
      {state === 'error' ? <p className="error">{error}</p> : null}

      {state === 'ready' && health && config ? (
        <section className="panel-grid">
          <JsonPreview title="Health payload" payload={health} />
          <JsonPreview title="Public config payload" payload={config} />
        </section>
      ) : null}

      {/* Rendering the HomePage component displaying our buttons */}
      <HomePage />
    </main>
  );
};
