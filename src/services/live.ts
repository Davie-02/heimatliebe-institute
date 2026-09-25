/**
 * Real-time updates. The API pushes tiny "this changed" messages (Server-Sent Events) carrying
 * only a topic name; screens subscribed to that topic quietly refetch. The connection is open only
 * while the tab is visible, so phones in a pocket don't keep it alive, and after reconnecting
 * everything refetches once so no change is missed.
 */
const STREAM = import.meta.env.VITE_STREAM_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let delay = 3000;

function notify(topic?: string) {
  const sets = topic ? [listeners.get(topic)] : [...listeners.values()];
  sets.forEach((set) => set?.forEach((listener) => listener()));
}

function wanted() {
  return [...listeners.values()].some((set) => set.size > 0);
}

function disconnect() {
  source?.close();
  source = null;
  if (retry) clearTimeout(retry);
  retry = null;
}

function connect() {
  if (source || !wanted() || document.visibilityState === "hidden" || typeof EventSource === "undefined") return;
  const stream = new EventSource(`${STREAM}/events`);
  source = stream;
  let first = true;
  stream.addEventListener("ready", () => {
    delay = 3000;
    if (!first) notify();
    first = false;
  });
  stream.addEventListener("change", (event) => {
    try {
      notify((JSON.parse((event as MessageEvent).data) as { topic: string }).topic);
    } catch {
      // ignore malformed messages
    }
  });
  stream.onerror = () => {
    stream.close();
    if (source === stream) source = null;
    if (!retry && wanted()) {
      retry = setTimeout(() => {
        retry = null;
        first = false;
        connect();
      }, delay);
      delay = Math.min(delay * 2, 60_000);
    }
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const wasClosed = !source;
      connect();
      if (wasClosed) notify();
    } else disconnect();
  });
}

/** Calls `listener` whenever any of the topics changes. Returns the unsubscribe function. */
export function subscribe(topics: string[], listener: Listener): () => void {
  for (const topic of topics) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic)!.add(listener);
  }
  connect();
  return () => {
    for (const topic of topics) listeners.get(topic)?.delete(listener);
    if (!wanted()) disconnect();
  };
}
