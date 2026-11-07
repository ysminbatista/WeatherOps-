'use client';
import { useEffect, useState } from 'react';
import { REFRESH_MS } from './api.js';

/**
 * Carrega `loader(key, signal)` e revalida a cada 5 min sem recarregar a página.
 * Se uma revalidação falhar, mantém o último dado e sinaliza `refreshFailed`.
 */
export function useRefresh(key, loader) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    if (key == null) return undefined;
    let alive = true;
    const ctrl = new AbortController();
    setState({ data: null, loading: true, error: null });

    const run = async () => {
      try {
        const data = await loader(key, ctrl.signal);
        if (alive) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        setState((prev) => ({ data: prev.data, loading: false, error: err }));
      }
    };
    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => { alive = false; ctrl.abort(); clearInterval(timer); };
  }, [key, loader]);

  return state;
}
