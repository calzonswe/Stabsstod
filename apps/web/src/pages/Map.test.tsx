// Map tests — M29
//
//   - PMTiles file missing → friendly card, no map constructed
//   - retry → re-check, map constructed once the file exists
//   - file present → MapLibre map constructed with local PMTiles source
//   - online tile URL configured → toggle layer shown/hidden

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';

const captured = vi.hoisted(() => ({
  maps: [] as unknown[],
  addProtocol: vi.fn(),
}));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    container: unknown;
    opts: Record<string, unknown>;
    listeners: Record<string, Array<() => void>> = {};
    addedSources: string[] = [];
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

    addSource(id: string): void {
      this.addedSources.push(id);
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

import Map from './Map.tsx';

type FetchMode = 'missing' | 'present';

interface FakeMapRecord {
  container: unknown;
  opts: Record<string, unknown>;
  addedSources: string[];
  addedLayers: string[];
  layoutCalls: Array<[string, string, string]>;
}

interface FakeStyle {
  glyphs: unknown;
  sprite: unknown;
  sources: { basemap: { type: unknown; url: unknown } };
  layers: unknown[];
}

const SETTINGS: { timezone: string; map: { onlineTileUrl: string | null }; maxUploadMB: number } = {
  timezone: 'Europe/Stockholm',
  map: { onlineTileUrl: null },
  maxUploadMB: 25,
};

function stubFetch(mode: FetchMode, onlineTileUrl: string | null = null) {
  const settings = { ...SETTINGS, map: { onlineTileUrl } };
  const fetchMock = vi.fn(async (input: RequestInfo | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url === '/tiles/sweden.pmtiles') {
      if (mode === 'missing') {
        return new Response(null, { status: 404 });
      }
      // PMTiles magic bytes "PM"
      return new Response(new Uint8Array([0x50, 0x4d]), { status: 206 });
    }
    if (url === '/api/settings') {
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    throw new Error(`unexpected fetch in Map test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderMap() {
  return render(
    <I18nextProvider i18n={i18n}>
      <Map />
    </I18nextProvider>,
  );
}

describe('Map (M29)', () => {
  beforeEach(() => {
    captured.maps.length = 0;
    captured.addProtocol.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a friendly card when the PMTiles file is missing on the server', async () => {
    stubFetch('missing');
    const { container } = renderMap();
    expect(await screen.findByText('Kartfil saknas')).toBeTruthy();
    expect(screen.getByText(/data\/maps\/sweden\.pmtiles/)).toBeTruthy();
    expect(captured.maps).toHaveLength(0);
    expect(container.querySelector('[data-testid="map-missing"]')).toBeTruthy();
  });

  it('re-checks when retry is clicked and renders the map once the file exists', async () => {
    let mode: FetchMode = 'missing';
    const fetchMock = vi.fn(async (input: RequestInfo | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url === '/tiles/sweden.pmtiles') {
        if (mode === 'present') {
          return new Response(new Uint8Array([0x50, 0x4d]), { status: 206 });
        }
        return new Response(null, { status: 404 });
      }
      if (url === '/api/settings') {
        return new Response(JSON.stringify(SETTINGS), { status: 200 });
      }
      throw new Error(`unexpected fetch in Map test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMap();
    expect(await screen.findByText('Kartfil saknas')).toBeTruthy();
    mode = 'present';
    fireEvent.click(screen.getByText('Försök igen'));
    await waitFor(() => expect(captured.maps).toHaveLength(1));
  });

  it('renders the local PMTiles basemap when the file is present', async () => {
    stubFetch('present');
    const { container } = renderMap();
    await waitFor(() => expect(captured.maps).toHaveLength(1));

    // The pmtiles:// scheme is registered with MapLibre.
    expect(captured.addProtocol).toHaveBeenCalledTimes(1);
    expect(captured.addProtocol.mock.calls[0][0]).toBe('pmtiles');

    const map = captured.maps[0] as FakeMapRecord;
    expect(map.opts.center).toEqual([16.0, 63.0]);
    expect(map.opts.zoom).toBe(6);
    expect(map.opts.minZoom).toBe(4);
    expect(map.opts.maxZoom).toBe(14);

    const style = map.opts.style as FakeStyle;
    expect(style.glyphs).toBe('http://localhost:3000/map-assets/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('http://localhost:3000/map-assets/sprites/light');
    expect(style.sources.basemap.type).toBe('vector');
    expect(style.sources.basemap.url).toBe('pmtiles:///tiles/sweden.pmtiles');
    expect(style.layers.length).toBeGreaterThan(0);

    // The container reports the map's load event.
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="map-container"]')?.getAttribute('data-loaded'),
      ).toBe('true'),
    );
    // No online layer configured → no toggle button.
    expect(container.querySelector('button')).toBeNull();
  });

  it('toggles the configured online layer', async () => {
    stubFetch('present', 'https://example.org/tiles/{z}/{x}/{y}.png');
    const { container } = renderMap();
    await waitFor(() => expect(captured.maps).toHaveLength(1));
    const map = captured.maps[0] as FakeMapRecord;

    const button = await screen.findByText('Lager: karta online');
    expect(map.addedSources).toContain('online-tiles');
    expect(map.addedLayers).toContain('online-tiles-layer');

    fireEvent.click(button);
    expect(map.layoutCalls).toContainEqual(['online-tiles-layer', 'visibility', 'visible']);
    fireEvent.click(button);
    expect(map.layoutCalls).toContainEqual(['online-tiles-layer', 'visibility', 'none']);
    // Button stays (toggle) and container still present.
    expect(container.querySelector('[data-testid="map-container"]')).toBeTruthy();
  });
});
