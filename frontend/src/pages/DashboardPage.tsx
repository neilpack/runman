// Example page wired end-to-end to the backend /api/items resource.

import { useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

export function DashboardPage() {
  const { data: items, error, loading, reload } = useAsync(api.listItems);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await api.createItem({ name: name.trim() });
      setName('');
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await api.deleteItem(id);
    await reload();
  }

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <Card title="Add item">
        <form className="row" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="Item name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={submitting || !name.trim()}>
            Add
          </Button>
        </form>
      </Card>

      <Card title="Items">
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error.message}</p>}
        {items && items.length === 0 && <p className="muted">No items yet.</p>}
        {items && items.length > 0 && (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id} className="list-item">
                <span>{item.name}</span>
                <Button variant="danger" onClick={() => handleDelete(item.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
