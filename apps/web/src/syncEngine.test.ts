import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import type { RecordEnvelope } from '@stabsstod/shared';
import { LocalStore } from './localStore.js';
import { SyncEngine } from './syncEngine.js';
import type { LocalStore as LocalStoreType } from './localStore.js';
import type { SyncEngine as SyncEngineType } from './syncEngine.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

(globalThis as any).indexedDB = indexedDB;

class MockEventSource {
  onopen: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
}
(globalThis as any).EventSource = MockEventSource as any;

(globalThis as any).__TEST_DEXIE__ = class {
  records = makeMockTable();
  outbox = makeMockTable();
  entities = makeMockTable();
  meta = makeMockTable();
  blobs = makeMockTable();
  version() { return this; }
  stores() { return this; }
  async close() { return undefined; }
  async delete() { return undefined; }
};

function makeMockTable() {
  const data = new Map<string, any>();
  return {
    async put(keyOrRecord: any, value?: any) {
      if (value === undefined) {
        const key = keyOrRecord.id ?? keyOrRecord.entityId ?? keyOrRecord.incidentId ?? keyOrRecord.hash;
        if (key !== undefined) data.set(key, keyOrRecord);
      } else {
        data.set(keyOrRecord, value);
      }
      return undefined;
    },
    async bulkPut(items: any[]) {
      items.forEach((i) => {
        const key = i.id ?? i.entityId ?? i.incidentId ?? i.hash;
        if (key !== undefined) data.set(key, i);
      });
      return undefined;
    },
    async get(key: any) { return data.get(key); },
    async delete(key: string) { data.delete(key); return undefined; },
    async toArray() { return Array.from(data.values()); },
    where(field: string) {
      return {
        anyOf: (values: any[]) => ({
          async toArray() {
            const result: any[] = [];
            for (const v of data.values()) {
              if (values.includes(v[field])) result.push(v);
            }
            return result;
          },
          async first() {
            for (const v of data.values()) {
              if (values.includes(v[field])) return v;
            }
            return undefined;
          },
        }),
        equals: (value: any) => ({
          async toArray() {
            const result: any[] = [];
            for (const v of data.values()) {
              if (v[field] === value) result.push(v);
            }
            return result;
          },
          async first() {
            for (const v of data.values()) {
              if (v[field] === value) return v;
            }
            return undefined;
          },
        }),
      };
    },
    async update(key: string, changes: any) {
      const existing = data.get(key);
      if (existing) data.set(key, { ...existing, ...changes });
    },
  };
}

const INCIDENT = 'incident-1';
const BASE_URL = 'http://localhost:3000';

function makeRecord(
  overrides: Record<string, unknown> = {},
): RecordEnvelope {
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    entityId: 'entity-1',
    entityType: 'log_entry',
    incidentId: INCIDENT,
    parentIds: [],
    functionId: 'fn-1',
    authorId: 'author-1',
    deviceId: 'device-1',
    hlc: '000000000000001-00001-device-1',
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    schemaVersion: 1,
    payload: { text: 'test', category: 'info', eventTime: new Date().toISOString(), visibility: 'incident' },
    ...overrides,
  };
}

interface FakePushResult {
  status: 'accepted' | 'duplicate' | 'rejected';
  serverSeq?: number;
  reason?: string;
}

class FakeAPI {
  records: Map<string, RecordEnvelope & { serverSeq: number }> = new Map();
  serverSeq = 0;
  fail = false;
  members: Map<string, Set<string>> = new Map();

  addMember(incidentId: string, userId: string): void {
    let s = this.members.get(incidentId);
    if (!s) { s = new Set(); this.members.set(incidentId, s); }
    s.add(userId);
  }

  isMember(incidentId: string, userId: string): boolean {
    return this.members.get(incidentId)?.has(userId) ?? false;
  }

  async handlePush(body: { incidentId: string; records: RecordEnvelope[] }): Promise<{ results: FakePushResult[] }> {
    if (this.fail) throw new TypeError('Failed to fetch');
    if (!this.isMember(body.incidentId, 'usera') && !this.isMember(body.incidentId, 'userb')) {
      return { results: [{ status: 'rejected', reason: 'not a member' }] };
    }
    const results: FakePushResult[] = [];
    for (const record of body.records) {
      if (this.records.has(record.id)) {
        results.push({ status: 'duplicate' });
        continue;
      }
      this.serverSeq += 1;
      this.records.set(record.id, { ...record, serverSeq: this.serverSeq });
      results.push({ status: 'accepted', serverSeq: this.serverSeq });
    }
    return { results };
  }

