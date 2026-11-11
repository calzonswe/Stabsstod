// Client local store tests — plan.md §5.3 / M11
//
// Tests use a mock Dexie class set via globalThis.__TEST_DEXIE__ to avoid
// IndexedDB environment issues. Dexie is imported lazily inside LocalStore
// methods, so the override must be set before LocalStore is imported.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Mock Dexie class — used as globalThis.__TEST_DEXIE__ override
class MockTable {
  private data = new Map<string, any>();
  async put(keyOrRecord: any, value?: any) {
      if (value === undefined) {
        const key = keyOrRecord.id ?? keyOrRecord.entityId ?? keyOrRecord.incidentId ?? keyOrRecord.hash;
        this.data.set(key, keyOrRecord);
      } else {
        this.data.set(keyOrRecord, value);
      }
      return undefined;
    }
  async bulkPut(items: any[]) {
    items.forEach(i => {
      const key = i.id ?? i.entityId ?? i.incidentId ?? i.hash;
      if (key !== undefined) this.data.set(key, i);
    });
    return undefined;
  }
  async get(key: any) { return this.data.get(key); }
  async delete(key: string) { this.data.delete(key); return undefined; }
  async toArray() { return Array.from(this.data.values()); }
  async update(key: string, changes: any) { const existing = this.data.get(key); if (existing) this.data.set(key, { ...existing, ...changes }); }
  where(field: string) { return new MockQuery(this.data, field); }
}
class MockQuery {
  constructor(private data: Map<string, any>, private field: string) {}
  anyOf(values: any[]) { return new MockQueryResults(this.data, this.field, values); }
  equals(value: any) { return new MockQueryResults(this.data, this.field, [value]); }
}
class MockQueryResults {
  constructor(private data: Map<string, any>, private field: string, private values: any[]) {}
  async toArray() {
    const result: any[] = [];
    for (const v of this.data.values()) {
      if (this.values.includes(v[this.field])) result.push(v);
    }
    return result;
  }
  async first() {
    for (const v of this.data.values()) {
      if (this.values.includes(v[this.field])) return v;
    }
    return undefined;
  }
}
class Dexie {
  records = new MockTable();
  outbox = new MockTable();
  entities = new MockTable();
  meta = new MockTable();
  blobs = new MockTable();
  version(): any { return this; }
  stores(): any { return this; }
  async close() { return undefined; }
  async delete() { return undefined; }
}

// Set the test override before importing LocalStore
(globalThis as any).__TEST_DEXIE__ = Dexie;

import { LocalStore } from './localStore.js';
import type { RecordEnvelope } from '@stabsstod/shared';

const INCIDENT = 'incident-1';

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
    payload: {
      text: 'test entry',
      category: 'info',
      eventTime: new Date().toISOString(),
      visibility: 'incident',
    },
    ...overrides,
  };
}

