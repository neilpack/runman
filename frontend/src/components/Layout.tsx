import { NavLink, Outlet } from 'react-router';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/about', label: 'About' },
];

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="brand">
          runman
        </NavLink>
        <nav className="nav">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">Built at the hackathon</footer>
    </div>
  );
}
