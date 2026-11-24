import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedTerminalInput } from '../src/lib/terminalInput.ts';

test('accumulates printable input without submitting', () => {
  assert.deepEqual(feedTerminalInput('', '42'), {
    line: '42',
    echo: '42',
    submit: '',
  });
});

test('backspace removes the last buffered character', () => {
  assert.deepEqual(feedTerminalInput('42', '\x7f'), {
    line: '4',
    echo: '\b \b',
    submit: '',
  });
});

test('enter submits the complete line and clears the buffer', () => {
  assert.deepEqual(feedTerminalInput('42', '\r'), {
    line: '',
    echo: '\r\n',
    submit: '42\n',
  });
});

test('pasted multi-line input submits each completed line', () => {
  assert.deepEqual(feedTerminalInput('', '2\r\n3\r\n'), {
    line: '',
    echo: '2\r\n3\r\n',
    submit: '2\n3\n',
  });
});

test('escape sequences and control keys are ignored', () => {
  assert.deepEqual(feedTerminalInput('', '\x1b[A\x01'), {
    line: '',
    echo: '',
    submit: '',
  });
});