  async handlePull(params: { incidentId: string; since: number; limit: number }): Promise<{ records: RecordEnvelope[]; nextSince: number; hasMore: boolean }> {
    if (this.fail) throw new TypeError('Failed to fetch');
    const all = Array.from(this.records.values())
      .filter((r) => r.incidentId === params.incidentId && r.serverSeq > params.since)
      .sort((a, b) => a.serverSeq - b.serverSeq)
      .slice(0, params.limit);
    const nextSince = all.length > 0 ? all[all.length - 1].serverSeq : params.since;
    return {
      records: all,
      nextSince,
      hasMore: all.length === params.limit,
    };
  }
}

let fakeAPI: FakeAPI;

function makeFetchStub(): {
  api: FakeAPI;
} {
  fakeAPI = new FakeAPI();
  fakeAPI.addMember(INCIDENT, 'usera');
  fakeAPI.addMember(INCIDENT, 'userb');

  async function fetchFn(input: any, init?: any): Promise<Response> {
    if (fakeAPI.fail) {
      throw new TypeError('Failed to fetch');
    }
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.includes('/api/sync/push') && method === 'POST') {
      const res = await fakeAPI.handlePush(body);
      return { ok: true, status: 200, json: async () => res } as unknown as Response;
    }
    if (url.includes('/api/sync/pull') && method === 'GET') {
      const since = Number(new URL(url).searchParams.get('since')) || 0;
      const limit = Math.min(Number(new URL(url).searchParams.get('limit')) || 500, 500);
      const res = await fakeAPI.handlePull({ incidentId: new URL(url).searchParams.get('incidentId') ?? INCIDENT, since, limit });
      return { ok: true, status: 200, json: async () => res } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response;
  }

  globalThis.fetch = fetchFn as typeof fetch;

  return { api: fakeAPI };
}

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => undefined,
}));

