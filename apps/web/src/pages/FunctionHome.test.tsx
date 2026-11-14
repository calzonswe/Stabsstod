// Function home tests — M33
//
// The function workspace home renders every widget from the incident's
// local records (seeded into the mock Dexie store) via the pure selectors
// in @stabsstod/shared. Acceptance: "selectors tested" (packages/shared,
// functionHome.test.ts) + the home renders from fixtures.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import { FunctionHome } from './FunctionHome.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type EntityType, type RecordEnvelope } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m33';

const FUNCTIONS = [
  { id: 'fn-1', name: 'Ledning' },
  { id: 'fn-2', name: 'Logistik' },
  { id: 'fn-3', name: 'Läkare' },
];

const MEMBERS = [
  { userId: 'user-me', userName: 'Maria Mig', functionIds: ['fn-1', 'fn-2'] },
  { userId: 'user-prev', userName: 'Pär Växlande', functionIds: ['fn-1'] },
];

// The signed-in user: member of fn-1 and fn-2 (fn-3 is not mine).
const ME = { userId: 'user-me', functionIds: ['fn-1', 'fn-2'] };

const NOW = Date.now();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: EntityType,
  payload: unknown,
  functionId: string | null = null,
  createdAtClient?: string,
): Promise<RecordEnvelope> {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId,
    authorId: 'user-me',
    deviceId: getDeviceId(),
    schemaVersion: 1,
    payload,
    createdAtClient: createdAtClient ?? new Date().toISOString(),
    kind: 'put',
    state,
  });
  saveHlcState(next, getDeviceId());
  await store.ingestRemoteRecords([record]);
  return record;
}

function renderHome(store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <FunctionHome
          store={store}
          incidentId={INCIDENT}
          functions={FUNCTIONS}
          members={MEMBERS}
          incident={{ id: INCIDENT, name: 'Brand i industriområde', startedAt: inMin(-120), status: 'active' }}
          me={ME}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function sectionByTitle(title: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByText(title)).toBeInTheDocument();
  });
  const el = screen.getByText(title).closest('section');
  if (!el) throw new Error(`no section for ${title}`);
  return el;
}

