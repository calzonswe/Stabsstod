import { describe, expect, it, vi } from 'vitest';
import { EntityType, newRecord, type RecordEnvelope } from './record.js';
import { hlcInitialState, hlcTick, hlcReceive, hlcCompare } from './hlc.js';
import { materialize, materializeOne } from './materialize.js';

const INCIDENT = 'incident-1';
const DEVICE_A = 'device-aaaaa';
const DEVICE_B = 'device-bbbbb';
const SCHEMA_VERSION = 1;

function makeState(): ReturnType<typeof hlcInitialState> {
  return hlcInitialState();
}

function putRecord(
  state: ReturnType<typeof hlcInitialState>,
  overrides: Partial<RecordEnvelope> = {},
): { record: RecordEnvelope; state: ReturnType<typeof hlcInitialState> } {
  return newRecord({
    entityId: 'entity-1',
    entityType: EntityType.logEntry,
    incidentId: INCIDENT,
    parentIds: overrides.parentIds ?? [],
    functionId: 'fn-1',
    authorId: 'author-1',
    deviceId: DEVICE_A,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      text: (overrides.payload as { text?: string } | undefined)?.text ?? 'default',
      category: 'info',
      eventTime: new Date().toISOString(),
      visibility: 'incident',
    },
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    state,
  });
}

function retractRecord(
  state: ReturnType<typeof hlcInitialState>,
  parentId: string,
): { record: RecordEnvelope; state: ReturnType<typeof hlcInitialState> } {
  return newRecord({
    entityId: 'entity-1',
    entityType: EntityType.logEntry,
    incidentId: INCIDENT,
    parentIds: [parentId],
    functionId: 'fn-1',
    authorId: 'author-1',
    deviceId: DEVICE_A,
    schemaVersion: SCHEMA_VERSION,
    payload: { reason: 'mistake' },
    createdAtClient: new Date().toISOString(),
    kind: 'retract',
    state,
  });
}

describe('materialize — plan.md §5.2', () => {
  it('linear history: single head, no conflict', () => {
    const state = makeState();
    const r1 = putRecord(state, { parentIds: [] });
    const r2 = putRecord(r1.state, { parentIds: [r1.record.id] });
    const r3 = putRecord(r2.state, { parentIds: [r2.record.id] });

    const m = materializeOne([r3.record, r2.record, r1.record], 'entity-1');
    expect(m).toBeDefined();
    expect(m!.heads.length).toBe(1);
    expect(m!.conflict).toBe(false);
    expect(m!.current!.id).toBe(r3.record.id);
    expect(m!.retracted).toBe(false);
    expect(m!.history.map((r) => r.id)).toEqual([r1.record.id, r2.record.id, r3.record.id]);
  });

  it('two concurrent heads → conflict', () => {
    const state = makeState();
    const r1 = putRecord(state, { parentIds: [] });
    const r2 = putRecord(r1.state, { parentIds: [] }); // same parent (none) → concurrent head

    const m = materialize([r1.record, r2.record]).get('entity-1');
    expect(m!.heads.length).toBe(2);
    expect(m!.conflict).toBe(true);
    expect(m!.current!.id).toBeDefined();
  });

  it('merge record resolves conflict', () => {
    const state = makeState();
    const r1 = putRecord(state, { parentIds: [] });
    const r2 = putRecord(r1.state, { parentIds: [] });
    const r3 = putRecord(r2.state, { parentIds: [r1.record.id, r2.record.id] }); // merge

    const m = materialize([r1.record, r2.record, r3.record]).get('entity-1');
    expect(m!.heads.length).toBe(1);
    expect(m!.conflict).toBe(false);
    expect(m!.current!.id).toBe(r3.record.id);
  });

  it('retract: current is retracted', () => {
    const state = makeState();
    const r1 = putRecord(state, { parentIds: [] });
    const r2 = retractRecord(r1.state, r1.record.id);

    const m = materialize([r1.record, r2.record]).get('entity-1');
    expect(m!.retracted).toBe(true);
    expect(m!.current!.kind).toBe('retract');
    expect(m!.heads.length).toBe(1);
  });

  it('history view ordered by hlc', () => {
    const state = makeState();
    const r1 = putRecord(state, { parentIds: [] });
    const r2 = putRecord(r1.state, { parentIds: [r1.record.id] });

    const m = materializeOne([r2.record, r1.record], 'entity-1');
    expect(m!.history.map((r) => r.id)).toEqual([r1.record.id, r2.record.id]);
  });
});

