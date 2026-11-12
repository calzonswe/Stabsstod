// Text diff for situation snapshots — plan.md §5 / M18
//
// A small, dependency-free line diff (LCS based) used to show what changed
// between two versions of a situation snapshot. Pure and deterministic.

export type DiffLine = {
  kind: 'same' | 'added' | 'removed';
  text: string;
};

/**
 * Line diff of two texts (split on \n). Trailing newline produces no extra
 * empty line. Classic LCS table — fine for snapshot-sized texts.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const left = a === '' ? [] : a.split('\n');
  const right = b === '' ? [] : b.split('\n');

  const n = left.length;
  const m = right.length;

  // lcs[i][j] = length of LCS of left[i..] and right[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        left[i] === right[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: 'removed', text: left[i] });
      i++;
    } else {
      result.push({ kind: 'added', text: right[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: 'removed', text: left[i] });
    i++;
  }
  while (j < m) {
    result.push({ kind: 'added', text: right[j] });
    j++;
  }
  return result;
}

/**
 * Flatten a snapshot payload to comparable text, section by section — used
 * as input to diffLines when comparing two versions.
 */
export function renderSnapshotText(payload: {
  whatHappened?: string;
  current?: string;
  consequences?: string;
  fis?: { fakta?: string; innebord?: string; slutsats?: string };
  protectedValues?: string[];
}): string {
  const parts: string[] = [];
  if (payload.whatHappened) parts.push(`Vad har hänt: ${payload.whatHappened}`);
  if (payload.current) parts.push(`Nuvarande: ${payload.current}`);
  if (payload.consequences) parts.push(`Konsekvenser: ${payload.consequences}`);
  if (payload.fis) {
    if (payload.fis.fakta) parts.push(`Fakta: ${payload.fis.fakta}`);
    if (payload.fis.innebord) parts.push(`Innebörd: ${payload.fis.innebord}`);
    if (payload.fis.slutsats) parts.push(`Slutsats: ${payload.fis.slutsats}`);
  }
  if (payload.protectedValues && payload.protectedValues.length > 0) {
    parts.push(`Skyddsvärden: ${payload.protectedValues.join(', ')}`);
  }
  return parts.join('\n');
}
