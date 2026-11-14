// All app routes. To add a page: create it in src/pages, then add it here and to NAV_LINKS in Layout.

import { createBrowserRouter, Navigate } from 'react-router';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { WelcomePage } from './pages/WelcomePage';
import { LoginPage } from './pages/LoginPage';
import { LibraryPage } from './pages/LibraryPage';
import { EditCassettePage } from './pages/EditCassettePage';
import { ExplorePage } from './pages/ExplorePage';
import { ListenerPage } from './pages/ListenerPage';
import { PublicTapePage } from './pages/PublicTapePage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

const AuthGate = lazy(() => import('./components/AuthGate').then((module) => ({ default: module.AuthGate })));

export const router = createBrowserRouter([
  // Signed-out screens render full-bleed, outside the app Layout.
  { path: '/', element: <WelcomePage /> },
  { path: '/welcome', element: <WelcomePage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/library', element: <LibraryPage /> },
      { path: '/cassettes/:id/edit', element: <EditCassettePage /> },
      {
        path: '/account',
        element: (
          <Suspense fallback={<p role="status">Loading sign-in…</p>}>
            <AuthGate />
          </Suspense>
        ),
      },
      // The dashboard became the Account page; keep old links working.
      { path: '/dashboard', element: <Navigate to="/account" replace /> },
      { path: '/explore', element: <ExplorePage /> },
      { path: '/explore/u/:username', element: <ListenerPage /> },
      { path: '/explore/tapes/:id', element: <PublicTapePage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