describe('HLC — plan.md §5.2', () => {
  it('tick is monotonic even when wall clock goes backwards', () => {
    const now = vi.spyOn(Date, 'now');

    // First tick at wall T1
    now.mockReturnValue(100000);
    const state = hlcInitialState();
    state.wall = 99999; // ensure first tick advances wall to T1
    const t1 = hlcTick(state, DEVICE_A);
    expect(t1.state.wall).toBe(100000);
    expect(t1.state.counter).toBe(0);

    // Wrong clock: device wall set 10 seconds in the past
    now.mockReturnValue(90000);
    const t2 = hlcTick(state, DEVICE_A);
    // wall stays at 100000 (max), counter increments
    expect(t2.state.wall).toBe(100000);
    expect(t2.state.counter).toBe(1);
    expect(hlcCompare(t1.hlc, t2.hlc)).toBeLessThan(0); // t2 > t1

    // Another tick with same wrong wall → counter increments again
    const t3 = hlcTick(state, DEVICE_A);
    expect(t3.state.counter).toBe(2);
    expect(hlcCompare(t2.hlc, t3.hlc)).toBeLessThan(0);

    now.mockRestore();
  });

  it('receive advances clock past remote', () => {
    const stateA = hlcInitialState();
    const stateB = hlcInitialState();

    const ta = hlcTick(stateA, DEVICE_A);

    // B receives A's hlc → B's clock must be >= A's
    const tbAfter = hlcReceive(stateB, ta.hlc, DEVICE_B);
    expect(hlcCompare(ta.hlc, tbAfter.hlc)).toBeLessThanOrEqual(0);
  });

  it('compare orders by wall then counter then deviceId', () => {
    expect(hlcCompare('000000000000001-00001-a', '000000000000002-00001-a')).toBeLessThan(0);
    expect(hlcCompare('000000000000001-00001-a', '000000000000002-00001-a')).toBeLessThan(0);
    expect(hlcCompare('000000000000001-00002-a', '000000000000001-00001-a')).toBeGreaterThan(0);
    expect(hlcCompare('000000000000001-00001-a', '000000000000001-00001-b')).toBeLessThan(0);
  });
});

describe('out-of-order arrival — plan.md §5.2 property test', () => {
  it('shuffled input gives the same materialize result as in-order', () => {
    const state = makeState();
    const r1 = putRecord(state, { parentIds: [] });
    const r2 = putRecord(r1.state, { parentIds: [r1.record.id] });
    const r3 = putRecord(r2.state, { parentIds: [r2.record.id] });
    const r4 = putRecord(r3.state, { parentIds: [r3.record.id] });

    const inOrder = materialize([r1.record, r2.record, r3.record, r4.record]).get('entity-1')!;

    // Shuffle: reverse order
    const shuffled = materialize([r4.record, r3.record, r2.record, r1.record]).get('entity-1')!;

    expect(shuffled.current!.id).toBe(inOrder.current!.id);
    expect(shuffled.conflict).toBe(inOrder.conflict);
    expect(shuffled.heads.length).toBe(inOrder.heads.length);
    expect(shuffled.history.map((r) => r.id)).toEqual(inOrder.history.map((r) => r.id));
    expect(shuffled.retracted).toBe(inOrder.retracted);
  });

  it('random shuffles converge to the same result', () => {
    const state = makeState();
    const records: RecordEnvelope[] = [];
    let s = state;
    for (let i = 0; i < 8; i++) {
      const nr = putRecord(s, { parentIds: i === 0 ? [] : [records[i - 1].id] });
      records.push(nr.record);
      s = nr.state;
    }

    const base = materialize([...records]).get('entity-1')!;

    // Try several random shuffles
    for (let trial = 0; trial < 20; trial++) {
      const shuffled = [...records].sort(() => Math.random() - 0.5);
      const m = materialize(shuffled).get('entity-1')!;
      expect(m.current!.id).toBe(base.current!.id);
      expect(m.conflict).toBe(base.conflict);
      expect(m.heads.length).toBe(base.heads.length);
      expect(m.history.map((r) => r.id)).toEqual(base.history.map((r) => r.id));
    }
  });
});
