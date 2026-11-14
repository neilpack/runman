import { NavLink, Outlet } from 'react-router';
import { Avatar } from '@/components/profile/Avatar';
import { useAccount } from '@/hooks/useAccount';

const NAV_LINKS = [
  { to: '/library', label: 'Library' },
  { to: '/explore', label: 'Explore' },
  { to: '/account', label: 'Account' },
];

export function Layout() {
  const { profile } = useAccount();

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/welcome" className="brand" aria-label="RunMan welcome page">
          runman
        </NavLink>
        <nav className="nav">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {link.to === '/account' && profile && (
                <Avatar src={profile.avatar} name={profile.username} size={22} className="nav-avatar" />
              )}
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
