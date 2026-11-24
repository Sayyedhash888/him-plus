import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameSignature, selectCellFrames } from '../src/lib/notebook/cellFrames.ts';
import type { NotebookDataFrame } from '../shared/types.ts';

function frame(rows: number, columns: Array<{ name: string; dtype: string }>): NotebookDataFrame {
  return {
    shape: [rows, columns.length],
    columns: columns.map((column) => ({
      name: column.name,
      dtype: column.dtype,
      nulls: 0,
      unique: rows,
    })),
    rows: [],
    index: [],
  };
}

test('selectCellFrames returns only new or changed frames', () => {
  const previous = {
    df_runs: frame(2500, [{ name: 'run_id', dtype: 'str' }]),
    df_summary: frame(20, [{ name: 'status', dtype: 'str' }]),
  };
  const next = {
    df_runs: frame(2500, [{ name: 'run_id', dtype: 'str' }]),
    df_summary: frame(24, [{ name: 'status', dtype: 'str' }]),
    df_new: frame(3, [{ name: 'x', dtype: 'int64' }]),
  };
  const changed = selectCellFrames(previous, next);
  assert.deepEqual(Object.keys(changed).sort(), ['df_new', 'df_summary']);
});

test('selectCellFrames detects changed columns even with the same shape', () => {
  const previous = { df: frame(10, [{ name: 'a', dtype: 'int64' }]) };
  const next = { df: frame(10, [{ name: 'b', dtype: 'int64' }]) };
  assert.deepEqual(Object.keys(selectCellFrames(previous, next)), ['df']);
});

test('selectCellFrames returns empty when nothing changed or no data', () => {
  assert.deepEqual(selectCellFrames(null, {}), {});
  const one = { df: frame(2, [{ name: 'a', dtype: 'int64' }]) };
  assert.deepEqual(selectCellFrames(one, one), {});
});

test('frameSignature includes shape and column metadata', () => {
  const signature = frameSignature(frame(2, [{ name: 'a', dtype: 'int64' }]));
  assert.match(signature, /^2x1#a:int64/);
  assert.equal(frameSignature(null), '');
});
