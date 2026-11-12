// ScenarioBoard tests — M19
//
// Grouping by horizon × likelihood (via groupScenarios, pure in shared);
// create/edit (edit = new version with previous head as parent); retract
// with mandatory reason hides the scenario from the grid.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import ScenarioBoard from './ScenarioBoard.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, groupScenarios } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m19';

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

async function seedScenario(
  store: LocalStore,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType: 'scenario',
    incidentId: INCIDENT,
    parentIds: [],
    functionId: null,
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

async function seedTask(
  store: LocalStore,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType: 'task',
    incidentId: INCIDENT,
    parentIds: [],
    functionId: null,
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

const baseScenario = {
  description: 'Resurser tar slut',
  likelihood: 'probable',
  protectedValues: [],
};

describe('ScenarioBoard', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the empty state when there are no scenarios', async () => {
    const store = makeStore('user-m19-0');
    render(
      <I18nextProvider i18n={i18n}>
        <ScenarioBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Inga scenarier än.')).toBeInTheDocument();
    });
  });

  it('groups seeded scenarios under horizon headings and likelihood columns', async () => {
    const store = makeStore('user-m19-1');
    await seedScenario(store, 'scenario-1', {
      ...baseScenario,
      title: 'Troligt inom timmar',
      horizon: 'hours',
      likelihood: 'probable',
    });
    await seedScenario(store, 'scenario-2', {
      ...baseScenario,
      title: 'Möjligt på 2 veckor',
      horizon: 'two_weeks',
      likelihood: 'possible',
    });

    render(
      <I18nextProvider i18n={i18n}>
        <ScenarioBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Troligt inom timmar')).toBeInTheDocument();
    });
    // Horizon headings + likelihood column labels.
    expect(screen.getByText('Timmar')).toBeInTheDocument();
    expect(screen.getByText('2 veckor')).toBeInTheDocument();
    expect(screen.getAllByText('Troliga').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Möjliga').length).toBeGreaterThan(0);
    expect(screen.getByText('Möjligt på 2 veckor')).toBeInTheDocument();
  });

  it('creates a scenario via the form and it lands in the right cell', async () => {
    const store = makeStore('user-m19-2');
    render(
      <I18nextProvider i18n={i18n}>
        <ScenarioBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Inga scenarier än.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Nytt scenario' }));

    fireEvent.change(screen.getByPlaceholderText('Titel'), {
      target: { value: 'Elavbrott i regionen' },
    });
    fireEvent.change(screen.getByPlaceholderText('Beskrivning'), {
      target: { value: 'Vitala funktioner tappar ström' },
    });
    // Horizon defaults to 2 dygn, likelihood to Troliga — save directly.
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const records = await store.getRecordsByIncident(INCIDENT);
      expect(records.filter((r) => r.entityType === 'scenario').length).toBe(1);
    });

    await waitFor(() => {
      expect(screen.getByText('Elavbrott i regionen')).toBeInTheDocument();
      expect(screen.getByText('2 dygn')).toBeInTheDocument();
    });

    // In the outbox, waiting to sync.
    const pending = await store.getPendingOutbox();
    expect(pending.some((e) => e.record.entityType === 'scenario')).toBe(true);
  });

  it('editing creates a new version with the previous head as parent', async () => {
    const store = makeStore('user-m19-3');
    const first = await seedScenario(store, 'scenario-edit', {
      ...baseScenario,
      title: 'Ursprunglig titel',
      horizon: 'two_days',
    });

    render(
      <I18nextProvider i18n={i18n}>
        <ScenarioBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Ursprunglig titel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Redigera' }));

    const titleInput = screen.getByDisplayValue('Ursprunglig titel') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Uppdaterad titel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('scenario-edit');
      expect(records.length).toBe(2);
      const second = records.find((r) => r.id !== first.id)!;
      expect(second.kind).toBe('put');
      expect(second.parentIds).toContain(first.id);
      expect((second.payload as { title: string }).title).toBe('Uppdaterad titel');
    });

    await waitFor(() => {
      expect(screen.getByText('Uppdaterad titel')).toBeInTheDocument();
    });
  });

  it('retracting with a reason removes the scenario from the grid', async () => {
    const store = makeStore('user-m19-4');
    const first = await seedScenario(store, 'scenario-retract', {
      ...baseScenario,
      title: 'Scenarie att ta bort',
      horizon: 'hours',
    });

    render(
      <I18nextProvider i18n={i18n}>
        <ScenarioBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Scenarie att ta bort')).toBeInTheDocument();
    });

    // Row-level retract button (labelled like history.retract) opens dialog.
    const retractButtons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent === 'Återkalla');
    expect(retractButtons.length).toBeGreaterThan(0);
    fireEvent.click(retractButtons[0]);

    // Confirm is disabled until a reason is entered.
    fireEvent.change(screen.getByPlaceholderText('Anledning'), {
      target: { value: 'Bedöms inte längre aktuell' },
    });
    // The dialog's confirm button is the last "Återkalla" button in the DOM
    // (the row button comes first).
    const confirms = screen.getAllByText('Återkalla');
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('scenario-retract');
      expect(records.length).toBe(2);
      const retract = records.find((r) => r.kind === 'retract')!;
      expect((retract.payload as { reason: string }).reason).toBe(
        'Bedöms inte längre aktuell',
      );
      expect(retract.parentIds).toContain(first.id);
    });

    await waitFor(() => {
      expect(screen.queryByText('Scenarie att ta bort')).toBeNull();
      expect(screen.getByText('Inga scenarier än.')).toBeInTheDocument();
    });
  });

  it('groupScenarios keeps fixed horizon order for a full grid', () => {
    const items = [
      { title: 'c', horizon: 'custom' as const, likelihood: 'possible' as const },
      { title: 'h', horizon: 'hours' as const, likelihood: 'probable' as const },
      { title: 'd', horizon: 'two_days' as const, likelihood: 'possible' as const },
      { title: 'w', horizon: 'two_weeks' as const, likelihood: 'probable' as const },
    ];
    const groups = groupScenarios(items);
    expect(groups.map((g) => g.horizon)).toEqual(['hours', 'two_days', 'two_weeks', 'custom']);
  });

  it('resolves the scenario task link to a button that reports the task id', async () => {
    const store = makeStore('user-m19-5');
    await seedTask(store, 'task-sc-1', {
      title: 'Beställ reservdiesel',
      description: 'Tank 2000 l',
      assigneeFunctionId: 'fn-1',
      priority: 'normal',
      status: 'todo',
      reportForm: 'none',
    });
    await seedScenario(store, 'scenario-task-link', {
      ...baseScenario,
      title: 'Reservkraft pågradering',
      horizon: 'hours',
      likelihood: 'probable',
      taskId: 'task-sc-1',
    });

    const onTaskClick = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ScenarioBoard
          store={store}
          incidentId={INCIDENT}
          authorId="user-1"
          onTaskClick={onTaskClick}
        />
      </I18nextProvider>,
    );

    // The link renders as a button labelled with the resolved task title.
    const link = await screen.findByRole('button', { name: 'Beställ reservdiesel' });
    fireEvent.click(link);
    expect(onTaskClick).toHaveBeenCalledWith('task-sc-1');
  });
});
