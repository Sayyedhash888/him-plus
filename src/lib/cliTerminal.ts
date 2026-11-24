/**
 * Cleans raw PTY output for the CLI-agent chat transcript. This is a best-effort
 * rendering of an interactive CLI, not a terminal emulator: ANSI escapes are
 * stripped, carriage-return redraws collapse to their final frame and backspaces
 * are applied. The raw terminal toggle shows the untouched stream.
 */

const ANSI_PATTERN =
  // CSI, OSC (with BEL/ST), and simple two-byte escapes.
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

function applyLineEdits(line: string): string {
  // Carriage returns overwrite the current line; keeping the last frame avoids
  // duplicating spinner/progress output in chat.
  const lastFrame = line.includes('\r') ? line.slice(line.lastIndexOf('\r') + 1) : line;
  let result = '';
  for (const char of lastFrame) {
    if (char === '\b') {
      result = result.slice(0, -1);
    } else {
      result += char;
    }
  }
  return result;
}

export function sanitizeCliOutput(raw: string): string {
  if (!raw) return '';
  const withoutAnsi = stripAnsi(raw).replaceAll('\r\n', '\n');
  const lines = withoutAnsi.split('\n').map((line) =>
    // \r may appear mid-line in the original stream.
    applyLineEdits(line),
  );
  const cleaned = lines
    .map((line) => line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trimEnd())
    .join('\n');
  return cleaned.replace(/\n{3,}/g, '\n\n').trim() ? cleaned.replace(/\n{3,}/g, '\n\n').trim() : '';
}

export function appendCliOutput(current: string, chunk: string, maxChars = 200_000): string {
  const next = `${current}${chunk}`;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}
