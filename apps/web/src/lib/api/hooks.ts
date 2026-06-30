"use client";
/* React data hook (ported from the bundle's client.jsx useApi): loading / empty /
   error, with optional silent polling that keeps the last data on transient errors
   so views feel live without loading flicker. The fetch lives inside the effect and
   reads fn from a latest-ref, so the effect keys on the stringified deps (not on fn,
   a fresh arrow each render) without re-running every render; reload bumps a counter
   to re-run it. No synchronous setState in the effect body — happy under the React Compiler. */
import { useEffect, useRef, useState } from "react";

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  stale: boolean;
}
export interface UseApiResult<T> extends UseApiState<T> {
  reload: () => void;
}

export function useApi<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  options: { pollMs?: number } = {},
): UseApiResult<T> {
  const { pollMs } = options;
  const [state, setState] = useState<UseApiState<T>>({ data: null, loading: true, error: null, stale: false });
  const [reloadN, setReloadN] = useState(0);
  const depKey = JSON.stringify(deps);

  // Keep the latest fn in a ref so the data effect depends only on depKey/poll/reload.
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    const load = (silent: boolean) => {
      Promise.resolve()
        .then(() => fnRef.current())
        .then(
          (data) => {
            if (!cancelled) setState({ data, loading: false, error: null, stale: false });
          },
          (err: unknown) => {
            if (cancelled) return;
            const error = err instanceof Error ? err : new Error(String(err));
            setState((s) => ({ data: silent ? s.data : null, loading: false, error, stale: silent && !!s.data }));
          },
        );
    };
    load(false);
    if (!pollMs) return () => { cancelled = true; };
    const id = setInterval(() => load(true), pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [depKey, pollMs, reloadN]);

  const reload = () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setReloadN((n) => n + 1);
  };

  return { ...state, reload };
}

// Re-render on an interval so relative timestamps advance even without polling.
export function useTick(ms = 1000): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
