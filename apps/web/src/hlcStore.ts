// Device identity + persisted HLC state — plan.md §5.2
//
// The device id is generated once per browser and kept in localStorage so
// records created on the same device share a stable HLC tie-breaker.
// The HLC state (wall, counter) is persisted too, so after a reload the next
// tick never goes backwards in time.

import { hlcInitialState, hlcParse, type HLCState } from '@stabsstod/shared';

const DEVICE_KEY = 'stabsstod-deviceId';
const HLC_KEY = 'stabsstod-hlc';

function localStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // jsdom/private mode without storage access
  }
}

export function getDeviceId(): string {
  const ls = localStorage();
  if (!ls) return 'test-device';
  let id = ls.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev-${globalThis.crypto.randomUUID()}`;
    ls.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function loadHlcState(): HLCState {
  const ls = localStorage();
  if (!ls) return hlcInitialState();
  const raw = ls.getItem(HLC_KEY);
  if (!raw) return hlcInitialState();
  try {
    const parsed = hlcParse(raw);
    return { wall: parsed.wall, counter: parsed.counter };
  } catch {
    return hlcInitialState();
  }
}

export function saveHlcState(state: HLCState, deviceId: string): void {
  const ls = localStorage();
  if (!ls) return;
  // Store as an HLC string so it round-trips through hlcParse.
  const hlc = `${String(state.wall).padStart(15, '0')}-${String(state.counter).padStart(5, '0')}-${deviceId}`;
  ls.setItem(HLC_KEY, hlc);
}
