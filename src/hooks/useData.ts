import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api";
import { subscribe } from "@/services/live";

/**
 * Loads data from the API and keeps it fresh: when any of `topics` changes on the server (someone
 * else saved something), it quietly reloads without showing a spinner again.
 * Pass `null` as the path to wait (e.g. until an id is known).
 */
export function useData<T>(path: string | null, topics: string[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      if (!quiet) setLoading(true);
      try {
        const result = await api.get<T>(path);
        if (current.current === path) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (current.current === path && !quiet) setError(err as Error);
      } finally {
        if (current.current === path) setLoading(false);
      }
    },
    [path]
  );

  useEffect(() => {
    setData(undefined);
    void load();
  }, [load]);

  const topicKey = topics.join("|");
  useEffect(() => {
    if (!path || !topicKey) return;
    return subscribe(topicKey.split("|"), () => void load(true));
  }, [path, topicKey, load]);

  return { data, error, loading, reload: () => load(true), setData };
}

/** Runs an action with a busy flag and error message, for buttons and forms. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await action(...args);
      } catch (err) {
        setError(err as Error);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [action]
  );
  return { run, busy, error, setError };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Sets the browser tab title and description for each page (search engines read these). */
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title ? `${title} · Heimatliebe Institute` : "Heimatliebe Institute";
    if (description) document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);
}
