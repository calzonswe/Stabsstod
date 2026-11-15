// NotificationBell tests — plan.md §5.8 / M34
//
// Renders the bell against a mocked Dexie store: badge count from derived
// fixtures, menu, mark-as-read (persisted across re-polls), mark-all-read,
// browser notification only for items appearing after mount (no page-load
// burst), and the Notification API opt-in button.

import '../testMockDexie.js';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';
import { LocalStore } from '../localStore.js';
import { NotificationBell } from './NotificationBell.tsx';
import type { RecordEnvelope, HomeIdentity } from '@stabsstod/shared';

const INCIDENT = 'incident-bell';
const ME: HomeIdentity = { userId: 'user-bell', functionIds: ['fn-1'] };

let userIdSeq = 0;

function makeTaskRecord(entityId: string, title: string): RecordEnvelope {
  return {
    id: `rec-${entityId}`,
    entityId,
    entityType: 'task',
    incidentId: INCIDENT,
    parentIds: [],
    functionId: 'fn-1',
    authorId: 'user-bell',
    deviceId: 'device-1',
    hlc: '000000000000001-00001-device-1',
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    schemaVersion: 1,
    payload: {
      title,
      description: '',
      assigneeFunctionId: 'fn-1',
      assigneeUserId: 'user-bell',
      due: new Date(Date.now() + 60 * 60_000).toISOString(),
      priority: 'normal',
      status: 'todo',
      reportForm: 'none',
    },
  };
}

class MockNotification {
  static permission: string = 'granted';
  static requestPermission: ReturnType<typeof vi.fn> = vi.fn();
  static calls: Array<{ title: string; body?: string; tag?: string }> = [];
  constructor(title: string, options?: { body?: string; tag?: string }) {
    MockNotification.calls.push({ title, body: options?.body, tag: options?.tag });
  }
}

async function seedTask(store: LocalStore, entityId: string, title: string) {
  await store.ingestRemoteRecords([makeTaskRecord(entityId, title)]);
}

function renderBell(store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <NotificationBell store={store} incidentId={INCIDENT} me={ME} pollIntervalMs={50} />
    </I18nextProvider>,
  );
}

/** Badge number on the bell button, or null when there is no badge. */
function badge(bell: HTMLElement): number | null {
  const span = bell.querySelector('span');
  if (!span || !span.textContent) return null;
  const n = Number(span.textContent.trim());
  return Number.isFinite(n) ? n : null;
}

describe('NotificationBell', () => {
  let store: LocalStore;

  beforeEach(() => {
    userIdSeq += 1;
    store = new LocalStore({ userId: `bell-user-${userIdSeq}` });
    MockNotification.permission = 'granted';
    MockNotification.requestPermission = vi.fn(() => Promise.resolve('granted'));
    MockNotification.calls.length = 0;
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(async () => {
    cleanup();
    await store.close();
    vi.unstubAllGlobals();
  });

  it('shows a badge with the number of unread derived notifications', async () => {
    await seedTask(store, 'task-a', 'Uppgift A');
    await seedTask(store, 'task-b', 'Uppgift B');
    renderBell(store);

    const bell = await screen.findByRole('button', { name: 'Aviseringar' });
    await waitFor(() => expect(badge(bell)).toBe(2));
  });

  it('clicking an item marks it read and the state persists across re-polls', async () => {
    await seedTask(store, 'task-a', 'Uppgift A');
    renderBell(store);

    const bell = await screen.findByRole('button', { name: 'Aviseringar' });
    await waitFor(() => expect(badge(bell)).toBe(1));

    fireEvent.click(bell); // open the menu
    const item = await screen.findByText('Uppgift A');
    fireEvent.click(item); // mark read

    await waitFor(() => expect(badge(bell)).toBeNull());
    // Let several polls run: the read set is re-read from the store each time.
    await new Promise((r) => setTimeout(r, 200));
    expect(badge(bell)).toBeNull();
  });

  it('mark all read clears the badge', async () => {
    await seedTask(store, 'task-a', 'Uppgift A');
    await seedTask(store, 'task-b', 'Uppgift B');
    renderBell(store);

    const bell = await screen.findByRole('button', { name: 'Aviseringar' });
    await waitFor(() => expect(badge(bell)).toBe(2));

    fireEvent.click(bell);
    const markAll = await screen.findByText('Markera alla som lästa');
    fireEvent.click(markAll);

    await waitFor(() => expect(badge(bell)).toBeNull());
  });

  it('fires a browser notification only for items appearing after mount', async () => {
    await seedTask(store, 'task-a', 'Uppgift A');
    renderBell(store);

    const bell = await screen.findByRole('button', { name: 'Aviseringar' });
    await waitFor(() => expect(badge(bell)).toBe(1));
    // Opening the page must not fire a burst.
    expect(MockNotification.calls).toHaveLength(0);

    await seedTask(store, 'task-b', 'Uppgift B');
    await waitFor(() => expect(badge(bell)).toBe(2));
    await waitFor(() => expect(MockNotification.calls).toHaveLength(1));

    expect(MockNotification.calls[0].title).toBe('Ny uppgift tilldelad');
    expect(MockNotification.calls[0].body).toBe('Uppgift B');
    expect(MockNotification.calls[0].tag).toBe('task_assigned:task-b');
  });

  it('shows the opt-in button and requests permission when granted is not yet given', async () => {
    MockNotification.permission = 'default';
    await seedTask(store, 'task-a', 'Uppgift A');
    renderBell(store);

    const bell = await screen.findByRole('button', { name: 'Aviseringar' });
    await waitFor(() => expect(badge(bell)).toBe(1));

    fireEvent.click(bell);
    const enable = await screen.findByText('Aktivera webbläsaraviseringar');
    fireEvent.click(enable);

    expect(MockNotification.requestPermission).toHaveBeenCalled();
  });
});