describe('LocalStore — add/read', () => {
  let store: LocalStore;

  beforeEach(() => {
    store = new LocalStore({ userId: 'user-1' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('addLocalRecord writes to records and outbox', async () => {
    const record = makeRecord();
    await store.addLocalRecord(record);

    const records = await store.getRecordsByIncident(INCIDENT);
    expect(records.length).toBe(1);
    expect(records[0].id).toBe(record.id);
    expect(records[0].entityId).toBe(record.entityId);

    const outbox = await store.getOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].id).toBe(record.id);
    expect(outbox[0].status).toBe('pending');
  });

  it('ingestRemoteRecords stores records', async () => {
    const r1 = makeRecord({ id: 'rec-1' });
    const r2 = makeRecord({ id: 'rec-2', entityId: 'entity-2' });
    await store.ingestRemoteRecords([r1, r2]);

    const all = await store.getRecordsByIncident(INCIDENT);
    expect(all.length).toBe(2);
    expect(all.map((r: RecordEnvelope) => r.id).sort()).toEqual([
      'rec-1',
      'rec-2',
    ].sort());
  });

  it('getEntity returns materialized entity state', async () => {
    const r1 = makeRecord({ id: 'rec-1', entityId: 'entity-1' });
    const r2 = makeRecord({ id: 'rec-2', entityId: 'entity-1', parentIds: ['rec-1'] });
    await store.ingestRemoteRecords([r1, r2]);

    const entity = await store.getEntity('entity-1');
    expect(entity).toBeDefined();
    expect(entity!.entityId).toBe('entity-1');
    expect(entity!.current!.id).toBe('rec-2');
    expect(entity!.conflict).toBe(false);
  });

  it('getEntity returns undefined for unknown entity', async () => {
    const entity = await store.getEntity('nonexistent');
    expect(entity).toBeUndefined();
  });
});

describe('LocalStore — conflict detection', () => {
  let store: LocalStore;

  beforeEach(() => {
    store = new LocalStore({ userId: 'user-1' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('two concurrent heads produce conflict=true', async () => {
    const r1 = makeRecord({ id: 'rec-1', entityId: 'entity-conflict', parentIds: [] });
    const r2 = makeRecord({ id: 'rec-2', entityId: 'entity-conflict', parentIds: [] });
    await store.ingestRemoteRecords([r1, r2]);

    const entity = await store.getEntity('entity-conflict');
    expect(entity).toBeDefined();
    expect(entity!.heads.length).toBe(2);
    expect(entity!.conflict).toBe(true);
    expect(entity!.current!.id).toBeDefined();
  });

  it('merge record resolves conflict', async () => {
    const r1 = makeRecord({ id: 'rec-1', entityId: 'entity-conflict', parentIds: [] });
    const r2 = makeRecord({ id: 'rec-2', entityId: 'entity-conflict', parentIds: [] });
    const r3 = makeRecord({
      id: 'rec-3',
      entityId: 'entity-conflict',
      parentIds: ['rec-1', 'rec-2'],
    });
    await store.ingestRemoteRecords([r1, r2, r3]);

    const entity = await store.getEntity('entity-conflict');
    expect(entity).toBeDefined();
    expect(entity!.heads.length).toBe(1);
    expect(entity!.conflict).toBe(false);
    expect(entity!.current!.id).toBe('rec-3');
  });
});

describe('LocalStore — outbox contents', () => {
  let store: LocalStore;

  beforeEach(() => {
    store = new LocalStore({ userId: 'user-1' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('addLocalRecord puts record in outbox with pending status', async () => {
    const record = makeRecord({ id: 'rec-outbox-1' });
    await store.addLocalRecord(record);

    const outbox = await store.getOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].id).toBe(record.id);
    expect(outbox[0].status).toBe('pending');
    expect(outbox[0].reason).toBeUndefined();
  });

  it('markOutboxSent removes the record from outbox', async () => {
    const record = makeRecord({ id: 'rec-outbox-sent' });
    await store.addLocalRecord(record);

    await store.markOutboxSent(record.id);

    const outbox = await store.getOutbox();
    expect(outbox.length).toBe(0);
  });

  it('markOutboxRejected sets status and reason', async () => {
    const record = makeRecord({ id: 'rec-outbox-rejected' });
    await store.addLocalRecord(record);

    await store.markOutboxRejected(record.id, 'forbidden: cannot write mission');

    const outbox = await store.getOutbox();
    expect(outbox.length).toBe(1);
    expect(outbox[0].status).toBe('rejected');
    expect(outbox[0].reason).toBe('forbidden: cannot write mission');
  });

  it('getPendingOutbox returns only pending records', async () => {
    const r1 = makeRecord({ id: 'rec-pending-1' });
    const r2 = makeRecord({ id: 'rec-pending-2' });
    await store.addLocalRecord(r1);
    await store.addLocalRecord(r2);
    await store.markOutboxRejected(r2.id, 'some reason');

    const pending = await store.getPendingOutbox();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(r1.id);
  });
});

describe('LocalStore — user id isolation', () => {
  let storeA: LocalStore;
  let storeB: LocalStore;

  beforeEach(async () => {
    storeA = new LocalStore({ userId: 'user-a' });
    storeB = new LocalStore({ userId: 'user-b' });
  });

  afterEach(async () => {
    await storeA.close();
    await storeB.close();
  });

  it('stores are isolated by user id', async () => {
    const r = makeRecord({ id: 'rec-user-a' });
    await storeA.addLocalRecord(r);

    const recordsA = await storeA.getRecordsByIncident(INCIDENT);
    expect(recordsA.length).toBe(1);

    const recordsB = await storeB.getRecordsByIncident(INCIDENT);
    expect(recordsB.length).toBe(0);
  });
});
