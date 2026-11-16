// Sync engine — plan.md §5.3 / M12
//
// Coordinates the client sync loop:
//   - Push: pending outbox records → POST /api/sync/push (batches of ≤100)
//   - Pull: records since cursor → GET /api/sync/pull (pagination)
//   - SSE: GET /api/events → on 'records' event, trigger pull
//   - Backoff: exponential (1 s → 30 s) on network errors
//   - Online/offline + visibility-change triggers
//   - Rejected records stay in outbox with reason, shown in "Sync problems"
//
// All writes go first to local Dexie (LocalStore). The sync engine reconciles
// local outbox with the server and pulls new records down.

import { LocalStore, type OutboxEntry } from './localStore.js';
import type { RecordEnvelope } from '@stabsstod/shared';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'problems';

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  problemCount: number;
}

interface PushResult {
  status: 'accepted' | 'duplicate' | 'rejected';
  serverSeq?: number;
  reason?: string;
}

interface PullResponse {
  records: RecordEnvelope[];
  nextSince: number;
  hasMore: boolean;
}

const MAX_BATCH = 100;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export class SyncEngine {
  private store: LocalStore;
  private incidentId: string;
  private baseUrl: string;
  private status: SyncStatus = { state: 'synced', pendingCount: 0, problemCount: 0 };
  private backoffMs = INITIAL_BACKOFF_MS;
  running = false;
  private sse: EventSource | null = null;
  private listeners = new Set<(status: SyncStatus) => void>();
  private syncPromise: Promise<void> | null = null;
  // A trigger (SSE 'records' event, tab focus, online) arrived while a sync
  // was in flight. That sync's pull may already have executed before the
  // triggering records reached the server, so the trigger is not dropped:
  // one follow-up sync runs after the in-flight sync completes.
  private pendingTrigger = false;
  // Waiters for settle(): resolved when no sync is in flight and no trigger
  // is pending.
  private settledResolvers: Array<() => void> = [];

  constructor(
    store: LocalStore,
    _userId: string,
    incidentId: string,
    baseUrl = '',
  ) {
    this.store = store;
    this.incidentId = incidentId;
    this.baseUrl = baseUrl;
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setStatus(next: SyncStatus): void {
    this.status = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
    window.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void this.syncOnce();
      }
    });

    await this.handleOnline();
  }

  /**
   * Resolve when the engine is fully settled: no sync in flight and no
   * pending trigger (i.e. no follow-up sync is about to start).
   */
  async settle(): Promise<void> {
    if (this.syncPromise === null && !this.pendingTrigger) return;
    await new Promise<void>((res) => this.settledResolvers.push(res));
  }

  private resolveSettled(): void {
    if (this.syncPromise !== null || this.pendingTrigger) return;
    const resolvers = this.settledResolvers;
    this.settledResolvers = [];
    for (const r of resolvers) r();
  }

  stop(): void {
    this.running = false;
    this.pendingTrigger = false;
    this.disconnectSSE();
    window.removeEventListener('online', () => this.handleOnline());
    window.removeEventListener('offline', () => this.handleOffline());
    window.removeEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void this.syncOnce();
      }
    });
  }

  private handleOnline(): void {
    if (!this.running) return;
    if (navigator.onLine) {
      this.backoffMs = INITIAL_BACKOFF_MS;
      void this.syncOnce();
      this.connectSSE();
    } else {
      this.handleOffline();
    }
  }

  private handleOffline(): void {
    this.disconnectSSE();
    this.updateCounts();
  }

  async syncOnce(): Promise<void> {
    if (!this.running || !navigator.onLine) return;
    if (this.syncPromise) {
      // A trigger was lost if we returned here without remembering it:
      // its pull may already have run before the triggering records were
      // committed server-side.
      this.pendingTrigger = true;
      return this.syncPromise;
    }
    this.pendingTrigger = false;

    this.syncPromise = (async () => {
      try {
        this.setStatus({
          state: 'syncing',
          pendingCount: this.status.pendingCount,
          problemCount: this.status.problemCount,
        });

        await this.push();
        await this.pull();
        this.backoffMs = INITIAL_BACKOFF_MS;
        await this.updateCounts();
      } catch (err) {
        console.error('Sync error:', err);
        const isNetworkError = err instanceof TypeError;
        if (isNetworkError || !navigator.onLine) {
          const pending = await this.store.getPendingOutbox();
          this.setStatus({ state: 'offline', pendingCount: pending.length, problemCount: 0 });
        }
      } finally {
        this.syncPromise = null;
        if (this.pendingTrigger && this.running) {
          this.pendingTrigger = false;
          void this.syncOnce();
        }
        this.resolveSettled();
      }
    })();

    return this.syncPromise;
  }

  // ---------------------------------------------------------------------------
  // Push: outbox → server
  // ---------------------------------------------------------------------------

  private async push(): Promise<void> {
    const pending = await this.store.getPendingOutbox();
    const toPush = pending.filter((e) => e.status === 'pending');
    if (toPush.length === 0) return;

    const records = toPush.map((e) => e.record);

    for (let i = 0; i < records.length; i += MAX_BATCH) {
      const batch = records.slice(i, i + MAX_BATCH);
      const batchEntries = toPush.slice(i, i + MAX_BATCH);
      const res = await globalThis.fetch(`${this.baseUrl}/api/sync/push`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: this.incidentId, records: batch }),
      });
      if (!res.ok) {
        throw new Error(`Push failed: HTTP ${res.status}`);
      }

      const body: { results: PushResult[] } = await res.json();

      for (let j = 0; j < batch.length; j++) {
        const result = body.results[j];
        const recordId = batch[j].id;
        void batchEntries[j];

        if (result.status === 'accepted' || result.status === 'duplicate') {
          await this.store.markOutboxSent(recordId);
        } else if (result.status === 'rejected') {
          await this.store.markOutboxRejected(
            recordId,
            result.reason ?? 'rejected by server',
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pull: server → local Dexie
  // ---------------------------------------------------------------------------

  private async pull(): Promise<void> {
    let since = (await this.store.getCursor(this.incidentId)) ?? 0;

    // Safety limit to avoid infinite loops on bad servers
    let rounds = 0;
    const maxRounds = 10;

    while (rounds < maxRounds) {
      rounds += 1;

      // baseUrl may be '' (same origin, the default): resolve against the
      // page origin so the URL is always valid.
      const url = new URL(`${this.baseUrl}/api/sync/pull`, window.location.origin);
      url.searchParams.set('incidentId', this.incidentId);
      url.searchParams.set('since', String(since));
      url.searchParams.set('limit', '500');

      const res = await globalThis.fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Pull failed: HTTP ${res.status}`);
      }

      const body: PullResponse = await res.json();

      if (body.records.length > 0) {
        await this.store.ingestRemoteRecords(body.records);
        since = body.nextSince;
        await this.store.setCursor(this.incidentId, since);
      }

      if (!body.hasMore) break;
    }
  }

  // ---------------------------------------------------------------------------
  // SSE: server → client push notifications
  // ---------------------------------------------------------------------------

  private connectSSE(): void {
    this.disconnectSSE();

    // Same as pull(): baseUrl may be '' (same origin).
    const url = new URL(`${this.baseUrl}/api/events`, window.location.origin);
    url.searchParams.set('incidentId', this.incidentId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const EventSourceCtor = globalThis.EventSource as any;
    this.sse = new EventSourceCtor(url.toString(), { withCredentials: true });

    const sse = this.sse;
    if (sse && typeof sse.addEventListener === 'function') {
      sse.addEventListener('records', () => {
        void this.syncOnce();
      });
    }

    sse!.onopen = () => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      // Catch up on records broadcast while the SSE connection was down —
      // the server does not replay missed events, so the open is the
      // natural moment to reconcile by pull.
      void this.syncOnce();
    };

    sse!.onerror = () => {
      this.disconnectSSE();
      if (this.running) {
        setTimeout(() => this.connectSSE(), this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      }
    };
  }

  private disconnectSSE(): void {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Status helpers
  // ---------------------------------------------------------------------------

  private async updateCounts(): Promise<void> {
    const all = await this.store.getOutbox();
    const pending = all.filter((e) => e.status === 'pending');
    const rejected = all.filter((e) => e.status === 'rejected');
    let state: SyncState;
    if (!navigator.onLine && pending.length > 0) {
      state = 'offline';
    } else if (rejected.length > 0) {
      state = 'problems';
    } else if (pending.length > 0) {
      state = 'syncing';
    } else {
      state = 'synced';
    }
    this.setStatus({ state, pendingCount: pending.length, problemCount: rejected.length });
  }

  async getProblemRecords(): Promise<OutboxEntry[]> {
    const all = await this.store.getOutbox();
    return all.filter((e) => e.status === 'rejected');
  }

  async retryProblem(recordId: string): Promise<void> {
    const problems = await this.getProblemRecords();
    const entry = problems.find((e) => e.id === recordId);
    if (!entry) return;

    // Reset to pending so the next push picks it up
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = await (this.store as any).ensureDb();
    await db.outbox.put({
      id: entry.id,
      record: entry.record,
      status: 'pending',
      reason: undefined,
      createdAt: entry.createdAt,
    });

    await this.updateCounts();
    void this.syncOnce();
  }
}
