// MapDraw — plan.md §5 / M30
//
// terra-draw integration with MapLibre: point, line, polygon, circle,
// edit, select. Drawn features are saved as versioned `map_feature` records
// (via useMapFeatures). Features already in the local store are rendered on
// the map. A side panel edits feature properties (label, layer, severity,
// validity, description) and toggles layer visibility.
//
// The adapter renders terra-draw features as MapLibre GeoJSON layers.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from 'terra-draw';

// terra-draw styles are bundled by Vite; no separate CSS import needed
// in the jsdom/vitest environment (style.css isn't exported under node conditions).
import { MapLibreAdapter, SEVERITY_PAINT, type GeoJSONFeature, type GeoJSONGeometry } from '../map/MapLibreAdapter.js';
import { useMapFeatures } from '../hooks/useMapFeatures.js';
import type { LocalStore } from '../localStore.js';
import type { MapFeaturePayload } from '@stabsstod/shared';

type MapInstance = ConstructorParameters<typeof MapLibreAdapter>[0]['map'];

interface MapDrawProps {
  map: MapInstance | null;
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  functionId: string | null;
}

const DRAW_MODES: Array<{ id: string; label: string; mode: string; icon: string }> = [
  { id: 'select', label: 'Välj', mode: 'select', icon: '👆' },
  { id: 'point', label: 'Punkt', mode: 'point', icon: '📍' },
  { id: 'line', label: 'Linje', mode: 'line_string', icon: '➖' },
  { id: 'polygon', label: 'Polygon', mode: 'polygon', icon: '⬡' },
  { id: 'circle', label: 'Cirkel', mode: 'circle', icon: '🔵' },
];

const LAYERS: Array<{ id: string; label: string }> = [
  { id: 'situation', label: 'Läge' },
  { id: 'operations', label: 'Insats' },
  { id: 'logistics', label: 'Logistik' },
];

const SEVERITIES: Array<{ id: string; label: string }> = [
  { id: 'info', label: 'Information' },
  { id: 'warning', label: 'Varning' },
  { id: 'severe', label: 'Allvarligt' },
];

const VALIDITIES: Array<{ id: string; label: string }> = [
  { id: 'now', label: 'Nu' },
  { id: 'forecast', label: 'Prognos' },
  { id: 'planning', label: 'Planering' },
];

function payloadToFeature(
  entityId: string,
  payload: MapFeaturePayload,
): GeoJSONFeature {
  return {
    type: 'Feature',
    id: entityId,
    geometry: payload.geometry,
    properties: {
      label: payload.label,
      layer: payload.layer,
      severity: payload.severity,
      validity: payload.validity,
      description: payload.description ?? '',
      situationSnapshotId: payload.situationSnapshotId ?? '',
      _entityId: entityId,
    },
  };
}

interface MapFeatureForm {
  label: string;
  layer: MapFeaturePayload['layer'];
  severity: MapFeaturePayload['severity'];
  validity: MapFeaturePayload['validity'];
  description: string;
}

