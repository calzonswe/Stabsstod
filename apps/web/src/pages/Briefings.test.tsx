// Briefings tests — M24
//
// Accept: report form per function. Plus: chief schedules a recurring
// briefing (agenda pre-filled from the template), the countdown shows the
// next planned occurrence and disappears when the briefing is marked held,
// minutes are saved as a new version, retract is append-only with a reason,
// and observers/staff members without the role see no write UI.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Briefings from './Briefings.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type Actor } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m24';
const FUNCTIONS = [
  { id: 'fn-1', name: 'Logistik' },
  { id: 'fn-2', name: 'Fakta' },
];
// Well in the future so the countdown is meaningful regardless of run time.
const FUTURE = '2027-01-01T08:00:00Z';

function actorFor(
  role: Actor['role'],
  functionIds: string[] = ['fn-1'],
): Actor {
  return {
    userId: 'user-1',
    incidentId: INCIDENT,
    role,
    functionIds,
  };
}

function component(
  actor: Actor | null,
  store: LocalStore,
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Briefings
        store={store}
        incidentId={INCIDENT}
        authorId="user-1"
        actor={actor}
        functions={FUNCTIONS}
      />
    </I18nextProvider>,
  );
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: 'briefing' | 'briefing_report',
  payload: Record<string, unknown>,
  functionId: string | null,
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId,
    authorId: 'user-seed',
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

async function seedBriefing(
  store: LocalStore,
  entityId: string,
  title: string,
  scheduledAt: string,
) {
  return seed(store, entityId, 'briefing', {
    title,
    scheduledAt,
    kind: 'recurring',
    agenda: ['Stabschefen ger nulägesbeskrivning'],
    status: 'planned',
  }, null);
}

async function seedReport(
  store: LocalStore,
  briefingId: string,
  functionId: string,
  done: string,
) {
  return seed(store, `br-${functionId}`, 'briefing_report', {
    briefingId,
    done,
    planned: '',
    challenges: '',
    collaborationNeeds: '',
  }, functionId);
}

