// All app routes. To add a page: create it in src/pages, then add it here and to NAV_LINKS in Layout.

import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { EditCassettePage } from './pages/EditCassettePage';
import { DashboardPage } from './pages/DashboardPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LibraryPage /> },
      { path: '/cassettes/:id/edit', element: <EditCassettePage /> },
      { path: '/status', element: <HomePage /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
