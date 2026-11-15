// Dashboard tests — M32
//
// The chief-of-staff dashboard renders every widget from the incident's
// local records (seeded into the mock Dexie store) via the pure selectors
// in @stabsstod/shared. Acceptance: "dashboard renders from fixtures".

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import { Dashboard, type DashboardMember } from './Dashboard.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type EntityType, type RecordEnvelope } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m32';

const FUNCTIONS = [
  { id: 'fn-1', name: 'Ledning' },
  { id: 'fn-2', name: 'Logistik' },
];

const MEMBERS: DashboardMember[] = [
  { userId: 'user-lead', userName: 'Anna Ledare', functionIds: ['fn-1'] },
  { userId: 'user-2', userName: 'Bo Medlem', functionIds: ['fn-2'] },
  { userId: 'user-3', userName: 'Gunnar Går Hem', functionIds: ['fn-2'] },
];

// Incident started 2 h 30 s "ago": elapsed time reads 02:00:xx at render.
const STARTED_AT = new Date(Date.now() - (2 * 3600 + 30) * 1000).toISOString();
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
): Promise<RecordEnvelope> {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId,
    authorId: 'user-2',
    deviceId: getDeviceId(),
    schemaVersion: 1,
    payload,
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    state,
  });
  saveHlcState(next, getDeviceId());
  await store.ingestRemoteRecords([record]);
  return record;
}

