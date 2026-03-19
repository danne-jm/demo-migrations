import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import './styles.css';
import { LoggingProvider } from './context/LoggingContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LoggingProvider>
      <App />
    </LoggingProvider>
  </React.StrictMode>
);
