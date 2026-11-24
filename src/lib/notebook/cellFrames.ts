import type { NotebookDataFrame } from '@shared/types';

/** Stable-ish signature used to detect whether a DataFrame changed after a run. */
export function frameSignature(frame: NotebookDataFrame | null | undefined): string {
  if (!frame) return '';
  const columns = frame.columns
    .map((column) => `${column.name}:${column.dtype}:${column.unique}:${column.nulls}`)
    .join('|');
  return `${frame.shape[0]}x${frame.shape[1]}#${columns}`;
}

/**
 * Returns the frames produced/updated by a cell, so the notebook can render them
 * inline under that cell instead of dumping every captured DataFrame everywhere.
 */
export function selectCellFrames(
  previous: Record<string, NotebookDataFrame> | null,
  next: Record<string, NotebookDataFrame> | null,
): Record<string, NotebookDataFrame> {
  if (!next) return {};
  const result: Record<string, NotebookDataFrame> = {};
  for (const [name, frame] of Object.entries(next)) {
    const before = previous?.[name];
    if (!before || frameSignature(before) !== frameSignature(frame)) {
      result[name] = frame;
    }
  }
  return result;
}
