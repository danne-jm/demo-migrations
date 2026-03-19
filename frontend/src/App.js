import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { getHealth, getPublicConfig } from './api/client';
import { JsonPreview } from './components/JsonPreview';
import { StatusCard } from './components/StatusCard';
import { HomePage } from './pages/HomePage'; // <-- added import
export const App = () => {
    const [state, setState] = useState('idle');
    const [error, setError] = useState('');
    const [health, setHealth] = useState(null);
    const [config, setConfig] = useState(null);
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
            }
            catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load backend data');
                setState('error');
            }
        };
        void run();
    }, []);
    const supportedLocales = useMemo(() => config?.frontend.supportedLocales.join(', ') ?? '-', [config]);
    return (_jsxs("main", { className: "app-shell", children: [_jsxs("header", { className: "app-header", children: [_jsx("h1", { children: appTitle }), _jsx("p", { children: "React + TypeScript frontend connected to a Koa backend." })] }), _jsxs("section", { className: "stats-grid", children: [_jsx(StatusCard, { title: "API Status", value: health?.status ?? (state === 'error' ? 'offline' : 'checking'), subtitle: health ? `Uptime: ${health.uptimeSeconds}s` : 'Waiting for response' }), _jsx(StatusCard, { title: "Environment", value: config?.app.env ?? '-', subtitle: `Region: ${config?.app.region ?? '-'}` }), _jsx(StatusCard, { title: "Locales", value: supportedLocales, subtitle: "From backend public config" })] }), state === 'loading' ? _jsx("p", { className: "loading", children: "Loading backend data\u2026" }) : null, state === 'error' ? _jsx("p", { className: "error", children: error }) : null, state === 'ready' && health && config ? (_jsxs("section", { className: "panel-grid", children: [_jsx(JsonPreview, { title: "Health payload", payload: health }), _jsx(JsonPreview, { title: "Public config payload", payload: config })] })) : null, _jsx(HomePage, {})] }));
};
