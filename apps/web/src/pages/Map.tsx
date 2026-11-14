// Map — plan.md §5.7 / M29 + M30
//
// Basemap rendered entirely from locally served data:
//   - vector tiles: /tiles/sweden.pmtiles via the pmtiles:// protocol
//     (the API serves the file with HTTP range support)
//   - glyphs: /map-assets/fonts/{fontstack}/{range}.pbf
//   - sprite: /map-assets/sprites/light
// No external network is required for the basemap.
//
// If the PMTiles file is not on the server (e.g. not fetched yet), a
// friendly card with a retry button is shown instead of a broken map.
//
// M30: when store/incidentId/authorId are provided, terra-draw drawing is
// enabled on top of the basemap (point, line, polygon, circle, edit, select).
// Drawn features are saved as versioned `map_feature` records.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MapLibreGLDefault from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// The CJS bundle of maplibre-gl exports the `maplibregl` namespace object as
// the module (at runtime it has .Map, .addProtocol, ...), but under NodeNext
// the default import of a CJS package is typed as the module namespace. Cast
// to the declared class value type, which has the same statics.
const MapLibreGL = MapLibreGLDefault as unknown as typeof import('maplibre-gl').MapLibreGL;
import { Protocol } from 'pmtiles';
import { layers, namedTheme } from 'protomaps-themes-base';
import MapDraw from '../components/MapDraw.js';
import GeoSearch from '../components/GeoSearch.js';
import type { LocalStore } from '../localStore.js';

const PMTILES_PATH = '/tiles/sweden.pmtiles';
const PMTILES_SOURCE_URL = `pmtiles://${PMTILES_PATH}`;
// MapLibre's normalizeSpriteURL requires an absolute URL with a protocol
// (/^(\w+):\/\/.../), so build sprite/glyph bases from window.location.origin.
// Same-origin only, still fully offline-safe; jsdom origin is 'http://localhost:3000'.
const GLYPHS_URL = `${window.location.origin}/map-assets/fonts/{fontstack}/{range}.pbf`;
const SPRITE_URL = `${window.location.origin}/map-assets/sprites/light`;
const ATTRIBUTION = '© OpenStreetMap contributors · © Protomaps';
const CENTER: [number, number] = [16.0, 63.0];
const INITIAL_ZOOM = 6;
const MIN_ZOOM = 4;
const MAX_ZOOM = 14;

type MapInstance = InstanceType<typeof MapLibreGL.Map>;

// The pmtiles:// protocol is a MapLibre global. addProtocol() only overwrites
// the entry for the scheme, so it is safe to register on every map build.
function ensurePmtilesProtocol(): void {
  MapLibreGL.addProtocol('pmtiles', new Protocol().tile);
}

// A PMTiles archive starts with the magic bytes "PM" (0x50 0x4d). Reading
// just the first two bytes — never the whole multi-gigabyte file — is
// enough to tell a real archive apart from a 404 or an HTML fallback page.
async function isPmtilesResponse(res: Response): Promise<boolean> {
  if (!res.body) return false;
  const reader = res.body.getReader();
  const head: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const byte of value) {
      head.push(byte);
      if (head.length === 2) return head[0] === 0x50 && head[1] === 0x4d;
    }
  }
  return false;
}

async function pmtilesAvailable(): Promise<boolean> {
  try {
    const res = await fetch(PMTILES_PATH, { headers: { range: 'bytes=0-1' } });
    if (!res.ok) return false;
    return await isPmtilesResponse(res);
  } catch {
    return false;
  }
}

async function fetchOnlineTileUrl(): Promise<string | null> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return null;
    const data = (await res.json()) as { map?: { onlineTileUrl?: string | null } };
    return data.map?.onlineTileUrl ?? null;
  } catch {
    return null;
  }
}

interface MapProps {
  store?: LocalStore | null;
  incidentId?: string;
  authorId?: string;
  functionId?: string | null;
}

export default function Map({
  store,
  incidentId,
  authorId,
  functionId,
}: MapProps = {}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [onlineTileUrl, setOnlineTileUrl] = useState<string | null>(null);
  const [onlineVisible, setOnlineVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    setStatus('loading');
    setMapLoaded(false);
    setOnlineVisible(false);

    (async () => {
      const [available, onlineUrl] = await Promise.all([
        pmtilesAvailable(),
        fetchOnlineTileUrl(),
      ]);
      if (disposed) return;
      if (!available) {
        setStatus('missing');
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      setOnlineTileUrl(onlineUrl);
      ensurePmtilesProtocol();
      const map = new MapLibreGL.Map({
        container,
        center: CENTER,
        zoom: INITIAL_ZOOM,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        style: {
          version: 8,
          glyphs: GLYPHS_URL,
          sprite: SPRITE_URL,
          sources: {
            basemap: {
              type: 'vector',
              url: PMTILES_SOURCE_URL,
              attribution: ATTRIBUTION,
            },
          },
          layers: layers('basemap', namedTheme('light'), { lang: 'sv' }),
        },
      });
      mapRef.current = map;
      map.on('load', () => {
        setMapLoaded(true);
        if (onlineUrl) {
          map.addSource('online-tiles', {
            type: 'raster',
            tiles: [onlineUrl],
            tileSize: 256,
          });
          map.addLayer({
            id: 'online-tiles-layer',
            type: 'raster',
            source: 'online-tiles',
            layout: { visibility: 'none' },
          });
        }
      });
      setStatus('ready');
    })();

    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [attempt]);

  function toggleOnlineLayer(): void {
    const map = mapRef.current;
    if (!map) return;
    const next = !onlineVisible;
    setOnlineVisible(next);
    map.setLayoutProperty('online-tiles-layer', 'visibility', next ? 'visible' : 'none');
  }

  const hasDrawingContext = Boolean(store && incidentId && authorId);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-testid="map-container"
        data-loaded={mapLoaded ? 'true' : 'false'}
        className="h-full w-full"
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-slate-500">
          {t('map.loading')}
        </div>
      )}
      {status === 'missing' && (
        <div
          data-testid="map-missing"
          className="absolute inset-0 flex items-center justify-center bg-white p-4"
        >
          <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-900">{t('map.missingTitle')}</h3>
            <p className="mt-1 text-sm text-amber-800">{t('map.missingBody')}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              {t('map.retry')}
            </button>
          </div>
        </div>
      )}
      {status === 'ready' && mapLoaded && hasDrawingContext && (
        <MapDraw
          map={mapRef.current}
          store={store!}
          incidentId={incidentId!}
          authorId={authorId!}
          functionId={functionId ?? null}
        />
      )}
      {status === 'ready' && mapLoaded && (
        <GeoSearch
          map={mapRef.current}
          store={store ?? null}
          incidentId={incidentId ?? ''}
          authorId={authorId ?? ''}
          functionId={functionId ?? null}
        />
      )}
      {status === 'ready' && mapLoaded && onlineTileUrl && (
        <button
          type="button"
          onClick={toggleOnlineLayer}
          aria-pressed={onlineVisible}
          className={`absolute top-3 right-3 z-10 rounded border px-3 py-1.5 text-sm shadow-sm ${
            onlineVisible
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-slate-300 bg-white text-slate-700'
          }`}
        >
          {t('map.onlineLayer')}
        </button>
      )}
    </div>
  );
}
