// Wall tests — plan.md §10 / M37.
//
// Renders the wall display from seeded local records and verifies:
//   - the mission/direction section is shown first, with no write controls
//   - rotation through situation, timeline, tasks and the read-only map
//   - access denied for a non-member (no actor)
//   - empty-state placeholders for an incident without records

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';

const captured = vi.hoisted(() => ({
  maps: [] as Array<{
    sources: Map<string, { data: unknown; setData: (d: unknown) => void }>;
    addedLayers: string[];
  }>,
  addProtocol: vi.fn(),
}));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    container: unknown;
    opts: Record<string, unknown>;
    listeners: Record<string, Array<() => void>> = {};
    sources: Map<string, { data: unknown; setData: (d: unknown) => void }> = new Map();
    addedLayers: string[] = [];
    layoutCalls: Array<[string, string, string]> = [];

    // MapLibre v3 Map takes a single MapOptions object (container included).
    constructor(opts: Record<string, unknown> & { container: unknown }) {
      this.container = opts.container;
      this.opts = opts;
      captured.maps.push(this);
      // MapLibre fires 'load' asynchronously after construction.
      queueMicrotask(() => this.emit('load'));
    }

    on(event: string, handler: () => void): void {
      (this.listeners[event] ??= []).push(handler);
    }

    emit(event: string): void {
      for (const handler of this.listeners[event] ?? []) handler();
    }

    addSource(id: string, spec?: { data?: unknown }): void {
      const source: { data: unknown; setData: (d: unknown) => void } = {
        data: spec?.data,
        setData: (d: unknown) => {
          source.data = d;
        },
      };
      this.sources.set(id, source);
    }

    getSource(id: string): { data: unknown; setData: (d: unknown) => void } | undefined {
      return this.sources.get(id);
    }

    addLayer(layer: { id?: string }): void {
      this.addedLayers.push(layer.id ?? '');
    }

    setLayoutProperty(id: string, name: string, value: string): void {
      this.layoutCalls.push([id, name, value]);
    }

    remove(): void {
      // no-op in tests
    }
  }

  return { default: { Map: FakeMap, addProtocol: captured.addProtocol } };
});

import { Wall } from './Wall.tsx';
import { LocalStore } from '../localStore.js';
import {
  newRecord,
  EntityType,
  type Actor,
  type RecordEnvelope,
} from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-wall';
const NOW = new Date('2026-11-14T12:00:00Z').toISOString();

const ACTOR: Actor = {
  userId: 'user-wall',
  incidentId: INCIDENT,
  role: 'observer',
  functionIds: [],
};

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: EntityType,
  payload: unknown,
): Promise<RecordEnvelope> {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId: null,
    authorId: 'user-wall',
    deviceId: getDeviceId(),
    schemaVersion: 1,
    payload,
    createdAtClient: NOW,
    kind: 'put',
    state,
  });
  saveHlcState(next, getDeviceId());
  await store.ingestRemoteRecords([record]);
  return record;
}

function renderWall(
  store: LocalStore | null,
  opts: {
    actor?: Actor | null;
    assigneeNames?: Record<string, string>;
    rotateEverySeconds?: number;
  } = {},
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Wall
        store={store}
        incidentId={INCIDENT}
        incidentName="Testinsats"
        actor={opts.actor === undefined ? ACTOR : opts.actor}
        assigneeNames={opts.assigneeNames ?? {}}
        rotateEverySeconds={opts.rotateEverySeconds ?? 0}
      />
    </I18nextProvider>,
  );
}

