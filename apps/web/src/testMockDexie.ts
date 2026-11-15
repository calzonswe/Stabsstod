// Shared mock Dexie for tests — used via globalThis.__TEST_DEXIE__ override
// (same pattern as localStore.test.ts). Extracted so other test files can
// reuse the same in-memory implementation.
/* eslint-disable @typescript-eslint/no-explicit-any */

class MockTable {
  private data = new Map<string, any>();
  async put(keyOrRecord: any, value?: any) {
    if (value === undefined) {
      const key =
        keyOrRecord.key ??
        keyOrRecord.id ??
        keyOrRecord.entityId ??
        keyOrRecord.incidentId ??
        keyOrRecord.hash;
      this.data.set(key, keyOrRecord);
    } else {
      this.data.set(keyOrRecord, value);
    }
    return undefined;
  }
  async bulkPut(items: any[]) {
    items.forEach((i) => {
      const key = i.key ?? i.id ?? i.entityId ?? i.incidentId ?? i.hash;
      if (key !== undefined) this.data.set(key, i);
    });
    return undefined;
  }
  async get(key: any) {
    return this.data.get(key);
  }
  async delete(key: string) {
    this.data.delete(key);
    return undefined;
  }
  async toArray() {
    return Array.from(this.data.values());
  }
  async update(key: string, changes: any) {
    const existing = this.data.get(key);
    if (existing) this.data.set(key, { ...existing, ...changes });
  }
  where(field: string) {
    return new MockQuery(this.data, field);
  }
}

class MockQuery {
  constructor(
    private data: Map<string, any>,
    private field: string,
  ) {}
  anyOf(values: any[]) {
    return new MockQueryResults(this.data, this.field, values);
  }
  equals(value: any) {
    return new MockQueryResults(this.data, this.field, [value]);
  }
}

class MockQueryResults {
  constructor(
    private data: Map<string, any>,
    private field: string,
    private values: any[],
  ) {}
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

class MockDexie {
  records = new MockTable();
  outbox = new MockTable();
  entities = new MockTable();
  meta = new MockTable();
  blobs = new MockTable();
  readNotifications = new MockTable();
  version(): any {
    return this;
  }
  stores(): any {
    return this;
  }
  async close() {
    return undefined;
  }
  async delete() {
    return undefined;
  }
}

// Install the override before any module lazily loads Dexie.
(globalThis as any).__TEST_DEXIE__ = MockDexie;

export {};