describe('Briefings (M24)', () => {
  afterEach(() => {
    cleanup();
  });

  it('chief schedules a recurring briefing with the template agenda', async () => {
    const store = new LocalStore({ userId: 'user-m24-0' });
    const { container } = component(actorFor('chief_of_staff'), store);

    // The schedule form is visible for the chief.
    const titleInput = await screen.findByPlaceholderText(
      't.ex. Stabsorientering',
    );
    fireEvent.change(titleInput, { target: { value: 'Stabsorientering' } });

    // The agenda is pre-filled from the recurring template (kind default).
    const agenda = screen.getByPlaceholderText(
      'Agendapunkter, en per rad',
    ) as HTMLTextAreaElement;
    expect(agenda.value).toContain(
      'Stabschefen ger nulägesbeskrivning',
    );

    // Set a future time and enable recurrence with maxCount 3.
    const timeInputs = container.querySelectorAll(
      'input[type="datetime-local"]',
    );
    fireEvent.change(timeInputs[0] as HTMLInputElement, {
      target: { value: '2027-01-01T08:00' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Repeteras i rörelse' }));
    const numberInputs = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numberInputs[1] as HTMLInputElement, {
      target: { value: '3' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    // The briefing card appears…
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Stabsorientering' }),
      ).toBeInTheDocument();
    });

    // …and the record carries the recurrence.
    const records = await store.getRecordsByIncident(INCIDENT);
    const put = records.find(
      (r) => r.entityType === 'briefing' && r.kind === 'put',
    );
    expect(put).toBeDefined();
    const payload = put!.payload as {
      title: string;
      agenda: string[];
      status: string;
      recurrence?: { intervalHours: number; maxCount?: number };
    };
    expect(payload.title).toBe('Stabsorientering');
    expect(payload.status).toBe('planned');
    expect(payload.agenda[0]).toBe(
      'Stabschefen ger nulägesbeskrivning',
    );
    expect(payload.recurrence).toEqual({ intervalHours: 2, maxCount: 3 });

    // The countdown shows the next planned occurrence.
    expect(screen.getByText('Nästa stabsorientering')).toBeInTheDocument();
  });

  it('staff member fills the report form for own function only', async () => {
    const store = new LocalStore({ userId: 'user-m24-1' });
    await seedBriefing(store, 'bf-1', 'Stabsorientering', FUTURE);
    const { container } = component(actorFor('staff_member'), store);

    // No schedule form for staff_member…
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Schemalägg stabsorientering' }),
      ).toBeNull();
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Stabsorientering' }),
      ).toBeInTheDocument();
    });

    // …but a report form for own function (fn-1), not fn-2.
    expect(
      screen.getByText('Min rapport — Logistik'),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-testid="report-fn-2-done"]')).toBeNull();

    const done = container.querySelector(
      '[data-testid="report-fn-1-done"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(done, { target: { value: 'Prover tagna' } });
    const planned = container.querySelector(
      '[data-testid="report-fn-1-planned"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(planned, { target: { value: 'Analysera prov' } });
    const challenges = container.querySelector(
      '[data-testid="report-fn-1-challenges"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(challenges, { target: { value: 'Saknar utrustning' } });
    const collab = container.querySelector(
      '[data-testid="report-fn-1-collaborationNeeds"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(collab, { target: { value: 'Behöver labb' } });

    fireEvent.click(screen.getByRole('button', { name: 'Spara rapport' }));

    // The report shows up in the side-by-side grid (scope to `dd`: the form
    // textareas still hold the same values).
    await waitFor(() => {
      expect(
        screen.getByText('Prover tagna', { selector: 'dd' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Analysera prov', { selector: 'dd' }),
    ).toBeInTheDocument();

    // …and the record is a briefing_report for fn-1 linked to the briefing.
    const records = await store.getRecordsByIncident(INCIDENT);
    const put = records.find(
      (r) => r.entityType === 'briefing_report' && r.kind === 'put',
    );
    expect(put).toBeDefined();
    expect(put!.functionId).toBe('fn-1');
    expect(put!.parentIds).toEqual([]);
    const payload = put!.payload as {
      briefingId: string;
      done: string;
      planned: string;
      challenges: string;
      collaborationNeeds: string;
    };
    expect(payload.briefingId).toBe('bf-1');
    expect(payload.done).toBe('Prover tagna');
    expect(payload.planned).toBe('Analysera prov');
    expect(payload.challenges).toBe('Saknar utrustning');
    expect(payload.collaborationNeeds).toBe('Behöver labb');
  });

  it('saving a report twice writes a new version, not a new entity', async () => {
    const store = new LocalStore({ userId: 'user-m24-2' });
    await seedBriefing(store, 'bf-2', 'Stabsorientering', FUTURE);
    const { container } = component(actorFor('staff_member'), store);

    const done = () =>
      container.querySelector(
        '[data-testid="report-fn-1-done"]',
      ) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(done()).not.toBeNull();
    });
    fireEvent.change(done(), { target: { value: 'Första versionen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara rapport' }));
    await waitFor(() => {
      expect(screen.getByText('Första versionen')).toBeInTheDocument();
    });
    fireEvent.change(done(), { target: { value: 'Uppdaterad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara rapport' }));
    await waitFor(() => {
      expect(screen.getByText('Uppdaterad')).toBeInTheDocument();
    });

    const records = (await store.getRecordsByIncident(INCIDENT)).filter(
      (r) => r.entityType === 'briefing_report' && r.kind === 'put',
    );
    expect(records.length).toBe(2);
    const second = records[1];
    expect(second.parentIds).toContain(records[0].id);
    expect((second.payload as { done: string }).done).toBe('Uppdaterad');
  });

  it('chief marks the briefing held and saves minutes (new versions)', async () => {
    const store = new LocalStore({ userId: 'user-m24-3' });
    await seedBriefing(store, 'bf-3', 'Stabsorientering', FUTURE);
    component(actorFor('chief_of_staff'), store);

    // Planned → countdown visible.
    await waitFor(() => {
      expect(screen.getByText('Nästa stabsorientering')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Markera genomförd' }));

    // Held → status badge, countdown gone.
    await waitFor(() => {
      expect(screen.getByText('Genomförd')).toBeInTheDocument();
      expect(screen.queryByText('Nästa stabsorientering')).toBeNull();
    });

    const minutes = screen.getByPlaceholderText(
      'Notera beslut och uppföljningar...',
    ) as HTMLTextAreaElement;
    fireEvent.change(minutes, { target: { value: 'Godkänt.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara protokoll' }));

    // Seed + status version + minutes version (async write — wait for it).
    await waitFor(async () => {
      const records = (await store.getRecordsByIncident(INCIDENT)).filter(
        (r) => r.entityId === 'bf-3' && r.kind === 'put',
      );
      expect(records.length).toBe(3);
      const last = records[records.length - 1];
      expect((last.payload as { status: string }).status).toBe('held');
      expect((last.payload as { minutes: string }).minutes).toBe('Godkänt.');
    });
  });

  it('observer sees the briefing but no write UI', async () => {
    const store = new LocalStore({ userId: 'user-m24-4' });
    await seedBriefing(store, 'bf-4', 'Stabsorientering', FUTURE);
    const { container } = component(actorFor('observer'), store);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Stabsorientering' }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: 'Schemalägg stabsorientering' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Markera genomförd' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Spara rapport' }),
    ).toBeNull();
    expect(
      screen.queryByPlaceholderText('Notera beslut och uppföljningar...'),
    ).toBeNull();
    expect(container.querySelector('[data-testid^="report-"]')).toBeNull();
  });

  it('chief retracts a briefing with a reason (append-only)', async () => {
    const store = new LocalStore({ userId: 'user-m24-5' });
    const put = await seedBriefing(
      store,
      'bf-5',
      'Översyn av stabsarbete',
      FUTURE,
    );
    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Översyn av stabsarbete' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ta bort' }));
    fireEvent.change(screen.getByPlaceholderText('Anledning (obligatorisk)'), {
      target: { value: 'Fel tidpunkt' },
    });
    // Two buttons named "Ta bort" (toggle + confirm); confirm is last.
    const confirmButtons = screen.getAllByRole('button', { name: 'Ta bort' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Översyn av stabsarbete' }),
      ).toBeNull();
    });

    const records = (await store.getRecordsByIncident(INCIDENT)).filter(
      (r) => r.entityId === 'bf-5',
    );
    expect(records.length).toBe(2);
    const retract = records.find((r) => r.kind === 'retract');
    expect(retract).toBeDefined();
    expect((retract!.payload as { reason: string }).reason).toBe(
      'Fel tidpunkt',
    );
    expect(retract!.parentIds).toEqual([put.id]);
  });

  it('an existing seeded report pre-fills the report form', async () => {
    const store = new LocalStore({ userId: 'user-m24-6' });
    await seedBriefing(store, 'bf-6', 'Stabsorientering', FUTURE);
    await seedReport(store, 'bf-6', 'fn-1', 'Prover tagna');
    component(actorFor('staff_member'), store);

    const done = await screen.findByTestId('report-fn-1-done');
    expect((done as HTMLTextAreaElement).value).toBe('Prover tagna');
  });
});
