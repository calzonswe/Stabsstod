// MapLibre adapter for terra-draw — plan.md §5 / M30.
//
// Bridges terra-draw's interaction (point / line / polygon / circle /
// edit / select) to MapLibre GL JS rendering. terra-draw drives all mouse
// interaction; the adapter projects/unprojects coordinates and keeps a
// MapLibre GeoJSON source in sync with terra-draw's feature store.
//
// Feature styling is applied via MapLibre paint expressions keyed on the
// `severity` property (info / warning / severe).

import MapLibreGLDefault from 'maplibre-gl';

const MapLibreGL = MapLibreGLDefault as unknown as typeof import('maplibre-gl').MapLibreGL; // eslint-disable-line @typescript-eslint/no-unused-vars

export type MapInstance = InstanceType<typeof MapLibreGL.Map>;

// Minimal GeoJSON types (no @types/geojson dependency).
export interface GeoJSONGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJSONFeature<P = Record<string, unknown>> {
  type: 'Feature';
  id: string | number;
  geometry: GeoJSONGeometry;
  properties: P;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// Structural copy of terra-draw's TerraDrawAdapter (type-only, erased at
// runtime). terra-draw does not re-export this interface from its main
// module, so we mirror the shape here.
export interface TerraDrawAdapterLike {
  project: (lng: number, lat: number) => { x: number; y: number };
  unproject: (x: number, y: number) => { lng: number; lat: number };
  setCursor: (cursor: string) => void;
  getLngLatFromEvent: (event: PointerEvent | MouseEvent) => { lng: number; lat: number };
  setDoubleClickToZoom: (enabled: boolean) => void;
  getMapEventElement: (eventType?: string) => HTMLElement;
  register: (callbacks: { onReady?: () => void; [key: string]: unknown }) => void;
  unregister: () => void;
  render: (changes: unknown, styling: unknown) => void;
  clear: () => void;
  getCoordinatePrecision: () => number;
}

export interface TerraDrawCallbacksLike {
  onReady?: () => void;
  [key: string]: unknown;
}

/** Colours keyed to `MapFeatureSeverity`. */
export const SEVERITY_PAINT: Record<string, string> = {
  info: '#3b82f6',      // blue
  warning: '#f59e0b',   // amber
  severe: '#ef4444',    // red
};

export class MapLibreAdapter {
  private readonly map: MapInstance;
  private readonly container: HTMLElement;
  private callbacks: TerraDrawCallbacksLike | null = null;
  private onChange?: (features: GeoJSONFeature[]) => void;
  private sourceId = 'stabsstod-drawn-features';
  private layerId = 'stabsstod-drawn-features-layer';
  private initialized = false;
  private featuresCache: GeoJSONFeature[] = [];

  constructor(opts: { map: MapInstance; onChange?: (features: GeoJSONFeature[]) => void }) {
    this.map = opts.map;
    this.container = this.map.getContainer();
    this.onChange = opts.onChange;
  }

  // ------------------------------------------------------------------
  // Projection
  // ------------------------------------------------------------------

  project(lng: number, lat: number): { x: number; y: number } {
    const p = (this.map as unknown as { project: (ll: { lng: number; lat: number }) => { x: number; y: number } }).project({ lng, lat });
    return { x: p.x, y: p.y };
  }

  unproject(x: number, y: number): { lng: number; lat: number } {
    const p = (this.map as unknown as { unproject: (pt: { x: number; y: number }) => { lng: number; lat: number } }).unproject({ x, y });
    return { lng: p.lng, lat: p.lat };
  }

  // ------------------------------------------------------------------
  // Cursor / events
  // ------------------------------------------------------------------

  setCursor(cursor: string): void {
    this.container.style.cursor = cursor;
  }

  getLngLatFromEvent(
    event: PointerEvent | MouseEvent,
  ): { lng: number; lat: number } {
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const p = (this.map as unknown as { unproject: (pt: { x: number; y: number }) => { lng: number; lat: number } }).unproject({ x, y });
    return { lng: p.lng, lat: p.lat };
  }

  setDoubleClickToZoom(enabled: boolean): void {
    const dc = (this.map as unknown as { doubleClickZoom: { enable: () => void; disable: () => void } }).doubleClickZoom;
    if (enabled) dc.enable(); else dc.disable();
  }

