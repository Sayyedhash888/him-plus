import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseFocusFrame,
  columnKind,
  formatCompact,
  formatPercent,
  numericBins,
  numericStats,
  topValues,
} from '../src/lib/notebook/frameProfile.ts';

test('columnKind classifies common pandas dtypes', () => {
  assert.equal(columnKind('int64'), 'number');
  assert.equal(columnKind('float64'), 'number');
  assert.equal(columnKind('bool'), 'boolean');
  assert.equal(columnKind('datetime64[ns]'), 'datetime');
  assert.equal(columnKind('object'), 'text');
  assert.equal(columnKind('category'), 'text');
});

test('numericBins buckets captured numeric values', () => {
  assert.deepEqual(numericBins([0, 1, 2, 3], 2), [2, 2]);
  assert.deepEqual(numericBins([5, 5, 5], 4), [3, 0, 0, 0]);
  assert.deepEqual(numericBins([], 3), [0, 0, 0]);
});

test('numericStats computes mean and standard deviation', () => {
  const stats = numericStats(['1', 2, 3, null]);
  assert.equal(stats.count, 3);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 3);
  assert.equal(stats.mean, 2);
  assert.ok(Math.abs((stats.std ?? 0) - Math.sqrt(2 / 3)) < 1e-9);
});

test('topValues orders by count and skips nulls', () => {
  assert.deepEqual(topValues(['b', 'a', 'b', null, 'c', 'b'], 2), [
    { value: 'b', count: 3 },
    { value: 'a', count: 1 },
  ]);
});

test('chooseFocusFrame prefers the newest frame, else the last one', () => {
  assert.equal(chooseFocusFrame(['a', 'b'], []), 'a');
  assert.equal(chooseFocusFrame(['a', 'b'], ['a']), 'b');
  assert.equal(chooseFocusFrame(['a', 'b'], ['a', 'b']), 'b');
  assert.equal(chooseFocusFrame([], ['a']), null);
});

test('formatCompact and formatPercent render readable stats', () => {
  assert.equal(formatCompact(1530), '1.53K');
  assert.equal(formatCompact(2_500_000), '2.50M');
  assert.equal(formatCompact('3.5'), '3.500');
  assert.equal(formatCompact(null), '—');
  assert.equal(formatPercent(1, 4), '25%');
});
