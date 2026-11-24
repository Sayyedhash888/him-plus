import { diffLines } from 'diff';
import { sanitizeInlineOutput } from './inlineValidation';

export interface ChangeStat {
  added: number;
  removed: number;
}

export interface DiffRow {
  type: 'context' | 'add' | 'remove';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function changeStat(before: string, after: string): ChangeStat {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const count = part.count ?? part.value.split('\n').length;
    if (part.added) added += count;
    else if (part.removed) removed += count;
  }
  return { added, removed };
}

export function buildDiffRows(before: string, after: string, maxRows = 320): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of diffLines(before, after)) {
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) {
      if (part.added) {
        rows.push({ type: 'add', text, newLine });
        newLine += 1;
      } else if (part.removed) {
        rows.push({ type: 'remove', text, oldLine });
        oldLine += 1;
      } else {
        rows.push({ type: 'context', text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
    if (rows.length > maxRows) break;
  }
  return rows.slice(0, maxRows);
}

export function compactDiffPreview(before: string, after: string, maxRows = 80): DiffRow[] {
  const rows = buildDiffRows(before, after, 2000);
  const interesting = rows.filter((row) => row.type !== 'context');
  if (interesting.length === 0) return rows.slice(0, maxRows);
  return interesting.slice(0, maxRows);
}

export function normalizeInlineResult(raw: string): string {
  return sanitizeInlineOutput(raw);
}

export function countDiffRows(rows: DiffRow[]): ChangeStat {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === 'add') added += 1;
    else if (row.type === 'remove') removed += 1;
  }
  return { added, removed };
}
