import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCopilotSignInResponse,
  parseCopilotStatusNotification,
} from '../shared/copilotAuth.ts';

test('parses the v2 auth status notification with a user', () => {
  const parsed = parseCopilotStatusNotification('didChangeStatus/v2', {
    statuses: [
      { category: 'cls', kind: 'Normal', inactive: false },
      {
        category: 'auth',
        kind: 'Normal',
        result: { status: 'OK', user: 'octocat', sku: 'free_educational_quota' },
      },
    ],
  });
  assert.equal(parsed?.signedIn, true);
  assert.equal(parsed?.user, 'octocat');
  assert.match(parsed?.message || '', /octocat/);
});

test('parses legacy didChangeStatus errors as signed out', () => {
  const parsed = parseCopilotStatusNotification('didChangeStatus', {
    kind: 'Error',
    message: 'Not signed in',
  });
  assert.equal(parsed?.signedIn, false);
  assert.equal(parsed?.kind, 'Error');
});

test('parses quota notifications', () => {
  const parsed = parseCopilotStatusNotification('copilot/quotaChange', {
    completions: { percentRemaining: 87 },
  });
  assert.equal(parsed?.completionsPercentRemaining, 87);
});

test('recognises an already-signed-in signIn response', () => {
  const parsed = parseCopilotSignInResponse({ status: 'AlreadySignedIn', user: 'octocat' });
  assert.equal(parsed.alreadySignedIn, true);
  assert.equal(parsed.user, 'octocat');
  assert.equal(parsed.userCode, undefined);
});

test('recognises a device-flow signIn response', () => {
  const parsed = parseCopilotSignInResponse({
    userCode: 'ABCD-EFGH',
    command: { command: 'github.copilot.finishDeviceFlow', arguments: [] },
  });
  assert.equal(parsed.alreadySignedIn, false);
  assert.equal(parsed.userCode, 'ABCD-EFGH');
  assert.equal(parsed.command?.command, 'github.copilot.finishDeviceFlow');
});
