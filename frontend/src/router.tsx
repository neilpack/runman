// All app routes. To add a page: create it in src/pages, then add it here and to NAV_LINKS in Layout.

import { createBrowserRouter } from 'react-router';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { WelcomePage } from './pages/WelcomePage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { authSetup } from './auth/configure';
import { LibraryPage } from './pages/LibraryPage';
import { EditCassettePage } from './pages/EditCassettePage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

const AuthGate = lazy(() => import('./components/AuthGate').then((module) => ({ default: module.AuthGate })));

export const router = createBrowserRouter([
  // Signed-out screens render full-bleed, outside the app Layout.
  { path: '/', element: <WelcomePage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/library', element: <LibraryPage /> },
      { path: '/cassettes/:id/edit', element: <EditCassettePage /> },
      { path: '/status', element: <HomePage /> },
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
