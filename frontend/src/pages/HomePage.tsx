import React, { useEffect } from 'react';
import { useDeepLogger } from '../hooks/useDeepLogger';

export const HomePage = () => {
  const { trackEvent, baseLogging } = useDeepLogger();

  useEffect(() => {
    trackEvent('HomePage Mounted');
    baseLogging('Direct obscure logger called in HomePage');
  }, []);

  return (
    <div style={{ padding: '2rem', border: '1px dashed #ccc', marginTop: '1rem' }}>
      <h2>Home Page</h2>
      <p>This component traverses several layers to find the original `logging()` function from the fictional package.</p>
    </div>
  );
};