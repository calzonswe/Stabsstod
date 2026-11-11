// ConflictBanner tests — M14
//
// Renders both heads side by side and verifies the "Use this version"
// action calls onMerge with the selected head and all heads.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';
import { ConflictBanner } from './ConflictBanner.tsx';
import { newRecord, hlcInitialState, type EntityType, type RecordEnvelope } from '@stabsstod/shared';

function makeHead(
  id: string,
  entityId: string,
  authorId: string,
  hlc: string,
  payload: Record<string, unknown>,
): RecordEnvelope {
  return {
    id,
    entityId,
    entityType: 'log_entry',
    incidentId: 'incident-1',
    parentIds: [],
    functionId: null,
    authorId,
    deviceId: 'device-1',
    hlc,
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    schemaVersion: 1,
    payload,
  };
}

describe('ConflictBanner', () => {
  const heads: RecordEnvelope[] = [
    makeHead(
      'head-a',
      'entity-1',
      'author-1',
      '000000000000001-00001-device-1',
      { text: 'First version', category: 'info', eventTime: new Date().toISOString(), visibility: 'incident' },
    ),
    makeHead(
      'head-b',
      'entity-1',
      'author-2',
      '000000000000002-00001-device-2',
      { text: 'Second version', category: 'info', eventTime: new Date().toISOString(), visibility: 'incident' },
    ),
  ];

  const current = heads[1];

  it('renders both heads side by side', () => {
    const onMerge = vi.fn();
    const { getByText } = render(
      <I18nextProvider i18n={i18n}>
        <ConflictBanner entityId="entity-1" heads={heads} current={current} onMerge={onMerge} />
      </I18nextProvider>,
    );

    expect(getByText('Konflikt')).toBeInTheDocument();
    expect(getByText('Flera versioner finns för denna entitet')).toBeInTheDocument();
    expect(getByText('author-1')).toBeInTheDocument();
    expect(getByText('author-2')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(2);
    expect(buttons.some(b => b.textContent === 'Nuvarande version')).toBe(true);
    expect(buttons.some(b => b.textContent === 'Använd denna version')).toBe(true);
  });

  it('shows current version with indigo styling', () => {
    const onMerge = vi.fn();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ConflictBanner entityId="entity-1" heads={heads} current={current} onMerge={onMerge} />
      </I18nextProvider>,
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    // head-a (index 0) is NOT current -> bg-slate-100
    expect(buttons[0].className).toContain('bg-slate-100');
    expect(buttons[0].textContent).toBe('Använd denna version');
    // head-b (index 1) IS current -> bg-indigo-600
    expect(buttons[1].className).toContain('bg-indigo-600');
    expect(buttons[1].textContent).toBe('Nuvarande version');
  });

  it('calls onMerge with selected head and all heads', async () => {
    const onMerge = vi.fn();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ConflictBanner entityId="entity-1" heads={heads} current={current} onMerge={onMerge} />
      </I18nextProvider>,
    );

    const buttons = container.querySelectorAll('button');
    // head-a (index 0) is the "Use this version" button
    await fireEvent.click(buttons[0]);

    expect(onMerge).toHaveBeenCalledWith(heads[0], heads);
  });

  it('shows merging state while merging', async () => {
    let resolveMerge: (() => void) | null = null;
    const mergePromise = new Promise<void>((resolve) => {
      resolveMerge = resolve;
    });
    const onMerge = vi.fn(() => mergePromise);
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ConflictBanner entityId="entity-1" heads={heads} current={current} onMerge={onMerge} />
      </I18nextProvider>,
    );

    const buttons = container.querySelectorAll('button');
    await fireEvent.click(buttons[0]);

    expect(screen.getByText('Slår samman...')).toBeInTheDocument();

    resolveMerge!();
    await mergePromise;
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(screen.queryByText('Slår samman...')).not.toBeInTheDocument();
  });

  it('merge record parentIds contains all heads', () => {
    const state = hlcInitialState();
    const selectedHead = heads[0];

    const { record } = newRecord({
      entityId: selectedHead.entityId,
      entityType: selectedHead.entityType as EntityType,
      incidentId: selectedHead.incidentId,
      parentIds: heads.map((h) => h.id),
      functionId: null,
      authorId: 'author-1',
      deviceId: 'device-1',
      schemaVersion: 1,
      payload: selectedHead.payload,
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });

    expect(record.parentIds).toEqual(heads.map((h) => h.id));
    expect(record.parentIds.length).toBe(2);
    expect(record.parentIds).toContain('head-a');
    expect(record.parentIds).toContain('head-b');
  });
});
