export interface TerminalInputResult {
  /** The line buffer after applying the keystrokes. */
  line: string;
  /** Text to echo into the terminal so the user can see what they typed. */
  echo: string;
  /** Complete newline-terminated input to write to the running process. */
  submit: string;
}

/**
 * While a command is running, the terminal emulator owns the input line. The
 * child process is not a TTY, so readline buffering/backspace must be handled
 * here; only complete lines are forwarded to stdin.
 */
export function feedTerminalInput(line: string, data: string): TerminalInputResult {
  const normalized = data
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r\n/g, '\r');
  let next = line;
  let echo = '';
  let submit = '';

  for (const char of normalized) {
    if (char === '\r' || char === '\n') {
      echo += '\r\n';
      submit += `${next}\n`;
      next = '';
      continue;
    }
    if (char === '\x7f' || char === '\b') {
      if (next.length > 0) {
        next = next.slice(0, -1);
        echo += '\b \b';
      }
      continue;
    }
    if (char < ' ') continue;
    next += char;
    echo += char;
  }

  return { line: next, echo, submit };
}