export default function MapDraw(props: MapDrawProps) {
  const { t } = useTranslation();
  const { map, store, incidentId, authorId, functionId } = props;
  const {
    features,
    loading,
    error,
    createFeature,
    updateFeature,
    retractFeature,
  } = useMapFeatures(store, incidentId, authorId);

  const tdRef = useRef<TerraDraw | null>(null);
  const adapterRef = useRef<MapLibreAdapter | null>(null);
  const [newFeatureGeometry, setNewFeatureGeometry] = useState<GeoJSONGeometry | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<string>('select');
  const [form, setForm] = useState<MapFeatureForm>({
    label: '',
    layer: 'situation',
    severity: 'info',
    validity: 'now',
    description: '',
  });

  // ------------------------------------------------------------------
  // Initialise terra-draw when the MapLibre map is ready.
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!map || !store) return;
    const adapter = new MapLibreAdapter({ map });
    const td = new TerraDraw({
      adapter,
      modes: [
        new TerraDrawSelectMode(),
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode(),
        new TerraDrawCircleMode(),
      ],
    });
    tdRef.current = td;
    adapterRef.current = adapter;
    // start() registers the adapter with terra-draw, which adds the
    // GeoJSON source/layers to the map (adapter.register → ensureLayers).
    // Without it, adapter.setFeatures() would read a missing source and
    // throw.
    td.start();

    // Load existing features from the local store into terra-draw.
    const tfFeatures = features
      .filter((fv) => fv.current)
      .map((fv) => payloadToFeature(fv.entityId, fv.current!.payload as MapFeaturePayload));
    adapter.setFeatures(tfFeatures);

    return () => {
      // terra-draw v1 has no explicit destroy; stop() unregisters the
      // adapter's event listeners, dropping the refs is sufficient otherwise.
      try {
        td.stop();
      } catch {
        // The map may already be gone (e.g. tab switch); ignore.
      }
      tdRef.current = null;
      adapterRef.current = null;
    };
  }, [map, store]);

  // ------------------------------------------------------------------
  // Re-sync to terra-draw when features change (e.g. after retract/save).
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!map || !adapterRef.current) return;
    const tfFeatures = features
      .filter((fv) => fv.current)
      .map((fv) => payloadToFeature(fv.entityId, fv.current!.payload as MapFeaturePayload));
    adapterRef.current.setFeatures(tfFeatures);
  }, [map, features]);

  // ------------------------------------------------------------------
  // Feature form actions
  // ------------------------------------------------------------------

  const saveNewFeature = useCallback(async () => {
    if (!newFeatureGeometry) return;
    const draft: MapFeaturePayload = {
      label: form.label,
      layer: form.layer,
      geometry: newFeatureGeometry as MapFeaturePayload['geometry'],
      severity: form.severity,
      validity: form.validity,
      description: form.description || undefined,
    };
    await createFeature(draft, functionId);
    setNewFeatureGeometry(null);
  }, [createFeature, functionId, form, newFeatureGeometry]);

  const saveEditedFeature = useCallback(async () => {
    if (!editingEntityId) return;
    await updateFeature(editingEntityId, (payload) => ({
      ...payload,
      label: form.label,
      layer: form.layer,
      severity: form.severity,
      validity: form.validity,
      description: form.description || undefined,
    }));
    setEditingEntityId(null);
  }, [updateFeature, form, editingEntityId]);

  const handleRetract = useCallback(async (entityId: string) => {
    const reason = window.prompt(t('map.retractReason', { defaultValue: 'Anledning till återkallelse' }));
    if (!reason) return;
    await retractFeature(entityId, reason);
  }, [retractFeature, t]);

  // ------------------------------------------------------------------
  // Mode switching
  // ------------------------------------------------------------------

  const setMode = useCallback((mode: string) => {
    const td = tdRef.current;
    if (!td) return;
    td.setMode(mode);
    setActiveMode(mode);
  }, []);

  // ------------------------------------------------------------------
  // Click on a feature → open edit form
  // ------------------------------------------------------------------

  const handleFeatureClick = useCallback(
    (entityId: string, payload: MapFeaturePayload) => {
      setEditingEntityId(entityId);
      setNewFeatureGeometry(null);
      setForm({
        label: payload.label,
        layer: payload.layer,
        severity: payload.severity,
        validity: payload.validity,
        description: payload.description ?? '',
      });
      setActiveMode('select');
    },
    [],
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (!map) return null;

  return (
    <div className="relative h-full w-full flex">
      {/* Map (fills the container) */}
      <div className="flex-1 h-full w-full" />

      {/* Drawing toolbar (top-left) */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1">
        <div className="bg-white/90 backdrop-blur rounded-lg shadow-md p-2 border border-slate-200">
          {DRAW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.mode)}
              aria-pressed={activeMode === m.mode}
              className={`w-8 h-8 rounded flex items-center justify-center text-sm transition ${
                activeMode === m.mode
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
              title={m.label}
            >
              {m.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Feature properties form (bottom-left) */}
      {(newFeatureGeometry || editingEntityId) && (
        <div className="absolute bottom-3 left-3 z-20 w-80 bg-white rounded-lg shadow-xl border border-slate-200 p-4 flex flex-col gap-3">
          {editingEntityId ? (
            <h3 className="text-sm font-semibold">{t('map.editFeature', { defaultValue: 'Redigera objekt' })}</h3>
          ) : (
            <h3 className="text-sm font-semibold">{t('map.newFeature', { defaultValue: 'Nytt kartobjekt' })}</h3>
          )}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-600">{t('map.label', { defaultValue: 'Namn' })}</label>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            />
            <label className="text-xs font-medium text-slate-600">{t('map.layer', { defaultValue: 'Lager' })}</label>
            <select
              value={form.layer}
              onChange={(e) => setForm({ ...form, layer: e.target.value as MapFeaturePayload['layer'] })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              {LAYERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <label className="text-xs font-medium text-slate-600">{t('map.severity', { defaultValue: 'Allvarlighetsgrad' })}</label>
            <select
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as MapFeaturePayload['severity'] })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              {SEVERITIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="text-xs font-medium text-slate-600">{t('map.validity', { defaultValue: 'Giltighet' })}</label>
            <select
              value={form.validity}
              onChange={(e) => setForm({ ...form, validity: e.target.value as MapFeaturePayload['validity'] })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              {VALIDITIES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <label className="text-xs font-medium text-slate-600">{t('map.description', { defaultValue: 'Beskrivning' })}</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                setNewFeatureGeometry(null);
                setEditingEntityId(null);
                setActiveMode('select');
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Avbryt
            </button>
            {editingEntityId ? (
              <button
                type="button"
                onClick={saveEditedFeature}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Spara
              </button>
            ) : (
              <button
                type="button"
                disabled={!form.label}
                onClick={saveNewFeature}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Spara objekt
              </button>
            )}
          </div>
        </div>
      )}

      {/* Feature list / layer toggles (bottom-right) */}
      <div className="absolute bottom-3 right-3 z-20 w-64 bg-white/90 backdrop-blur rounded-lg shadow-xl border border-slate-200 p-3 overflow-hidden">
        <h3 className="text-xs font-semibold text-slate-600 mb-2">
          {t('map.features', { defaultValue: 'Kartobjekt' })}
        </h3>
        <div className="flex items-center gap-2 mb-2 text-xs">
          {LAYERS.map((l) => (
            <label key={l.id} className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                defaultChecked
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {l.label}
            </label>
          ))}
        </div>
        {loading ? (
          <div className="text-xs text-slate-400">{t('map.loading')}</div>
        ) : features.length === 0 ? (
          <div className="text-xs text-slate-400">{t('map.noFeatures', { defaultValue: 'Inga kartobjekt än' })}</div>
        ) : (
          <ul className="max-h-40 overflow-y-auto text-xs space-y-1">
            {features.map((fv) => {
              const payload = fv.current?.payload as MapFeaturePayload | undefined;
              const color = payload ? SEVERITY_PAINT[payload.severity] : '#94a3b8';
              return (
                <li
                  key={fv.entityId}
                  className="flex items-center gap-2"
                  title={payload?.label || ''}
                >
                  <div
                    className={`w-3 h-3 rounded-full border border-slate-300`}
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate w-full" title={payload?.label || ''}>
                    {payload?.label || '(namnlöst)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFeatureClick(fv.entityId, payload!)}
                    className="ml-auto text-slate-400 hover:text-slate-600"
                    title={t('map.edit', { defaultValue: 'Redigera' })}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetract(fv.entityId)}
                    className="ml-1 text-red-500 hover:text-red-700"
                    title={t('map.retract', { defaultValue: 'Återkalla' })}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <div className="mt-2 text-xs text-red-600 bg-red-50 rounded p-1.5">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