describe('SyncEngine — status', () => {
  let store: LocalStoreType;
  let engine: SyncEngineType;

  beforeEach(() => {
    makeFetchStub();
    store = new LocalStore({ userId: 'user-1' });
    engine = new SyncEngine(store, 'user-1', INCIDENT, BASE_URL);
  });

  afterEach(async () => {
    await store.close();
  });

  it('marks rejected records in outbox', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/sync/push') && init?.method === 'POST') {
        const records = JSON.parse(String(init.body)).records;
        const results = records.map((_r: any, i: number) =>
          i === 0
            ? { status: 'rejected' as const, reason: 'forbidden: cannot write' }
            : { status: 'accepted' as const },
        );
        return { ok: true, status: 200, json: async () => ({ results }) } as unknown as Response;
      }
      return originalFetch(input, init);
    };

    const r1 = makeRecord({ id: 'rec-reject-1' });
    const r2 = makeRecord({ id: 'rec-reject-2' });
    await store.addLocalRecord(r1);
    await store.addLocalRecord(r2);

    await engine.start();
    await engine.syncOnce();

    const outbox = await store.getOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].id).toBe('rec-reject-1');
    expect(outbox[0].status).toBe('rejected');
    expect(outbox[0].reason).toBe('forbidden: cannot write');

    const status = engine.getStatus();
    expect(status.state).toBe('problems');
    expect(status.problemCount).toBe(1);

    globalThis.fetch = originalFetch;
  });

  it('goes offline when fetch fails', async () => {
    fakeAPI.fail = true;
    engine.running = true;
    const record = makeRecord({ id: 'rec-offline-1' });
    await store.addLocalRecord(record);

    await engine.syncOnce();

    const outbox = await store.getOutbox();
    expect(outbox.length).toBe(1);
    // Record should remain in outbox (not removed by successful push)
    expect(outbox[0].id).toBe(record.id);

    const status = engine.getStatus();
    expect(status.state).toBe('offline');

    fakeAPI.fail = false;
  });

  it('retries rejected records and clears problems', async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/sync/push') && init?.method === 'POST') {
        callCount++;
        const records = JSON.parse(String(init.body)).records;
        const results = records.map(() =>
          callCount === 1
            ? { status: 'rejected' as const, reason: 'temporary failure' }
            : { status: 'accepted' as const },
        );
        return { ok: true, status: 200, json: async () => ({ results }) } as unknown as Response;
      }
      return originalFetch(input, init);
    };

    const record = makeRecord({ id: 'rec-retry-1' });
    await store.addLocalRecord(record);

    await engine.start();
    await engine.syncOnce();

    let outbox = await store.getOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].status).toBe('rejected');

    await engine.retryProblem(outbox[0].id);
    await engine.syncOnce();

    outbox = await store.getOutbox();
    expect(outbox.length).toBe(0);

    const status = engine.getStatus();
    expect(status.state).toBe('synced');

    globalThis.fetch = originalFetch;
  });

  it('onStatusChange notifies listeners', () => {
    const listener = vi.fn();
    const unsubscribe = engine.onStatusChange(listener);

    engine.setStatus({ state: 'syncing', pendingCount: 1, problemCount: 0 });
    expect(listener).toHaveBeenCalledWith({
      state: 'syncing',
      pendingCount: 1,
      problemCount: 0,
    });

    unsubscribe();
    engine.setStatus({ state: 'synced', pendingCount: 0, problemCount: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('SyncEngine — integration', () => {
  let storeA: LocalStoreType;
  let storeB: LocalStoreType;
  let engineA: SyncEngineType;
  let engineB: SyncEngineType;

  beforeEach(() => {
    makeFetchStub();
    storeA = new LocalStore({ userId: 'usera' });
    storeB = new LocalStore({ userId: 'userb' });
    engineA = new SyncEngine(storeA, 'usera', INCIDENT, BASE_URL);
    engineB = new SyncEngine(storeB, 'userb', INCIDENT, BASE_URL);
  });

  afterEach(async () => {
    engineA.stop();
    engineB.stop();
    await storeA.close();
    await storeB.close();
  });

  it('A and B converge', async () => {
    engineA.running = true;
    engineB.running = true;
    const recA = makeRecord({ id: 'rec-int-a', authorId: 'usera' });
    await storeA.addLocalRecord(recA);
    const recB = makeRecord({ id: 'rec-int-b', entityId: 'entity-2', authorId: 'userb' });
    await storeB.addLocalRecord(recB);
    await engineA.syncOnce();
    await engineB.syncOnce();
    expect((await storeA.getOutbox()).length).toBe(0);
    expect((await storeB.getOutbox()).length).toBe(0);
  });

  it('A goes offline, edits, reconnects, and converges', async () => {
    engineA.running = true;
    engineB.running = true;
    const recA1 = makeRecord({ id: 'rec-off-a1', authorId: 'usera' });
    await storeA.addLocalRecord(recA1);
    await engineA.syncOnce();
    expect((await storeA.getOutbox()).length).toBe(0);
    const recA2 = makeRecord({ id: 'rec-off-a2', authorId: 'usera' });
    await storeA.addLocalRecord(recA2);
    expect((await storeA.getOutbox()).length).toBe(1);
    const recB = makeRecord({ id: 'rec-off-b', entityId: 'entity-2', authorId: 'userb' });
    await storeB.addLocalRecord(recB);
    await engineB.syncOnce();
    expect((await storeB.getOutbox()).length).toBe(0);
    await engineA.syncOnce();
    expect((await storeA.getOutbox()).length).toBe(0);
    await engineA.syncOnce();
    await engineB.syncOnce();
    const recordsA = await storeA.getRecordsByIncident(INCIDENT);
    const recordsB = await storeB.getRecordsByIncident(INCIDENT);
    expect(recordsA.map((r: RecordEnvelope) => r.id).sort()).toEqual(['rec-off-a1', 'rec-off-a2', 'rec-off-b'].sort());
    expect(recordsB.map((r: RecordEnvelope) => r.id).sort()).toEqual(['rec-off-a1', 'rec-off-a2', 'rec-off-b'].sort());
  });

  it('duplicate delivery is harmless', async () => {
    engineA.running = true;
    const recA = makeRecord({ id: 'rec-dup-1', authorId: 'usera' });
    await storeA.addLocalRecord(recA);
    await engineA.syncOnce();
    expect((await storeA.getOutbox()).length).toBe(0);
    await storeA.addLocalRecord(recA);
    await engineA.syncOnce();
    expect((await storeA.getOutbox()).length).toBe(0);
  });
});
