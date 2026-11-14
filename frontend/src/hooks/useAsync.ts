import { useCallback, useEffect, useState } from 'react';

/** Runs an async function on mount and exposes { data, error, loading, reload }. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);

  // `deps` controls when the request re-runs (e.g. pass [id] for a detail page).
  const run = useCallback(fn, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await run());
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