function stubFetch(): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url === '/tiles/sweden.pmtiles') {
      // PMTiles magic bytes "PM"
      return new Response(new Uint8Array([0x50, 0x4d]), { status: 206 });
    }
    if (url === '/api/settings') {
      return new Response(
        JSON.stringify({
          timezone: 'Europe/Stockholm',
          map: { onlineTileUrl: null },
          maxUploadMB: 25,
          wallRotateEverySeconds: 30,
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in Wall test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('Wall (M37)', () => {
  beforeEach(() => {
    captured.maps.length = 0;
    captured.addProtocol.mockClear();
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the mission/direction section first with no write controls', async () => {
    const store = makeStore('user-wall-1');
    await seed(store, 'mission-1', EntityType.mission, {
      content: 'Skydda befintlig bebyggelse',
      staffShouldDo: 'Etablera avspärrningar',
      staffShouldNotDo: 'Gå in i farozonen',
      deadline: '2026-11-15T08:00:00Z',
      issuedBy: 'user-chief',
    });
    await seed(store, 'direction-1', EntityType.direction, {
      desired: 'Säkerställningsområdet stabilt',
      actual: 'Läget är i utveckling',
      divergenceNote: 'Efterlämning i östra sektorn',
      validFrom: '2026-11-15T06:00:00Z',
    });
    const { container } = renderWall(store);

    await waitFor(() =>
      expect(screen.getByText('Skydda befintlig bebyggelse')).toBeInTheDocument(),
    );
    expect(screen.getByText('Etablera avspärrningar')).toBeInTheDocument();
    expect(screen.getByText('Säkerställningsområdet stabilt')).toBeInTheDocument();

    // The wall display is read-only: no write controls anywhere.
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('rotates through situation, timeline, tasks and map', async () => {
    const store = makeStore('user-wall-2');
    await seed(store, 'mission-1', EntityType.mission, {
      content: 'Skydda befintlig bebyggelse',
      issuedBy: 'user-chief',
    });
    await seed(store, 'situation-1', EntityType.situationSnapshot, {
      whatHappened: 'Brand i industriområde',
      current: 'Branden är under kontroll',
      protectedValues: ['life', 'environment'],
    });
    await seed(store, 'timeline-1', EntityType.timelineEvent, {
      title: 'Avspärrning beslutad',
      time: '2026-11-15T07:30:00Z',
      type: 'decision',
      scope: 'internal',
    });
    await seed(store, 'task-1', EntityType.task, {
      title: 'Etablera avspärrning öster om platsen',
      description: '',
      assigneeFunctionId: 'fn-1',
      assigneeUserId: 'user-anna',
      priority: 'high',
      status: 'todo',
      reportForm: 'oral',
      due: '2026-11-15T10:00:00Z',
    });
    await seed(store, 'map-1', EntityType.mapFeature, {
      label: 'Brandplats',
      layer: 'situation',
      geometry: { type: 'Point', coordinates: [16.0, 63.0] },
      severity: 'severe',
      validity: 'now',
    });
    const { container } = renderWall(store, {
      assigneeNames: { 'user-anna': 'Anna Andersson' },
      rotateEverySeconds: 0.5,
    });

    // Section 1: mission/direction (shown first).
    await waitFor(() =>
      expect(screen.getByText('Skydda befintlig bebyggelse')).toBeInTheDocument(),
    );
    // Section 2: situation picture.
    await waitFor(() => expect(screen.getByText('Brand i industriområde')).toBeInTheDocument());
    // Section 3: timeline, with the shared timeline type label.
    await waitFor(() => expect(screen.getByText('Avspärrning beslutad')).toBeInTheDocument());
    expect(screen.getByText('Beslut')).toBeInTheDocument();
    // Section 4: task board, assignee shown by display name.
    await waitFor(() =>
      expect(screen.getByText('Etablera avspärrning öster om platsen')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Anna Andersson/)).toBeInTheDocument();
    // Section 5: map, rendered read-only from the local features.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="map-container"]')).toBeTruthy(),
    );
    await waitFor(() => {
      expect(captured.maps[0]?.sources.has('stabsstod-wall-features')).toBe(true);
    });
    const source = captured.maps[0].sources.get('stabsstod-wall-features')!;
    const data = source.data as {
      type: string;
      features: Array<{ properties: { label: string; severity: string } }>;
    };
    expect(data.type).toBe('FeatureCollection');
    expect(data.features[0].properties.label).toBe('Brandplats');
    expect(data.features[0].properties.severity).toBe('severe');
    expect(captured.maps[0].addedLayers).toContain('stabsstod-wall-features-point');

    // The wall map is read-only: no search box, no layer toggle, no drawing.
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('shows access denied when the user is not a member', () => {
    const store = makeStore('user-wall-3');
    renderWall(store, { actor: null });
    expect(screen.getByText('Åtkomst nekad')).toBeInTheDocument();
  });

  it('shows the empty state when the store has no records', async () => {
    const store = makeStore('user-wall-4');
    renderWall(store);
    await waitFor(() =>
      expect(
        screen.getByText('Ingen uppdrag eller inriktning har angetts.'),
      ).toBeInTheDocument(),
    );
  });
});
