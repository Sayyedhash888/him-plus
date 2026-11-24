import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isUpdateNewer } from '../shared/version.ts';

test('compareVersions orders numeric versions', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
  assert.equal(compareVersions('v1.2.3', '1.2.2'), 1);
  assert.equal(compareVersions('garbage', '0.0.1'), -1);
});

test('isUpdateNewer only flags strictly newer releases', () => {
  assert.equal(isUpdateNewer('0.1.0', '0.1.1'), true);
  assert.equal(isUpdateNewer('0.1.1', '0.1.1'), false);
  assert.equal(isUpdateNewer('0.2.0', '0.1.9'), false);
});