function renderDashboard(store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Dashboard
          store={store}
          incidentId={INCIDENT}
          functions={FUNCTIONS}
          members={MEMBERS}
          incident={{ id: INCIDENT, name: 'Brand i industriområde', startedAt: STARTED_AT, status: 'active' }}
          me={{ userId: 'user-2', functionIds: ['fn-1'] }}
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

describe('Dashboard (M32)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders every widget from seeded local records', async () => {
    const store = makeStore('user-m32-1');

    // Mission + direction (diverged).
    await seed(store, 'entity-mission', 'mission', {
      content: 'Säkerställ evakuering',
      staffShouldDo: 'Skydda liv',
      issuedBy: 'user-1',
    });
    await seed(store, 'entity-direction', 'direction', {
      desired: 'Evakuera säkert',
      actual: 'Evakuering pågår',
      divergenceNote: 'Vidare evakuering pågår',
      validFrom: inMin(-120),
    });

    // Next briefing in ~60 min + a briefing report with a challenge (fn-1).
    await seed(store, 'briefing-1', 'briefing', {
      title: 'Dagsbrief',
      scheduledAt: inMin(60),
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
        done: 'Evakuerat zon A',
        planned: 'Evakuera zon B',
        challenges: 'Vattenbrist',
        collaborationNeeds: '',
      },
      'fn-1',
    );

    // Shifts: fn-1 lead on duty now; a start and an end inside the 4 h window.
    await seed(store, 'shift-lead', 'shift', {
      functionId: 'fn-1',
      userId: 'user-lead',
      role: 'function_lead',
      start: inMin(-60),
      end: inMin(480),
    });
    await seed(store, 'shift-start', 'shift', {
      functionId: 'fn-2',
      userId: 'user-2',
      role: 'staff_member',
      start: inMin(30),
      end: inMin(330),
    });
    await seed(store, 'shift-end', 'shift', {
      functionId: 'fn-2',
      userId: 'user-3',
      role: 'function_lead',
      start: inMin(-360),
      end: inMin(120),
    });

    // Tasks: one open (fn-1), one overdue (fn-2).
    await seed(store, 'task-open', 'task', {
      title: 'Uppgift A',
      description: '',
      assigneeFunctionId: 'fn-1',
      due: inMin(60),
      priority: 'normal',
      status: 'doing',
      reportForm: 'oral',
    });
    await seed(store, 'task-overdue', 'task', {
      title: 'Sen uppgift',
      description: '',
      assigneeFunctionId: 'fn-2',
      due: inMin(-60),
      priority: 'normal',
      status: 'todo',
      reportForm: 'none',
    });

    // Log entries.
    await seed(store, 'log-1', 'log_entry', {
      text: 'Ett',
      category: 'info',
      eventTime: inMin(-5),
      source: '',
      visibility: 'incident',
    });
    await seed(store, 'log-2', 'log_entry', {
      text: 'Två',
      category: 'event',
      eventTime: inMin(-10),
      source: '',
      visibility: 'incident',
    });

    // Facts: 1 verified, 2 assumptions (oldest first), 1 info need.
    await seed(store, 'fact-verified', 'fact_item', { text: 'Kontrollerat', status: 'verified' });
    await seed(store, 'fact-a1', 'fact_item', { text: 'Gammalt antagande', status: 'assumption' });
    await seed(store, 'fact-a2', 'fact_item', { text: 'Nytt antagande', status: 'assumption' });
    await seed(store, 'fact-need', 'fact_item', { text: 'Okänd sak', status: 'info_need' });

    // Decision waiting.
    await seed(store, 'decision-1', 'decision_request', {
      question: 'Beslut X?',
      options: [{ title: 'A', pros: ['p'], cons: ['c'] }],
      neededBy: 'fn-1',
      status: 'open',
    });

    // Scenarios for the time-scale strip.
    await seed(store, 'scenario-1', 'scenario', {
      title: 'Snart',
      description: 'd',
      horizon: 'hours',
      likelihood: 'probable',
    });
    await seed(store, 'scenario-2', 'scenario', {
      title: 'Långsikt',
      description: 'd',
      horizon: 'two_weeks',
      likelihood: 'possible',
    });

    // Map feature for the mini map.
    await seed(store, 'feature-1', 'map_feature', {
      label: 'Brandkrets',
      layer: 'situation',
      geometry: { type: 'Point', coordinates: [18.0, 59.3] },
      severity: 'warning',
      validity: 'now',
    });

    renderDashboard(store);

    await waitFor(() => {
      expect(screen.getByText('Brand i industriområde')).toBeInTheDocument();
    });

    // Header: elapsed time ≈ 02:00:xx.
    const elapsed = document.querySelector('[title="Gången tid"]') as HTMLElement | null;
    expect(elapsed).not.toBeNull();
    expect(elapsed!.textContent).toMatch(/^02:/);

    // Mission & direction, with divergence flag.
    expect(screen.getByText('Säkerställ evakuering')).toBeInTheDocument();
    expect(screen.getByText(/Evakuera säkert/)).toBeInTheDocument();
    expect(screen.getByText('Avvikelse från inriktning')).toBeInTheDocument();

    // Next briefing countdown (just under an hour).
    const briefSection = await sectionByTitle('Nästa briefning');
    expect(briefSection.textContent).toContain('Dagsbrief');
    const countdown = briefSection.querySelector('.text-2xl') as HTMLElement;
    expect(countdown.textContent).toMatch(/^00:5\d:/);

    // Shift changes inside the 4 h window.
    const shiftSection = await sectionByTitle('Vaktskiffteringar (nästa 4 h)');
    expect(shiftSection.textContent).toContain('Börjar');
    expect(shiftSection.textContent).toContain('Slutar');
    expect(shiftSection.textContent).toContain('Logistik');

    // Function status board: leads, open/overdue counts, challenge, RAG.
    const fnSection = await sectionByTitle('Funktioners status');
    const rows = fnSection.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    // Sorted by function name: Ledning first, Logistik second.
    const ledning = rows[0].querySelectorAll('td');
    expect(ledning[0].textContent).toBe('Ledning');
    expect(ledning[1].textContent).toBe('Anna Ledare');
    expect(ledning[2].textContent).toBe('1'); // open tasks
    expect(ledning[3].textContent).toBe('0'); // overdue tasks
    expect(ledning[5].textContent).toBe('Vattenbrist');
    const logistik = rows[1].querySelectorAll('td');
    expect(logistik[0].textContent).toBe('Logistik');
    expect(logistik[2].textContent).toBe('1'); // open tasks
    expect(logistik[3].textContent).toBe('1'); // overdue tasks
    // Ledning: lead on duty + open task → amber. Logistik: overdue task → red.
    expect(screen.getAllByLabelText('Gul').length).toBe(1);
    expect(screen.getAllByLabelText('Röd').length).toBe(1);

    // Log entries.
    const logSection = await sectionByTitle('Senaste händelser');
    expect(logSection.textContent).toContain('Ett');
    expect(logSection.textContent).toContain('Två');

    // Fact counts + oldest unverified assumption.
    const factsSection = await sectionByTitle('Fakta / Antaganden / Okänt');
    const factNums = factsSection.querySelectorAll('p.text-2xl');
    expect(factNums[0]?.textContent).toBe('1');
    expect(factNums[1]?.textContent).toBe('2');
    expect(factNums[2]?.textContent).toBe('1');
    expect(factsSection.textContent).toContain('Gammalt antagande');

    // Decisions waiting.
    expect(screen.getByText(/Beslut X\?/)).toBeInTheDocument();

    // Overdue tasks widget.
    const overdueSection = await sectionByTitle('Försenade uppgifter');
    expect(overdueSection.textContent).toContain('Sen uppgift');

    // Time-scale strip.
    const stripSection = await sectionByTitle('Tidsperspektiv');
    expect(stripSection.textContent).toContain('Snart');
    expect(stripSection.textContent).toContain('Långsikt');

    // Mini map: the feature label is projected into the SVG.
    const minimapSection = await sectionByTitle('Mini-karta');
    const svgLabel = minimapSection.querySelector('svg text');
    expect(svgLabel?.textContent).toBe('Brandkrets');
  });

  it('shows sync health from the outbox and conflict count', async () => {
    const store = makeStore('user-m32-2');

    // Two head versions of the same entity → one conflict.
    const a = await seed(store, 'entity-conflict', 'log_entry', {
      text: 'v1',
      category: 'info',
      eventTime: inMin(-1),
      source: '',
      visibility: 'incident',
    });
    await seed(store, 'entity-conflict', 'log_entry', {
      text: 'v2',
      category: 'info',
      eventTime: inMin(-1),
      source: '',
      visibility: 'incident',
    });

    // Two pending and one rejected outbox entry (addLocalRecord → pending).
    await store.addLocalRecord(a);
    const pending2 = await seed(store, 'log-pending2', 'log_entry', {
      text: 'p2',
      category: 'info',
      eventTime: inMin(-1),
      source: '',
      visibility: 'incident',
    });
    await store.addLocalRecord(pending2);
    const pending3 = await seed(store, 'log-pending3', 'log_entry', {
      text: 'p3',
      category: 'info',
      eventTime: inMin(-1),
      source: '',
      visibility: 'incident',
    });
    await store.addLocalRecord(pending3);
    await store.markOutboxRejected(a.id, 'test');

    renderDashboard(store);

    await waitFor(() => {
      expect(screen.getByText('Synkstatus')).toBeInTheDocument();
    });
    const syncSection = screen.getByText('Synkstatus').closest('section') as HTMLElement;
    const nums = syncSection.querySelectorAll('p.text-2xl');
    expect(nums[0]?.textContent).toBe('1'); // conflicts
    expect(nums[1]?.textContent).toBe('1'); // rejected
    expect(nums[2]?.textContent).toBe('2'); // pending
  });

  it('shows empty states for an incident with no records', async () => {
    const store = makeStore('user-m32-3');
    renderDashboard(store);

    await waitFor(() => {
      expect(screen.getByText('Brand i industriområde')).toBeInTheDocument();
    });
    expect(screen.getByText('Inget uppdrag')).toBeInTheDocument();
    expect(screen.getByText('Ingen inriktning')).toBeInTheDocument();
    expect(screen.getByText('Inga kommande briefningar')).toBeInTheDocument();
    expect(screen.getByText('Inga kartobjekt')).toBeInTheDocument();
  });
});
