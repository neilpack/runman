// All app routes. To add a page: create it in src/pages, then add it here and to NAV_LINKS in Layout.

import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { WelcomePage } from './pages/WelcomePage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter([
  // Signed-out screens render full-bleed, outside the app Layout.
  { path: '/', element: <WelcomePage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/home', element: <HomePage /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
