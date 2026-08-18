import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { startUpdateWatch } from './lib/appUpdates.js';
import './styles.css';

startUpdateWatch();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
