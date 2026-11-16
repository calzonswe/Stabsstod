// Client local store tests — plan.md §5.3 / M11
//
// Mock Dexie class — used as globalThis.__TEST_DEXIE__ override.
// The shared implementation lives in testMockDexie.ts.

import './testMockDexie.js';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Set the test override before importing LocalStore
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

describe('LocalStore — read notifications', () => {
  let store: LocalStore;

  beforeEach(() => {
    store = new LocalStore({ userId: 'user-read-notifications' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('starts with no read ids and tracks marked-read ids per incident', async () => {
    expect(await store.getReadNotificationIds(INCIDENT)).toEqual([]);

    await store.markNotificationRead(INCIDENT, 'task_assigned:task-a');

    expect(await store.getReadNotificationIds(INCIDENT)).toEqual(['task_assigned:task-a']);
    // Other incidents are unaffected.
    expect(await store.getReadNotificationIds('incident-2')).toEqual([]);
  });

  it('markNotificationRead is idempotent', async () => {
    await store.markNotificationRead(INCIDENT, 'conflict:task-c');
    await store.markNotificationRead(INCIDENT, 'conflict:task-c');

    expect(await store.getReadNotificationIds(INCIDENT)).toEqual(['conflict:task-c']);
  });

  it('markAllNotificationsRead stores all given ids', async () => {
    await store.markAllNotificationsRead(INCIDENT, ['a:1', 'a:2', 'a:3']);

    expect(await store.getReadNotificationIds(INCIDENT)).toEqual(['a:1', 'a:2', 'a:3']);
  });
});

describe('LocalStore — subscribe (M39)', () => {
  let store: LocalStore;

  beforeEach(() => {
    store = new LocalStore({ userId: 'user-sub' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('notifies subscribers when remote records are ingested', async () => {
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });

    await store.ingestRemoteRecords([makeRecord({ id: 'rec-sub-1' })]);
    expect(calls).toBe(1);

    await store.ingestRemoteRecords([
      makeRecord({ id: 'rec-sub-2' }),
      makeRecord({ id: 'rec-sub-3', entityId: 'entity-3' }),
    ]);
    expect(calls).toBe(2);

    unsubscribe();
    await store.ingestRemoteRecords([makeRecord({ id: 'rec-sub-4' })]);
    expect(calls).toBe(2);
  });

  it('notifies subscribers when local records are written', async () => {
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });

    await store.addLocalRecord(makeRecord({ id: 'rec-local-1' }));
    expect(calls).toBe(1);

    unsubscribe();
  });

  it('does not notify when the ingestion batch is empty', async () => {
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });

    await store.ingestRemoteRecords([]);
    expect(calls).toBe(0);

    unsubscribe();
  });

  it('a throwing listener does not prevent other listeners from running', async () => {
    let goodCalls = 0;
    const good = store.subscribe(() => {
      goodCalls++;
    });
    const bad = store.subscribe(() => {
      throw new Error('boom');
    });

    await store.ingestRemoteRecords([makeRecord({ id: 'rec-err-1' })]);

    expect(goodCalls).toBe(1);
    bad();
    good();
  });
});
