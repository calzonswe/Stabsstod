// EntityHistory tests — M14

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';
import { EntityHistory } from './EntityHistory.tsx';
import type { RecordEnvelope } from '@stabsstod/shared';

function makeHistoryRecord(
  id: string,
  entityId: string,
  authorId: string,
  hlc: string,
  kind: 'put' | 'retract' = 'put',
  payload: Record<string, unknown> = { text: 'test' },
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
    kind,
    schemaVersion: 1,
    payload,
  };
}

describe('EntityHistory', () => {
  const history: RecordEnvelope[] = [
    makeHistoryRecord(
      'rec-1',
      'entity-1',
      'author-1',
      '000000000000001-00001-device-1',
      'put',
      { text: 'First version', category: 'info', eventTime: new Date().toISOString(), visibility: 'incident' },
    ),
    makeHistoryRecord(
      'rec-2',
      'entity-1',
      'author-2',
      '000000000000002-00001-device-2',
      'put',
      { text: 'Second version', category: 'info', eventTime: new Date().toISOString(), visibility: 'incident' },
    ),
    makeHistoryRecord(
      'rec-3',
      'entity-1',
      'author-1',
      '000000000000003-00001-device-1',
      'retract',
      { reason: 'Superseded' },
    ),
  ];

  it('renders nothing when closed', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <EntityHistory entityId="entity-1" history={history} isOpen={false} onClose={vi.fn()} />
      </I18nextProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders all history records when open', () => {
    const onClose = vi.fn();
    const { getAllByText, getByText } = render(
      <I18nextProvider i18n={i18n}>
        <EntityHistory entityId="entity-1" history={history} isOpen={true} onClose={onClose} />
      </I18nextProvider>,
    );

    expect(getByText('Versionshistorik')).toBeInTheDocument();
    expect(getAllByText('Spara').length).toBe(2);
    expect(getAllByText('Återkalla').length).toBe(1);
    expect(getAllByText('author-1').length).toBe(2);
    expect(getAllByText('author-2').length).toBe(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <EntityHistory entityId="entity-1" history={history} isOpen={true} onClose={onClose} />
      </I18nextProvider>,
    );

    const closeBtn = container.querySelector('[data-testid="close-history"]');
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