  getMapEventElement(): HTMLElement {
    return this.container;
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  register(callbacks: TerraDrawCallbacksLike): void {
    this.callbacks = callbacks;
    this.ensureLayers();
    this.callbacks.onReady?.();
  }

  unregister(): void {
    this.callbacks = null;
  }

  private ensureLayers(): void {
    if (this.initialized) return;
    const map = this.map as unknown as {
      getSource: (id: string) => unknown;
      addSource: (id: string, source: unknown) => void;
      getLayer: (id: string) => unknown;
      addLayer: (layer: unknown) => void;
    };
    if (!map.getSource(this.sourceId)) {
      map.addSource(this.sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    const layers: Array<{ id: string; type: string; filter: unknown }> = [
      { id: `${this.layerId}-point`, type: 'circle', filter: ['==', ['geometry-type'], 'Point'] },
      { id: `${this.layerId}-linestring`, type: 'line', filter: ['==', ['geometry-type'], 'LineString'] },
      { id: `${this.layerId}-polygon-fill`, type: 'fill', filter: ['==', ['geometry-type'], 'Polygon'] },
      { id: `${this.layerId}-polygon-outline`, type: 'line', filter: ['==', ['geometry-type'], 'Polygon'] },
    ];
    for (const layer of layers) {
      if (map.getLayer(layer.id)) continue;
      map.addLayer({
        id: layer.id,
        type: layer.type,
        source: this.sourceId,
        filter: layer.filter,
        paint: this.paintFor(layer.id),
      });
    }
    this.initialized = true;
  }

  private paintFor(id: string): Record<string, unknown> {
    const severity: unknown = ['get', 'severity'];
    const color: unknown = [
      'match',
      severity,
      'info',
      SEVERITY_PAINT.info,
      'warning',
      SEVERITY_PAINT.warning,
      'severe',
      SEVERITY_PAINT.severe,
      '#94a3b8',
    ];
    if (id.endsWith('-point')) {
      return {
        'circle-radius': 6,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.9,
      };
    }
    if (id.endsWith('-linestring')) {
      return {
        'line-color': color,
        'line-width': 3,
        'line-opacity': 0.9,
      };
    }
    if (id.includes('polygon-fill')) {
      return {
        'fill-color': color,
        'fill-opacity': 0.35,
      };
    }
    return { 'line-color': color, 'line-width': 2, 'line-opacity': 0.9 };
  }

  // ------------------------------------------------------------------
  // Rendering — called by terra-draw whenever features change.
  // ------------------------------------------------------------------

  render(
    changes: { created: GeoJSONFeature[]; updated: GeoJSONFeature[]; deletedIds: string[] },
  ): void {
    for (const f of changes.created) this.upsertFeature(f);
    for (const f of changes.updated) this.upsertFeature(f);
    for (const id of changes.deletedIds) {
      this.featuresCache = this.featuresCache.filter((f) => f.id !== id);
    }

    const source = this.map.getSource(this.sourceId);
    const gjSource = source as unknown as { setData: (data: GeoJSONFeatureCollection) => void };
    if (gjSource.setData) {
      gjSource.setData(this.featureCollection());
    }
    this.onChange?.(this.allFeatures());
  }

  /** Replace the cached features (called by the component when loading
   *  existing features from the local store). */
  setFeatures(features: GeoJSONFeature[]): void {
    this.featuresCache = features;
    const source = this.map.getSource(this.sourceId);
    const gjSource = source as unknown as { setData: (data: GeoJSONFeatureCollection) => void };
    if (gjSource.setData) {
      gjSource.setData(this.featureCollection());
    }
  }

  private featureCollection(): GeoJSONFeatureCollection {
    return { type: 'FeatureCollection', features: this.featuresCache };
  }

  private allFeatures(): GeoJSONFeature[] {
    return this.featuresCache;
  }

  /** Upsert a feature into the cache (called by terra-draw via render changes). */
  upsertFeature(feature: GeoJSONFeature): void {
    const idx = this.featuresCache.findIndex((f) => f.id === feature.id);
    if (idx >= 0) {
      this.featuresCache[idx] = feature;
    } else {
      this.featuresCache.push(feature);
    }
  }

  clear(): void {
    this.featuresCache = [];
    const source = this.map.getSource(this.sourceId);
    const gjSource = source as unknown as { setData: (data: GeoJSONFeatureCollection) => void };
    if (gjSource.setData) {
      gjSource.setData(this.featureCollection());
    }
  }

  getCoordinatePrecision(): number {
    return 6;
  }
}
