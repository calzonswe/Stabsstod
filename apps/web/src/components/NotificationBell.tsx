// NotificationBell — plan.md §5.8 / M34
//
// Bell menu with client-side-derived notifications (works offline): the
// incident's local record bag is fed through deriveNotifications
// (@stabsstod/shared) on every poll + 1 s clock tick. Read/unread state is
// persisted per user in the local Dexie (readNotifications table), keyed by
// the stable notification ids. Browser notifications (Notification API) fire
// for items that appear after the first derivation — the first derivation
// only seeds state, so opening a page never fires a burst.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deriveNotifications,
  type HomeIdentity,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';

export interface NotificationBellProps {
  store: LocalStore;
  incidentId: string;
  me: HomeIdentity;
  /** Poll interval for records + read state. Default 5000 ms. */
  pollIntervalMs?: number;
}

export function NotificationBell({
  store,
  incidentId,
  me,
  pollIntervalMs = 5000,
}: NotificationBellProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const panelRef = useRef<HTMLDivElement | null>(null);

  // While the panel is open: move focus into it and close on Escape.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // 1 s tick: the time-bound rules (overdue, briefing/shift windows) must
  // re-derive as the clock moves.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll the local store for the incident's records + read notification ids.
  const refresh = useCallback(async () => {
    try {
      const [recs, read] = await Promise.all([
        store.getRecordsByIncident(incidentId),
        store.getReadNotificationIds(incidentId),
      ]);
      setRecords(recs);
      setReadIds(new Set(read));
    } catch {
      // Store temporarily unavailable — keep the previous state.
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(timer);
  }, [refresh, pollIntervalMs]);

  const items = useMemo(() => deriveNotifications({ records, me, now }), [records, me, now]);

  const unread = items.filter((i) => !readIds.has(i.id));

  // Browser notification for newly appearing items. The first derivation
  // that has data only seeds the previous-id set (no page-load burst); the
  // empty initial render (before the store is polled) must not seed it.
  const prevIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (records.length === 0) return;
    const prev = prevIdsRef.current;
    const ids = items.map((i) => i.id);
    if (prev === null) {
      prevIdsRef.current = new Set(ids);
      return;
    }
    const fresh = items.filter((i) => !prev.has(i.id));
    prevIdsRef.current = new Set(ids);
    if (fresh.length === 0 || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    for (const item of fresh) {
      try {
        new Notification(t(`notifications.kind.${item.kind}`), {
          body: item.subject || item.refId,
          tag: item.id,
        });
      } catch {
        // Constructing a Notification can throw in some environments — ignore.
      }
    }
  }, [items, records, t]);

  const [permission, setPermission] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );

  const enableBrowserNotifications = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then((p) => setPermission(p));
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      setReadIds((prev) => new Set(prev).add(id));
      try {
        await store.markNotificationRead(incidentId, id);
      } catch {
        // Keep local state; the next poll reconciles with the store.
      }
    },
    [store, incidentId],
  );

  const markAllRead = useCallback(async () => {
    const ids = unread.map((i) => i.id);
    if (ids.length === 0) return;
    setReadIds((prev) => new Set([...prev, ...ids]));
    try {
      await store.markAllNotificationsRead(incidentId, ids);
    } catch {
      // Keep local state; the next poll reconciles with the store.
    }
  }, [store, incidentId, unread]);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative p-1 text-slate-600 hover:text-slate-900"
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] font-medium leading-4 text-white">
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Overlay for outside clicks. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t('notifications.title')}
            tabIndex={-1}
            className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg outline-none"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 gap-2">
              <span className="text-sm font-medium text-slate-700">{t('notifications.title')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                  disabled={unread.length === 0}
                  onClick={() => void markAllRead()}
                >
                  {t('notifications.markAllRead')}
                </button>
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-900"
                  aria-label={t('common.close')}
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            {permission === 'default' && (
              <div className="border-b border-slate-100 px-3 py-2">
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                  onClick={enableBrowserNotifications}
                >
                  {t('notifications.enableBrowser')}
                </button>
              </div>
            )}
            {items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">{t('notifications.none')}</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left hover:bg-slate-50 ${
                        readIds.has(item.id) ? 'opacity-50' : ''
                      }`}
                      onClick={() => void markRead(item.id)}
                    >
                      <span className="block text-xs font-medium text-slate-500">
                        {t(`notifications.kind.${item.kind}`)}
                      </span>
                      <span className="block truncate text-sm text-slate-800">
                        {item.subject || item.refId}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
