// Client local store — plan.md §5.3 / M11
//
// Dexie-based IndexedDB store for offline-first operation. All writes go first
// to local Dexie (records + outbox); the UI reads immediately from local data.
//
// DB name includes the user id: stabsstod-<userId> so users sharing a device do
// not see each other's data.
//
// Tables:
//   records   (PK id, indexes [incidentId+entityId], serverSeq)
//   outbox    (PK id)
//   entities  (derived cache, PK entityId)
//   meta      (sync cursors per incident)
//   blobs     (attachment bytes awaiting upload, PK hash)
//   readNotifications (read notification ids per incident,
//                      PK key = `${incidentId}:${notificationId}`)
//
// Dexie is imported lazily (inside methods) rather than at module top level,
// because Dexie checks globalThis.indexedDB at module load time and jsdom/
// Vitest does not provide it until test setup runs.

import { type Table } from 'dexie';
import { materialize, type RecordEnvelope } from '@stabsstod/shared';

export interface LocalStoreOptions {
  userId: string;
}

export interface OutboxEntry {
  id: string;
  record: RecordEnvelope;
  status: 'pending' | 'rejected';
  reason?: string;
  createdAt: number;
}

export interface MaterializedEntity {
  entityId: string;
  current: RecordEnvelope | null;
  heads: RecordEnvelope[];
  conflict: boolean;
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface ReadNotificationRow {
  /** `${incidentId}:${notificationId}` — primary key. */
  key: string;
  incidentId: string;
  notificationId: string;
}

interface StabsStodDB {
  records: Table<RecordEnvelope, string>;
  outbox: Table<OutboxEntry, string>;
  entities: Table<MaterializedEntity & { entityId: string }, string>;
  meta: Table<{ incidentId: string; serverSeq: number }, string>;
  blobs: Table<{ hash: string; data: ArrayBuffer; size: number }, string>;
  readNotifications: Table<ReadNotificationRow, string>;
  close(): Promise<void>;
  delete(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DexieClass: any = null;
let dexieLoading: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDexie(): Promise<any> {
  const testOverride = (globalThis as { __TEST_DEXIE__?: unknown }).__TEST_DEXIE__;
  if (testOverride) return testOverride;
  if (DexieClass) return DexieClass;
  if (!dexieLoading) {
    dexieLoading = (async () => {
      const mod = await import('dexie');
      DexieClass = mod.Dexie;
    })();
  }
  await dexieLoading;
  return DexieClass;
}

export class LocalStore {
  private db: StabsStodDB | null = null;
  private readonly userId: string;

  constructor(opts: LocalStoreOptions) {
    this.userId = opts.userId;
  }

  private async ensureDb(): Promise<StabsStodDB> {
    if (!this.db) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Dexie = (await loadDexie()) as any;
      const opts: Record<string, unknown> = {};
      const idb = (globalThis as { indexedDB?: unknown }).indexedDB;
      if (idb) opts.indexedDB = idb;
      const dexie = new Dexie(`stabsstod-${this.userId}`, opts);
      dexie.version(1).stores({
        records: '++id, incidentId, entityId, serverSeq',
        outbox: '++id',
        entities: 'entityId',
        meta: 'incidentId',
        blobs: 'hash',
      });
      // v2: read/unread notification state (client-only, M34).
      dexie.version(2).stores({
        readNotifications: 'key, incidentId',
      });
      this.db = {
        records: dexie.records,
        outbox: dexie.outbox,
        entities: dexie.entities,
        meta: dexie.meta,
        blobs: dexie.blobs,
        readNotifications: dexie.readNotifications,
        close: () => dexie.close(),
        delete: () => dexie.delete(),
      } as unknown as StabsStodDB;
    }
    return this.db;
  }

  // ---------------------------------------------------------------------------
  // Records (local + outbox)
  // ---------------------------------------------------------------------------

  async addLocalRecord(record: RecordEnvelope): Promise<void> {
    const db = await this.ensureDb();
    await db.records.put(record);
    await db.outbox.put({
      id: record.id,
      record,
      status: 'pending',
      reason: undefined,
      createdAt: Date.now(),
    });
    await this.ingestRemoteRecords([record]);
  }

  async ingestRemoteRecords(records: RecordEnvelope[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const db = await this.ensureDb();
    await db.records.bulkPut(records);

    const entityIds = Array.from(new Set(records.map((r) => r.entityId)));
    const allRecords = await db.records
      .where('entityId')
      .anyOf(entityIds)
      .toArray();

    const byEntity = new Map<string, RecordEnvelope[]>();
    for (const record of allRecords) {
      const list = byEntity.get(record.entityId) ?? [];
      list.push(record);
      byEntity.set(record.entityId, list);
    }

    const entitiesToUpsert = Array.from(byEntity.entries()).map(
      ([entityId, entityRecords]) => {
        const materialized = materialize(entityRecords).get(entityId);
        return {
          entityId,
          current: materialized?.current ?? null,
          heads: materialized?.heads ?? [],
          conflict: materialized?.conflict ?? false,
          history: materialized?.history ?? [],
          retracted: materialized?.retracted ?? false,
        };
      },
    );

    await db.entities.bulkPut(entitiesToUpsert);
  }

  async getEntity(entityId: string): Promise<MaterializedEntity | undefined> {
    const db = await this.ensureDb();
    return db.entities.get(entityId);
  }

  async getRecordsByIncident(incidentId: string): Promise<RecordEnvelope[]> {
    const db = await this.ensureDb();
    return db.records.where('incidentId').equals(incidentId).toArray();
  }

  async getRecordsByEntity(entityId: string): Promise<RecordEnvelope[]> {
    const db = await this.ensureDb();
    return db.records.where('entityId').equals(entityId).toArray();
  }

  // ---------------------------------------------------------------------------
  // Outbox
  // ---------------------------------------------------------------------------

  async getOutbox(): Promise<OutboxEntry[]> {
    const db = await this.ensureDb();
    return db.outbox.toArray();
  }

  async markOutboxSent(recordId: string): Promise<void> {
    const db = await this.ensureDb();
    await db.outbox.delete(recordId);
  }

  async markOutboxRejected(recordId: string, reason: string): Promise<void> {
    const db = await this.ensureDb();
    await db.outbox.update(recordId, { status: 'rejected', reason });
  }

  async getPendingOutbox(): Promise<OutboxEntry[]> {
    const db = await this.ensureDb();
    return db.outbox.where('status').equals('pending').toArray();
  }

  // ---------------------------------------------------------------------------
  // Meta (sync cursors)
  // ---------------------------------------------------------------------------

  async getCursor(incidentId: string): Promise<number | undefined> {
    const db = await this.ensureDb();
    const row = await db.meta.where('incidentId').equals(incidentId).first();
    return row?.serverSeq;
  }

  async setCursor(incidentId: string, serverSeq: number): Promise<void> {
    const db = await this.ensureDb();
    await db.meta.put({ incidentId, serverSeq });
  }

  // ---------------------------------------------------------------------------
  // Blobs
  // ---------------------------------------------------------------------------

  async addBlob(hash: string, data: ArrayBuffer): Promise<void> {
    const db = await this.ensureDb();
    await db.blobs.put({ hash, data, size: data.byteLength });
  }

  async getBlob(hash: string): Promise<ArrayBuffer | undefined> {
    const db = await this.ensureDb();
    const row = await db.blobs.where('hash').equals(hash).first();
    return row?.data;
  }

  async removeBlob(hash: string): Promise<void> {
    const db = await this.ensureDb();
    await db.blobs.delete(hash);
  }

  // ---------------------------------------------------------------------------
  // Read notifications (client-only read/unread state, M34)
  // ---------------------------------------------------------------------------

  /** Notification ids already marked read for the incident. */
  async getReadNotificationIds(incidentId: string): Promise<string[]> {
    const db = await this.ensureDb();
    const rows = await db.readNotifications.where('incidentId').equals(incidentId).toArray();
    return rows.map((r) => r.notificationId);
  }

  async markNotificationRead(incidentId: string, notificationId: string): Promise<void> {
    const db = await this.ensureDb();
    await db.readNotifications.put({
      key: `${incidentId}:${notificationId}`,
      incidentId,
      notificationId,
    });
  }

  async markAllNotificationsRead(incidentId: string, notificationIds: string[]): Promise<void> {
    const db = await this.ensureDb();
    await db.readNotifications.bulkPut(
      notificationIds.map((notificationId) => ({
        key: `${incidentId}:${notificationId}`,
        incidentId,
        notificationId,
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async delete(): Promise<void> {
    if (this.db) {
      await this.db.delete();
      this.db = null;
    }
  }

  // ---------------------------------------------------------------------------
  // React live query hook
  // ---------------------------------------------------------------------------

  useEntity(entityId: string | null) {
    void entityId;
    return undefined;
  }

  useRecordsByIncident(incidentId: string | null) {
    void incidentId;
    return [];
  }
}
