// fact_item schema tests — M17
//
// The fact_item payload carries a board status (vet/antar/vet ej + refuted)
// and is validated on server ingest. Status transitions are new versions of
// the same entity — history is the caller's job (materialize), validated in
// the web tests.

import { describe, expect, it } from 'vitest';
import { EntityType } from './record.js';
import { validateEntityPayload } from './entityRegistry.js';

const validBase = {
  text: 'Eldslösa i lager 3 under kontroll',
  status: 'verified',
};

describe('fact_item payload schema', () => {
  it('accepts a valid fact with all board statuses', () => {
    for (const status of ['verified', 'assumption', 'info_need', 'refuted']) {
      const result = validateEntityPayload(EntityType.factItem, {
        ...validBase,
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional source and log entry link', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      ...validBase,
      source: ' Räddningstjänsten via radio',
      logEntryId: 'abc-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      ...validBase,
      status: 'maybe',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty text', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      ...validBase,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing status', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      text: 'Ingen status',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object payloads', () => {
    const result = validateEntityPayload(EntityType.factItem, 'not an object');
    expect(result.success).toBe(false);
  });
});
