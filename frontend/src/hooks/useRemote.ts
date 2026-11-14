import { useCallback, useEffect, useState } from 'react';

interface RemoteState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/**
 * Fetches when `deps` change, aborting the previous request. Keeps the last data while a new
 * request loads (no flash of empty results while typing). `delayMs` debounces search inputs.
 */
export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], delayMs = 0) {
  const [state, setState] = useState<RemoteState<T>>({ data: undefined, error: undefined, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const timer = window.setTimeout(() => {
      load(ctrl.signal).then(
        (data) => {
          if (!ctrl.signal.aborted) setState({ data, error: undefined, loading: false });
        },
        (error: unknown) => {
          if (ctrl.signal.aborted) return;
          const err = error instanceof Error ? error : new Error('Something went wrong.');
          setState({ data: undefined, error: err, loading: false });
        },
      );
    }, delayMs);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
    // `load` is usually an inline closure; `deps` says when it actually changes.
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
