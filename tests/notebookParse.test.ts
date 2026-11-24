import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotebookFileText } from '../shared/notebookParse.ts';

const valid = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3' } },
  cells: [
    { cell_type: 'code', source: 'print(1)', metadata: {}, outputs: [], execution_count: 1 },
  ],
});

test('parses a valid nbformat 4 notebook', () => {
  const parsed = parseNotebookFileText('main.ipynb', valid);
  assert.equal(parsed.warning, undefined);
  assert.equal(Array.isArray(parsed.raw.cells), true);
  assert.equal((parsed.raw.cells as unknown[]).length, 1);
});

test('strips a UTF-8 BOM before parsing', () => {
  const parsed = parseNotebookFileText('bom.ipynb', `\uFEFF${valid}`);
  assert.equal(Array.isArray(parsed.raw.cells), true);
});

test('opens empty files as a blank notebook with a warning', () => {
  const parsed = parseNotebookFileText('main.ipynb', '   \n');
  assert.match(parsed.warning || '', /empty/i);
  assert.deepEqual(parsed.raw, {});
});

test('reports invalid JSON with the file name and reason', () => {
  assert.throws(
    () => parseNotebookFileText('broken.ipynb', '{not json'),
    /broken\.ipynb" is not valid notebook JSON/,
  );
});

test('rejects JSON that is not a notebook', () => {
  assert.throws(
    () => parseNotebookFileText('thing.ipynb', '{"hello": "world"}'),
    /missing the "cells" array/,
  );
});

test('converts an nbformat 3 notebook to nbformat 4 cells', () => {
  const parsed = parseNotebookFileText(
    'old.ipynb',
    JSON.stringify({
      nbformat: 3,
      metadata: {},
      worksheets: [
        {
          cells: [
            { cell_type: 'code', input: ['print(1)'], outputs: [{ output_type: 'stream', text: '1\n' }] },
            { cell_type: 'markdown', source: '# Title' },
          ],
        },
      ],
    }),
  );
  assert.match(parsed.warning || '', /nbformat 3/i);
  assert.equal(parsed.raw.nbformat, 4);
  const cells = parsed.raw.cells as Array<Record<string, unknown>>;
  assert.equal(cells.length, 2);
  assert.equal(cells[0].cell_type, 'code');
  assert.equal(cells[0].source, 'print(1)');
  assert.equal(cells[1].cell_type, 'markdown');
  assert.equal(cells[1].source, '# Title');
});