describe('FunctionHome (M33)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders every widget from seeded local records', async () => {
    const store = makeStore('user-m33-1');

    // My tasks: one overdue, one blocked.
    await seed(store, 'task-mine-overdue', 'task', {
      title: 'Uppgift sen',
      description: '',
      assigneeFunctionId: 'fn-1',
      assigneeUserId: 'user-me',
      due: inMin(-30),
      priority: 'normal',
      status: 'todo',
      reportForm: 'oral',
    });
    await seed(store, 'task-mine-blocked', 'task', {
      title: 'Uppgift blockerad',
      description: '',
      assigneeFunctionId: 'fn-2',
      assigneeUserId: 'user-me',
      due: inMin(60),
      priority: 'high',
      status: 'blocked',
      reportForm: 'none',
    });
    // A task for my function but not assigned to me (board open count).
    await seed(store, 'task-fn2-other', 'task', {
      title: 'Andra uppgift',
      description: '',
      assigneeFunctionId: 'fn-2',
      due: inMin(120),
      priority: 'normal',
      status: 'todo',
      reportForm: 'none',
    });

    // Log entry.
    await seed(store, 'log-1', 'log_entry', {
      text: 'Händelse ett',
      category: 'event',
      eventTime: inMin(-10),
      source: '',
      visibility: 'incident',
    });

    // Upcoming briefing in ~30 min; fn-1 has reported, fn-2 still owes a report.
    await seed(store, 'briefing-1', 'briefing', {
      title: 'Dagsbrief',
      scheduledAt: inMin(30),
      kind: 'recurring',
      agenda: [],
      status: 'planned',
    });
    await seed(
      store,
      'report-1',
      'briefing_report',
      {
        briefingId: 'briefing-1',
        done: '',
        planned: '',
        challenges: '',
        collaborationNeeds: '',
      },
      'fn-1',
    );

    // My current shift (fn-1) and next shift (fn-1).
    await seed(store, 'shift-current', 'shift', {
      functionId: 'fn-1',
      userId: 'user-me',
      role: 'function_lead',
      start: inMin(-60),
      end: inMin(120),
    });
    await seed(store, 'shift-next', 'shift', {
      functionId: 'fn-1',
      userId: 'user-me',
      role: 'function_lead',
      start: inMin(120),
      end: inMin(240),
    });

    // Handover notes: one addressed to me, one tied to my next shift.
    await seed(
      store,
      'note-mine',
      'handover_note',
      { fromUserId: 'user-prev', toUserId: 'user-me', text: 'Överlämning till dig' },
      'fn-1',
    );
    await seed(
      store,
      'note-next',
      'handover_note',
      { shiftId: 'shift-next', fromUserId: 'user-prev', text: 'Notera till nästa' },
      'fn-1',
    );

    // Open decision request my function (fn-2) is needed for.
    await seed(store, 'decision-1', 'decision_request', {
      question: 'Beslut om förstärkning?',
      options: [{ title: 'Ja', pros: ['p'], cons: ['c'] }],
      neededBy: 'fn-2',
      status: 'open',
    });

    renderHome(store);

    await waitFor(() => {
      expect(screen.getByText('Brand i industriområde')).toBeInTheDocument();
    });

    // My tasks (overdue flagged, blocked listed).
    const tasksSection = await sectionByTitle('Mina uppgifter');
    expect(tasksSection.textContent).toContain('Uppgift sen');
    expect(tasksSection.textContent).toContain('(Förfallen)');
    expect(tasksSection.textContent).toContain('Uppgift blockerad');
    // Someone else's task is not listed.
    expect(tasksSection.textContent).not.toContain('Andra uppgift');

    // Upcoming briefing with the "prepare my report" shortcut; only fn-2
    // (Logistik) is missing.
    const briefSection = await sectionByTitle('Kommande briefning');
    expect(briefSection.textContent).toContain('Dagsbrief');
    expect(briefSection.textContent).toContain('Förbered min rapport');
    // Only fn-2 (Logistik) is missing — Ledning is not listed.
    expect(briefSection.textContent).toContain('Saknar rapport Logistik');
    expect(briefSection.textContent).not.toContain('Ledning');

    // My function's board: only my functions (Ledning + Logistik, not Läkare).
    const boardSection = await sectionByTitle('Min funktion');
    const rows = boardSection.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(boardSection.textContent).not.toContain('Läkare');
    // Logistik has two open tasks (task-fn2-other + my blocked task).
    const logistikRow = [...rows].find((r) => r.textContent?.includes('Logistik'))!;
    const logistikCells = logistikRow.querySelectorAll('td');
    expect(logistikCells[2].textContent).toBe('2');

    // Latest log.
    const logSection = await sectionByTitle('Senaste händelser');
    expect(logSection.textContent).toContain('Händelse ett');

    // My shift (current + next) and both handover notes.
    const shiftSection = await sectionByTitle('Min avläsning');
    expect(shiftSection.textContent).toContain('Pågående');
    expect(shiftSection.textContent).toContain('Nästa');
    expect(shiftSection.textContent).toContain('Överlämning till dig');
    expect(shiftSection.textContent).toContain('Notera till nästa');

    // Items needing my attention: overdue task, blocked task, decision for
    // my function, missing briefing report (next shift is 2 h away, outside
    // the 30 min window).
    const attentionSection = await sectionByTitle('Kräver min uppmärksamhet');
    expect(attentionSection.textContent).toContain('Försenad uppgift');
    expect(attentionSection.textContent).toContain('Blockerad uppgift');
    expect(attentionSection.textContent).toContain('Beslut behövs');
    expect(attentionSection.textContent).toContain('Briefningsrapport saknas');
    expect(attentionSection.textContent).not.toContain('Avläsning börjar snart');
  });

  it('shows empty states for an incident with no records', async () => {
    const store = makeStore('user-m33-2');
    renderHome(store);

    await waitFor(() => {
      expect(screen.getByText('Brand i industriområde')).toBeInTheDocument();
    });
    expect(screen.getByText('Inga uppgifter är tilldelade till dig')).toBeInTheDocument();
    expect(screen.getByText('Inga kommande briefningar')).toBeInTheDocument();
    expect(screen.getByText('Inga loggposter')).toBeInTheDocument();
    expect(screen.getByText('Inga avläsningar')).toBeInTheDocument();
    expect(screen.getByText('Ingenting kräver din uppmärksamhet')).toBeInTheDocument();
  });
});
