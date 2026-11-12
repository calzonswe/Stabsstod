// diffLines tests — M18

import { describe, expect, it } from 'vitest';
import { diffLines, renderSnapshotText } from './diff.js';

describe('diffLines', () => {
  it('identical texts → all same lines', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('detects added lines', () => {
    const d = diffLines('a\nc', 'a\nb\nc');
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('detects removed lines', () => {
    const d = diffLines('a\nb\nc', 'a\nc');
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('handles replacement of a line', () => {
    const d = diffLines('old status', 'new status');
    expect(d).toEqual([
      { kind: 'removed', text: 'old status' },
      { kind: 'added', text: 'new status' },
    ]);
  });

  it('handles empty inputs', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'a')).toEqual([{ kind: 'added', text: 'a' }]);
    expect(diffLines('a', '')).toEqual([{ kind: 'removed', text: 'a' }]);
  });

  it('is deterministic for the same inputs', () => {
    const a = 'x\ny\nz\nw';
    const b = 'x\nq\nz\nw';
    expect(diffLines(a, b)).toEqual(diffLines(a, b));
  });
});

describe('renderSnapshotText', () => {
  it('flattens all sections in a stable order', () => {
    const text = renderSnapshotText({
      whatHappened: 'Brand',
      current: 'Släckt',
      consequences: 'Rök',
      fis: { fakta: 'F', innebord: 'I', slutsats: 'S' },
      protectedValues: ['life', 'property'],
    });
    expect(text).toBe(
      'Vad har hänt: Brand\nNuvarande: Släckt\nKonsekvenser: Rök\nFakta: F\nInnebörd: I\nSlutsats: S\nSkyddsvärden: life, property',
    );
  });

  it('skips empty sections', () => {
    expect(renderSnapshotText({ current: 'Endast detta' })).toBe(
      'Nuvarande: Endast detta',
    );
    expect(renderSnapshotText({})).toBe('');
  });
});
