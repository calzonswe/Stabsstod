// Geo search box — plan.md §5 / M31.
//
// Searches places and administrative areas via GET /api/geo/search?q= and
// lets the user zoom the map to a result. For admin areas with a GeoJSON
// boundary, offers "Mark as affected area" which creates a map_feature
// record (requires the drawing context: store + incident + author).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MapInstance } from '../map/MapLibreAdapter.js';
import type { LocalStore } from '../localStore.js';
import type { MapFeaturePayload } from '@stabsstod/shared';

interface GeoResult {
  id: string;
  type: 'place' | 'area';
  name: string;
  kind: string;
  lat?: number | null;
  lon?: number | null;
  kommun?: string | null;
  lan?: string | null;
  bbox?: string | null;
  geojson?: unknown | null;
}

interface GeoSearchProps {
  map: MapInstance | null;
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  functionId: string | null;
}

function parseBbox(bbox: string | null): [[number, number], [number, number]] | null {
  if (!bbox) return null;
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  // bbox = "minLon,minLat,maxLon,maxLat" → MapLibre [[swLon, swLat], [neLon, neLat]]
  return [
    [parts[0], parts[1]] as [number, number],
    [parts[2], parts[3]] as [number, number],
  ];
}

export default function GeoSearch(props: GeoSearchProps) {
  const { t } = useTranslation();
  const { map, store, incidentId, authorId, functionId } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GeoResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSelected(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = (await res.json()) as { results: GeoResult[] };
      setResults(data.results);
      setSelected(null);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const zoomTo = useCallback((result: GeoResult) => {
    if (!map) return;
    if (result.bbox) {
      const bounds = parseBbox(result.bbox);
      if (bounds) {
        map.fitBounds(bounds, { padding: 40 });
        return;
      }
    }
    if (result.lat != null && result.lon != null) {
      map.easeTo({ center: [result.lon, result.lat], zoom: 10 });
    }
  }, [map]);

  const markAsAffected = useCallback(async (result: GeoResult) => {
    if (!store || !result.geojson) return;
    try {
      const geojson = result.geojson as
        | { type: string; coordinates: unknown }
        | undefined;
      const draft: MapFeaturePayload = {
        label: `Berört område: ${result.name}`,
        layer: 'situation',
        geometry: {
          type: geojson?.type === 'MultiPolygon' ? 'MultiPolygon' : 'Polygon',
          coordinates: geojson?.coordinates,
        },
        severity: 'warning',
        validity: 'now',
        description: `Avgränsat område: ${result.name} (${result.kind})`,
      };
      await fetch('/api/sync/push', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId,
          records: [
            {
              id: crypto.randomUUID(),
              entityId: crypto.randomUUID(),
              entityType: 'map_feature',
              incidentId,
              parentIds: [],
              functionId,
              authorId,
              deviceId: crypto.randomUUID(),
              hlc: '000000000000001-00001-browser',
              createdAtClient: new Date().toISOString(),
              kind: 'put',
              schemaVersion: 1,
              payload: draft,
            },
          ],
        }),
      });
      setSelected(null);
      setResults([]);
      setQuery('');
    } catch {
      // Sync failure is surfaced elsewhere; just close the dropdown.
    }
  }, [store, incidentId, authorId, functionId]);

  if (!map) return null;

  return (
    <div className="absolute top-3 left-3 z-30 w-80">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder={t('geo.searchPlaceholder', { defaultValue: 'Sök plats eller område' })}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
        />
        {loading && (
          <span className="absolute right-3 top-2.5 text-xs text-slate-400">
            {t('geo.searching', { defaultValue: 'Söker…' })}
          </span>
        )}
      </div>
      {results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-xl max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                zoomTo(r);
                setSelected(r);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50/50 last:border-b-0"
            >
              <div className="font-medium text-slate-900">{r.name}</div>
              <div className="text-xs text-slate-500">
                {r.kind}
                {r.kommun ? ` · ${r.kommun}` : ''}
                {r.lan ? ` · ${r.lan}` : ''}
              </div>
            </button>
          ))}
          {selected && (
            <button
              type="button"
              onClick={() =>
                selected.type === 'area' && selected.geojson
                  ? markAsAffected(selected)
                  : null
              }
              disabled={selected.type !== 'area' || !selected.geojson}
              className={`w-full text-left px-3 py-2 text-sm ${
                selected.type !== 'area' || !selected.geojson
                  ? 'text-slate-400 cursor-not-allowed'
                  : 'text-indigo-600 font-medium hover:bg-indigo-50'
              }`}
            >
              {selected.type !== 'area' || !selected.geojson
                ? t('geo.noBoundary', { defaultValue: 'Ingen gräns att markera' })
                : t('geo.markAffected', { defaultValue: 'Markera som berört område' })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
