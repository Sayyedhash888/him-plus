import fs from 'node:fs';
import path from 'node:path';

/**
 * Targeted edits to the HIM+ `config.json` that the desktop app owns.
 *
 * The file is read, patched and written back as text so unknown sections
 * (`copilot`, `acpAgents`, providers' nested objects, …) survive untouched — the
 * extension must never rewrite the app's config from a lossy parse. Provider keys
 * stay encrypted because they are copied through verbatim.
 *
 * The desktop app caches its config in memory and rewrites the file on its next
 * save, so a change made here is durable only once HIM+ restarts (or is closed).
 * Callers say so in the message they show.
 */

export interface FimState {
  found: boolean;
  enabled: boolean;
  mode: string;
  model: string;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Reads the FIM section without needing to understand the whole file. */
export function readFimState(configFile: string): FimState {
  const text = readText(configFile);
  if (text === null) return { found: false, enabled: false, mode: 'chat', model: '' };
  let parsed: { fim?: { enabled?: unknown; mode?: unknown; model?: { modelId?: unknown } } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return { found: false, enabled: false, mode: 'chat', model: '' };
  }
  const fim = parsed.fim;
  if (!fim) return { found: false, enabled: false, mode: 'chat', model: '' };
  return {
    found: true,
    enabled: Boolean(fim.enabled),
    mode: typeof fim.mode === 'string' ? fim.mode : 'chat',
    model: typeof fim.model?.modelId === 'string' ? fim.model.modelId : '',
  };
}

/**
 * Writes `fim.enabled` (and optionally `fim.mode`) in place. Handles both the
 * pretty-printed config the app writes and a hypothetical compact file, and
 * refuses to touch anything it cannot locate with certainty — a bad regex here
 * would corrupt a config the user cannot easily rebuild.
 */
export function writeFimState(
  configFile: string,
  patch: { enabled?: boolean; mode?: 'fim' | 'chat' },
): { ok: true } | { ok: false; reason: string } {
  const text = readText(configFile);
  if (text === null) return { ok: false, reason: `Could not read ${configFile}.` };

  // Locate the top-level "fim" object with a brace matcher rather than a greedy
  // regex, so nested braces inside it cannot end the match early.
  const keyMatch = /"fim"\s*:\s*\{/.exec(text);
  if (!keyMatch) return { ok: false, reason: 'No "fim" section in HIM+ config.json.' };
  const openBrace = text.indexOf('{', keyMatch.index);
  let depth = 0;
  let closeBrace = -1;
  for (let index = openBrace; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      // Skip string literals so a brace or quote inside a value is ignored.
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index += 1;
        index += 1;
      }
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        closeBrace = index;
        break;
      }
    }
  }
  if (closeBrace < 0) return { ok: false, reason: 'Unbalanced "fim" section in HIM+ config.json.' };

  const head = text.slice(0, openBrace + 1);
  const body = text.slice(openBrace + 1, closeBrace);
  const tail = text.slice(closeBrace);

  const replaceBoolean = (source: string, key: string, value: boolean): string | null => {
    const pattern = new RegExp(`("${key}"\\s*:\\s*)(true|false)`);
    if (!pattern.test(source)) return null;
    return source.replace(pattern, `$1${value}`);
  };
  const replaceString = (source: string, key: string, value: string): string | null => {
    const pattern = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
    if (!pattern.test(source)) return null;
    return source.replace(pattern, `$1"${value}"`);
  };

  let nextBody = body;
  const changes: string[] = [];

  if (patch.enabled !== undefined) {
    const updated = replaceBoolean(nextBody, 'enabled', patch.enabled);
    if (!updated) return { ok: false, reason: 'No "fim.enabled" boolean found to update.' };
    nextBody = updated;
    changes.push(`enabled → ${patch.enabled}`);
  }
  if (patch.mode !== undefined) {
    const updated = replaceString(nextBody, 'mode', patch.mode);
    if (!updated) return { ok: false, reason: 'No "fim.mode" string found to update.' };
    nextBody = updated;
    changes.push(`mode → ${patch.mode}`);
  }
  if (!changes.length) return { ok: false, reason: 'Nothing to change.' };

  const result = `${head}${nextBody}${tail}`;
  // Refuse to write output that no longer parses as JSON.
  try {
    JSON.parse(result);
  } catch (error) {
    return {
      ok: false,
      reason: `Refusing to write invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    fs.writeFileSync(configFile, result, 'utf8');
  } catch (error) {
    return {
      ok: false,
      reason: `Could not write ${path.basename(configFile)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return { ok: true };
}
