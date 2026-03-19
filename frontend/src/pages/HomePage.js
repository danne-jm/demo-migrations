import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { useDeepLogger } from '../hooks/useDeepLogger';
import { TrackEventButton, DirectLogButton } from '../components/LogButtons';
export const HomePage = () => {
    const { trackEvent, baseLogging } = useDeepLogger();
    useEffect(() => {
        trackEvent('HomePage Mounted');
        baseLogging('Direct obscure logger called in HomePage');
    }, []);
    return (_jsxs("div", { style: { padding: '2rem', border: '1px dashed #ccc', marginTop: '1rem' }, children: [_jsx("h2", { children: "Home Page" }), _jsx("p", { children: "This component traverses several layers to find the original `logging()` function from the fictional package." }), _jsxs("div", { style: { marginTop: '2rem' }, children: [_jsx(TrackEventButton, { label: "Fire Event Action" }), _jsx(DirectLogButton, { label: "Fire Base Log Action" })] })] }));
};
