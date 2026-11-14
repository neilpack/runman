import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { startSession } from './auth/session';
import { startCassettesSession } from './cassettes/runtime';
import './styles/global.css';

startCassettesSession();
startSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
