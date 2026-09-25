import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export interface ChangeEvent {
  topic: string;
  at: number;
}

const MAX_CLIENTS = Number(process.env.LIVE_MAX_CLIENTS) || 500;
const HEARTBEAT_MS = 25_000;
/** Several quick edits (a bulk action, a form save plus an image upload) become one notification. */
const COALESCE_MS = 150;

/**
 * Real-time updates. Every connected browser (website visitors, students, staff) holds one
 * Server-Sent Events connection; when something changes, the server sends just the TOPIC name
 * ("courses", "applications", "notifications:student:<id>") — never the data. Browsers listening
 * for that topic refetch through the normal permission-checked API, so nothing private can leak
 * through the stream, and one small free server can keep hundreds of screens up to date.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly subject = new Subject<ChangeEvent>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private clients = 0;
  private readonly writeListeners = new Set<() => void>();

  /** Server-side only: run `listener` after every successful write (used to drop cached dashboard numbers). */
  onWrite(listener: () => void): void {
    this.writeListeners.add(listener);
  }

  noteWrite(): void {
    this.writeListeners.forEach((listener) => listener());
  }

  emit(topics: string[]): void {
    for (const topic of topics) {
      if (this.pending.has(topic)) continue;
      this.pending.set(
        topic,
        setTimeout(() => {
          this.pending.delete(topic);
          this.subject.next({ topic, at: Date.now() });
        }, COALESCE_MS)
      );
    }
  }

  get clientCount(): number {
    return this.clients;
  }

  get isFull(): boolean {
    return this.clients >= MAX_CLIENTS;
  }

  /** One SSE connection: `ready`, then `change` events, plus a periodic `ping` so proxies keep the socket open. */
  stream(): Observable<{ type: string; data: ChangeEvent | { at: number } }> {
    return new Observable((subscriber) => {
      this.clients += 1;
      subscriber.next({ type: "ready", data: { at: Date.now() } });
      const sub = this.subject.subscribe((event) => subscriber.next({ type: "change", data: event }));
      const heartbeat = setInterval(() => subscriber.next({ type: "ping", data: { at: Date.now() } }), HEARTBEAT_MS);
      return () => {
        this.clients -= 1;
        clearInterval(heartbeat);
        sub.unsubscribe();
      };
    });
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.subject.complete();
  }
}
