import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NotebookDataFrame } from '../shared/types.ts';
import {
  describeStep,
  generateWrangleCode,
  previewSteps,
  type WrangleStep,
} from '../src/lib/notebook/wrangle.ts';

const frame: NotebookDataFrame = {
  columns: [
    { name: 'actor', dtype: 'object', nulls: 0, unique: 3 },
    { name: 'year', dtype: 'int64', nulls: 0, unique: 3 },
    { name: 'score', dtype: 'float64', nulls: 1, unique: 2 },
  ],
  rows: [
    ['A', 2023, 7.5],
    ['B', 2017, 8],
    ['C', 1999, null],
  ],
  shape: [3, 3],
  index: ['0', '1', '2'],
};

test('filters rows and generates matching pandas code', () => {
  const steps: WrangleStep[] = [
    { kind: 'filter', column: 'year', operator: '>', value: '2000' },
  ];
  const preview = previewSteps(frame, steps);
  assert.deepEqual(preview.columns, ['actor', 'year', 'score']);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.removed, 1);
  const code = generateWrangleCode('df', frame, steps);
  assert.ok(code);
  assert.match(code, /_wrangled = df\.copy\(\)/);
  assert.match(code, /_wrangled = _wrangled\[_wrangled\["year"\] > 2000\]/);
  assert.match(code, /\n_wrangled$/);
});

test('string contains filter uses pandas str accessor', () => {
  const steps: WrangleStep[] = [
    { kind: 'filter', column: 'actor', operator: 'contains', value: 'b' },
  ];
  const preview = previewSteps(frame, steps);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0][0], 'B');
  const code = generateWrangleCode('df', frame, steps) || '';
  assert.match(code, /\.astype\(str\)\.str\.contains\("b", case=False, na=False\)/);
});

test('sorts, keeps and drops columns', () => {
  const steps: WrangleStep[] = [
    { kind: 'sort', column: 'year', direction: 'desc' },
    { kind: 'drop', columns: ['score'] },
  ];
  const preview = previewSteps(frame, steps);
  assert.deepEqual(preview.columns, ['actor', 'year']);
  assert.deepEqual(
    preview.rows.map((row) => row[1]),
    [2023, 2017, 1999],
  );
  const code = generateWrangleCode('df', frame, steps) || '';
  assert.match(code, /sort_values\("year", ascending=False\)/);
  assert.match(code, /\.drop\(columns=\["score"\]\)/);
});

test('dropna removes null rows only in selected columns', () => {
  const steps: WrangleStep[] = [{ kind: 'dropna', columns: ['score'] }];
  const preview = previewSteps(frame, steps);
  assert.equal(preview.rows.length, 2);
  assert.match(generateWrangleCode('df', frame, steps) || '', /dropna\(subset=\["score"\]\)/);
});

test('groupby and value counts preview and code', () => {
  const grouped = previewSteps(frame, [
    { kind: 'groupby', groupColumn: 'actor', valueColumn: 'year', aggregate: 'mean' },
  ]);
  assert.deepEqual(grouped.columns, ['actor', 'mean(year)']);
  assert.equal(grouped.rows.length, 3);

  const counts = previewSteps(frame, [{ kind: 'valuecounts', column: 'year' }]);
  assert.deepEqual(counts.columns, ['year', 'count']);
  assert.equal(counts.rows[0][1], 1);

  assert.match(
    generateWrangleCode('df', frame, [
      { kind: 'groupby', groupColumn: 'actor', valueColumn: null, aggregate: 'count' },
    ]) || '',
    /groupby\("actor"\)\.size\(\)\.reset_index\(name='count'\)/,
  );
});

test('describeStep produces readable labels', () => {
  assert.equal(
    describeStep({ kind: 'filter', column: 'score', operator: '>=', value: '7' }),
    'keep rows where score >= 7',
  );
  assert.equal(
    describeStep({ kind: 'sort', column: 'year', direction: 'desc' }),
    'sort by year ↓',
  );
});
