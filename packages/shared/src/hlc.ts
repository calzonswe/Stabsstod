// Hybrid Logical Clock (HLC) — plan.md §5.2
//
// Format: "<wallClockMs zero-padded to 15>-<counter zero-padded to 5>-<deviceId>"
// Wall clock may be wrong on a device; HLC prevents going backwards.
// Implements tick() and receive() per the standard Coulouris et al. algorithm.

export interface HLCState {
  wall: number; // last wall-clock ms observed
  counter: number; // logical counter within the same wall ms
}

export function hlcInitialState(): HLCState {
  return { wall: Date.now(), counter: 0 };
}

export function hlcFormat(state: HLCState, deviceId: string): string {
  return `${String(state.wall).padStart(15, '0')}-${String(state.counter).padStart(5, '0')}-${deviceId}`;
}

export function hlcParse(s: string): { wall: number; counter: number; deviceId: string } {
  const [wallStr, counterStr, ...rest] = s.split('-');
  return {
    wall: Number(wallStr),
    counter: Number(counterStr),
    deviceId: rest.join('-'), // deviceId may contain hyphens (UUIDs do)
  };
}

export function hlcCompare(a: string, b: string): number {
  const ha = hlcParse(a);
  const hb = hlcParse(b);
  if (ha.wall !== hb.wall) return ha.wall - hb.wall;
  if (ha.counter !== hb.counter) return ha.counter - hb.counter;
  return ha.deviceId.localeCompare(hb.deviceId);
}

/** Advance the local clock by one tick and return the new state + hlc string. */
export function hlcTick(state: HLCState, deviceId: string): { state: HLCState; hlc: string } {
  const now = Date.now();
  if (now > state.wall) {
    state.counter = 0;
    state.wall = now;
  } else {
    state.counter += 1;
  }
  return { state, hlc: hlcFormat(state, deviceId) };
}

/** Fold a remote HLC into the local clock and return the new state + hlc string. */
export function hlcReceive(
  state: HLCState,
  remoteHlc: string,
  deviceId: string,
): { state: HLCState; hlc: string } {
  const rh = hlcParse(remoteHlc);
  state.counter = Math.max(state.counter, rh.counter) + 1;
  state.wall = Math.max(state.wall, rh.wall);
  return { state, hlc: hlcFormat(state, deviceId) };
}
