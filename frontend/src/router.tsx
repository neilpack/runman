// All app routes. To add a page: create it in src/pages, then add it here and to NAV_LINKS in Layout.

import { createBrowserRouter } from 'react-router';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { authSetup } from './auth/configure';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

const AuthGate = lazy(() => import('./components/AuthGate').then((module) => ({ default: module.AuthGate })));

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        path: '/dashboard',
        element: (
          <Suspense fallback={<p role="status">Loading sign-in…</p>}>
            <AuthGate setup={authSetup} />
          </Suspense>
        ),
      },
      { path: '/about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
