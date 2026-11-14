import { Link } from 'react-router';
import { Card } from '@/components/Card';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';

export function HomePage() {
  const { data: health, error } = useAsync(api.health);

  return (
    <div className="page">
      <section className="hero">
        <h1>runman</h1>
        <p className="muted">Hackathon project skeleton. Replace this with your pitch.</p>
        <Link to="/dashboard" className="btn btn-primary">
          Open dashboard
        </Link>
      </section>

      <Card title="Backend status">
        {error && <p className="error">API unreachable: {error.message}. Is the backend running?</p>}
        {!error && !health && <p className="muted">Checking…</p>}
        {health && (
          <p>
            <span className="badge badge-ok">{health.status}</span> {health.service} · storage:{' '}
            <code>{health.storage}</code>
          </p>
        )}
      </Card>
    </div>
  );
}
