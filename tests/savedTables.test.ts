import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NotebookCell } from '../shared/types.ts';
import { extractSavedFrames, parseHtmlTables } from '../src/lib/notebook/savedTables.ts';

const html = `<div><table border="1" class="dataframe">
  <thead><tr><th></th><th>status</th><th>ttft_ms</th></tr></thead>
  <tbody>
    <tr><th>0</th><td>active</td><td>183.5</td></tr>
    <tr><th>1</th><td>failed</td><td>246.02</td></tr>
    <tr><th>2</th><td>failed</td><td>NaN</td></tr>
  </tbody>
</table></div>`;

test('parseHtmlTables extracts columns, rows and index', () => {
  const [table] = parseHtmlTables(html);
  assert.deepEqual(table.columns, ['status', 'ttft_ms']);
  assert.deepEqual(table.rows, [
    ['active', '183.5'],
    ['failed', '246.02'],
    ['failed', 'NaN'],
  ]);
  assert.deepEqual(table.index, ['0', '1', '2']);
});

test('decodes HTML entities', () => {
  const [table] = parseHtmlTables(
    '<table><thead><tr><th></th><th>a &amp; b</th></tr></thead><tbody><tr><td>1 &lt; 2</td></tr></tbody></table>',
  );
  assert.equal(table.columns[0], 'a & b');
  assert.equal(table.rows[0][0], '1 < 2');
});

function cell(source: string, htmlOutput: string): NotebookCell {
  return {
    id: 'cell-1',
    cellType: 'code',
    source,
    outputs: [
      {
        type: 'result',
        data: { 'text/html': htmlOutput },
        executionCount: 3,
      },
    ],
  };
}

test('extractSavedFrames rebuilds a dataframe with inferred numeric stats', () => {
  const frames = extractSavedFrames(cell('df_summary = df_runs.groupby("status").size()', html));
  const frame = frames.df_summary;
  assert.ok(frame);
  assert.deepEqual(frame.columns.map((column) => column.name), ['status', 'ttft_ms']);
  assert.equal(frame.shape[0], 3);
  const ttft = frame.columns[1];
  assert.equal(ttft.dtype, 'float64');
  assert.equal(ttft.nulls, 1);
  assert.equal(ttft.min, 183.5);
  assert.equal(frame.rows[1][1], 246.02);
});

test('extractSavedFrames ignores non-table outputs', () => {
  const frames = extractSavedFrames({
    id: 'cell-2',
    cellType: 'code',
    source: 'print("hi")',
    outputs: [{ type: 'stream', name: 'stdout', text: 'hi\n' }],
  });
  assert.deepEqual(frames, {});
});
