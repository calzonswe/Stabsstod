// Timeline — plan.md §5 / M23
//
// "Tidslinje" tab: horizontal timeline with zoom (hours/days/weeks) showing
// manual timeline_event records plus **derived** items (task deadlines,
// decisions — briefings/shifts arrive in M24/M25). Internal events render
// below the axis line, external above. Colours follow the M22 convention
// (meeting blue, deadline red) extended per event type; shown as legend only.
//
// Performance: the visible time window is windowed — only items within the
// current scroll window (+ one viewport buffer) are rendered, so a few hundred
// events stay responsive.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  can,
  type Actor,
  type TimelineEventPayload,
  type TimelineItem,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { useTimeline, type TimelineEventDraft } from '../hooks/useTimeline.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface TimelineProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
}

export default function Timeline({ store, incidentId, authorId, actor }: TimelineProps) {
  const { t } = useTranslation();
  const {
    items,
    manualEvents,
    loading,
    error,
    createEvent,
    retractEvent,
    refresh,
  } = useTimeline(store, incidentId, authorId);
  const [showForm, setShowForm] = useState(false);
  const [retractFor, setRetractFor] = useState<string | null>(null);
  const [retractReason, setRetractReason] = useState('');

  // timeline_event (plan.md §7): chief/deputy any; function_lead own function.
  const formFunctionId =
    actor?.role === 'function_lead' ? (actor.functionIds[0] ?? null) : null;
  const canCreate =
    !!actor &&
    can(
      actor,
      'write',
      { entityType: 'timeline_event', incidentId, functionId: formFunctionId },
      {},
    );

  const retractableIds = useMemo(() => {
    const s = new Set<string>();
    if (!actor) return s;
    for (const e of manualEvents) {
      if (e.retracted) continue;
      if (
        can(
          actor,
          'write',
          { entityType: 'timeline_event', incidentId, functionId: e.functionId },
          {},
        )
      ) {
        s.add(e.entityId);
      }
    }
    return s;
  }, [actor, manualEvents, incidentId]);

  if (loading) {
    return <div className="text-center py-10">{t('timeline.loading')}</div>;
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('timeline.title')}</h2>
        {canCreate && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
          >
            {showForm ? t('timeline.cancel') : t('timeline.newEvent')}
          </button>
        )}
      </div>

      {showForm && canCreate && (
        <EventForm
          onCreate={createEvent}
          formFunctionId={formFunctionId}
          onDone={() => setShowForm(false)}
        />
      )}

      <TimelineView
        items={items}
        retractableIds={retractableIds}
        onRetractClick={(entityId) => {
          setRetractFor(entityId);
          setRetractReason('');
        }}
      />

      {retractFor && (
        <Dialog title={t('timeline.retract.title')} onClose={() => setRetractFor(null)}>
          <div className="space-y-3">
            <input
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder={t('timeline.retract.reason')}
              aria-label={t('timeline.retract.reason')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRetractFor(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('timeline.retract.cancel')}
              </button>
              <button
                onClick={() => {
                  void retractEvent(retractFor, retractReason.trim());
                  setRetractFor(null);
                  setRetractReason('');
                }}
                disabled={!retractReason.trim()}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('timeline.retract.confirm')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export type TimelineZoom = 'hours' | 'days' | 'weeks';

const ZOOMS: Record<TimelineZoom, { unitMs: number; unitPx: number }> = {
  hours: { unitMs: 3_600_000, unitPx: 120 },
  days: { unitMs: 86_400_000, unitPx: 120 },
  weeks: { unitMs: 604_800_000, unitPx: 120 },
};

const TRACK_H = 190;
const AXIS_Y = 92;
const PAD_MS = 6 * 3_600_000;

// Colours as in M22: meeting blue, deadline red — extended for the remaining
// types (other = black).
const TYPE_STYLES: Record<
  TimelineEventPayload['type'],
  { dot: string; label: string }
> = {
  meeting: { dot: 'bg-blue-600 border-blue-600', label: 'border-blue-300 text-blue-900' },
  deadline: { dot: 'bg-red-600 border-red-600', label: 'border-red-300 text-red-900' },
  decision: { dot: 'bg-indigo-600 border-indigo-600', label: 'border-indigo-300 text-indigo-900' },
  milestone: { dot: 'bg-emerald-600 border-emerald-600', label: 'border-emerald-300 text-emerald-900' },
  external: { dot: 'bg-amber-500 border-amber-500', label: 'border-amber-300 text-amber-900' },
  other: { dot: 'bg-slate-700 border-slate-700', label: 'border-slate-300 text-slate-900' },
};

function formatTickTime(ms: number, zoom: TimelineZoom): string {
  const d = new Date(ms);
  if (zoom === 'hours') {
    return d.toLocaleTimeString('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return d.toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatItemTime(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export interface TimelineViewProps {
  items: TimelineItem[];
  /** Manual events the actor may retract (entityId set). */
  retractableIds?: Set<string>;
  onRetractClick?: (entityId: string) => void;
}

export function TimelineView({ items, retractableIds, onRetractClick }: TimelineViewProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<TimelineZoom>('days');
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = 0;
    }
    setScrollLeft(0);
  }, [zoom]);

  const times = useMemo(
    () => items.map((i) => new Date(i.time).getTime()),
    [items],
  );
  const minTime = times.length ? Math.min(...times) : Date.now();
  const maxTime = times.length ? Math.max(...times) : minTime + 86_400_000;

  const origin = minTime - PAD_MS;
  const pxPerMs = ZOOMS[zoom].unitPx / ZOOMS[zoom].unitMs;
  const viewportWidth = scrollerRef.current?.clientWidth || 800;
  const viewportMs = viewportWidth / pxPerMs;
  const bufferMs = viewportMs;
  const rangeStart = origin + scrollLeft / pxPerMs;
  const rangeEnd = rangeStart + viewportMs;
  const trackWidth = Math.max((maxTime + PAD_MS - origin) * pxPerMs, viewportWidth);

  // Windowing: only render items inside the visible window + one buffer.
  const visible = items.filter((i) => {
    const tm = new Date(i.time).getTime();
    return tm >= rangeStart - bufferMs && tm <= rangeEnd + bufferMs;
  });

  const interval = ZOOMS[zoom].unitMs;
  const ticks: number[] = [];
  for (
    let tm = Math.ceil((rangeStart - bufferMs) / interval) * interval;
    tm <= rangeEnd + bufferMs;
    tm += interval
  ) {
    ticks.push(tm);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 text-sm">
          {(['hours', 'days', 'weeks'] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={
                zoom === z
                  ? 'px-2 py-1 rounded border border-indigo-600 text-indigo-600 bg-indigo-50'
                  : 'px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50'
              }
            >
              {t(`timeline.zoom.${z}`)}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          {`${items.length} ${t('timeline.itemsCount')}`}
        </div>
      </div>

      <div className="text-xs text-slate-500">{t('timeline.legend')}</div>

      {items.length === 0 && (
        <div className="text-center py-8 text-slate-500 border border-dashed border-slate-200 rounded">
          {t('timeline.empty')}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        className="overflow-x-auto border border-slate-200 rounded"
      >
        <div
          style={{ position: 'relative', width: trackWidth, height: TRACK_H }}
        >
          {/* Axis line: internal below, external above. */}
          <div
            style={{
              position: 'absolute',
              top: AXIS_Y,
              left: 0,
              right: 0,
              height: 2,
              background: '#94a3b8',
            }}
          />
          {ticks.map((tm) => (
            <div
              key={tm}
              style={{
                position: 'absolute',
                top: 0,
                height: TRACK_H,
                width: 0,
                left: (tm - origin) * pxPerMs,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: AXIS_Y - 5,
                  height: 10,
                  width: 1,
                  background: '#cbd5e1',
                }}
              />
              <div
                className="absolute text-[10px] text-slate-500 whitespace-nowrap"
                style={{ top: TRACK_H - 16, transform: 'translateX(-50%)' }}
              >
                {formatTickTime(tm, zoom)}
              </div>
            </div>
          ))}
          {visible.map((item) => (
            <Marker
              key={item.id}
              item={item}
              left={(new Date(item.time).getTime() - origin) * pxPerMs}
              retractable={
                item.refEntityId ? (retractableIds?.has(item.refEntityId) ?? false) : false
              }
              onRetractClick={onRetractClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Marker({
  item,
  left,
  retractable,
  onRetractClick,
}: {
  item: TimelineItem;
  left: number;
  retractable: boolean;
  onRetractClick?: (entityId: string) => void;
}) {
  const { t } = useTranslation();
  const external = item.scope === 'external';
  const style = TYPE_STYLES[item.type];

  return (
    <div
      data-testid="timeline-item"
      data-scope={item.scope}
      style={{ position: 'absolute', top: 0, height: TRACK_H, width: 0, left }}
    >
      {/* Stem to the axis. */}
      <div
        style={{
          position: 'absolute',
          left: -1,
          top: external ? 44 : AXIS_Y,
          height: external ? AXIS_Y - 44 : 14,
          width: 2,
          background: '#94a3b8',
        }}
      />
      {/* Dot on the axis. */}
      <div
        className={`absolute rounded-full border-2 ${style.dot}`}
        style={{ left: -5, top: AXIS_Y - 5, width: 10, height: 10 }}
      />
      {/* Label: external above the axis, internal below. */}
      <div
        data-testid="timeline-label"
        className={`absolute border rounded px-1 py-0.5 text-xs bg-white ${style.label}`}
        style={{
          left: -60,
          width: 120,
          top: external ? 4 : AXIS_Y + 16,
          textAlign: 'center',
        }}
      >
        <span className="block truncate font-medium">{item.title}</span>
        <span className="block truncate text-[10px] opacity-70">
          {formatItemTime(item.time)}
        </span>
        {retractable && (
          <button
            type="button"
            aria-label={t('timeline.remove')}
            title={t('timeline.remove')}
            onClick={() => item.refEntityId && onRetractClick?.(item.refEntityId)}
            className="absolute -top-2 -right-2 text-xs px-0.5 bg-white border border-red-200 rounded-full text-red-600 hover:bg-red-50"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EventForm({
  onCreate,
  formFunctionId,
  onDone,
}: {
  onCreate: (draft: TimelineEventDraft, functionId: string | null) => Promise<void>;
  formFunctionId: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  const toLocalInput = (d: Date) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };

  const [title, setTitle] = useState('');
  const [time, setTime] = useState(() => toLocalInput(new Date()));
  const [endTime, setEndTime] = useState('');
  const [type, setType] = useState<TimelineEventPayload['type']>('meeting');
  const [scope, setScope] = useState<TimelineEventPayload['scope']>('internal');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving || !title.trim() || !time) return;
    setSaving(true);
    try {
      await onCreate(
        {
          title: title.trim(),
          time: new Date(time).toISOString(),
          endTime: endTime ? new Date(endTime).toISOString() : undefined,
          type,
          scope,
        },
        formFunctionId,
      );
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-300 rounded p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('timeline.form.title')}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <input
          value={time}
          onChange={(e) => setTime(e.target.value)}
          type="datetime-local"
          aria-label={t('timeline.form.time')}
          className="px-2 py-2 border border-slate-300 rounded text-sm"
        />
        <input
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          type="datetime-local"
          aria-label={t('timeline.form.endTime')}
          placeholder={t('timeline.form.endTime')}
          className="px-2 py-2 border border-slate-300 rounded text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TimelineEventPayload['type'])}
            aria-label={t('timeline.form.type')}
            className="px-2 py-2 border border-slate-300 rounded text-sm"
          >
            {(['meeting', 'deadline', 'decision', 'milestone', 'external', 'other'] as const).map(
              (ty) => (
                <option key={ty} value={ty}>
                  {t(`timeline.type.${ty}`)}
                </option>
              ),
            )}
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as TimelineEventPayload['scope'])}
            aria-label={t('timeline.form.scope')}
            className="px-2 py-2 border border-slate-300 rounded text-sm"
          >
            {(['internal', 'external'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`timeline.scope.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={() => void handleSave()}
        disabled={saving || !title.trim() || !time}
        className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? t('timeline.form.saving') : t('timeline.form.save')}
      </button>
    </div>
  );
}
