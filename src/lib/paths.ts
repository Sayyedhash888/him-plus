export interface ResolvedWorkspacePath {
  abs: string;
  rel: string;
}

function toPosix(input: string): string {
  return input.replaceAll('\\', '/');
}

function normalizeAbsolute(input: string): string {
  const posix = toPosix(input);
  const drive = /^([a-zA-Z]:)\//.exec(posix);
  const isUnc = posix.startsWith('//');
  let prefix = '';
  let rest = posix;
  if (drive) {
    prefix = `${drive[1].toUpperCase()}`;
    rest = posix.slice(drive[0].length);
  } else if (isUnc) {
    prefix = '//';
    rest = posix.slice(2);
  } else if (posix.startsWith('/')) {
    prefix = '/';
    rest = posix.slice(1);
  }
  const parts = rest.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop();
      else if (!prefix) stack.push('..');
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join('/');
  if (prefix === '/') return `/${joined}`.replace(/\/+$/, '') || '/';
  if (prefix === '//') return `//${joined}`;
  if (prefix) return `${prefix}/${joined}`;
  return joined || '.';
}

export function isAbsolutePathLike(input: string): boolean {
  const value = toPosix(input.trim());
  return /^([a-zA-Z]:)\//.test(value) || value.startsWith('/');
}

export function workspacePath(root: string, target: string): ResolvedWorkspacePath {
  const trimmedRoot = normalizeAbsolute(root).replace(/\/+$/, '');
  let raw = String(target ?? '.').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  if (!raw) raw = '.';
  if (raw.includes('\u0000')) throw new Error('Path contains an invalid character.');
  const candidate = isAbsolutePathLike(raw)
    ? normalizeAbsolute(raw)
    : normalizeAbsolute(`${trimmedRoot}/${raw}`);

  const rootLower = trimmedRoot.toLowerCase();
  const candidateLower = candidate.toLowerCase();
  const inside =
    candidateLower === rootLower || candidateLower.startsWith(`${rootLower}/`);
  if (!inside) {
    throw new Error(
      `Path "${raw}" is outside the active workspace. Use paths relative to the workspace root.`,
    );
  }
  const rel = candidate.slice(trimmedRoot.length).replace(/^\/+/, '');
  const segments = rel.split('/').map((part) => part.toLowerCase());
  if (segments.includes('.git')) {
    throw new Error('Access to .git internals is blocked. Use git in the terminal if needed.');
  }
  return { abs: candidate, rel };
}

export function displayPath(root: string, absolute: string): string {
  try {
    return workspacePath(root, absolute).rel || '.';
  } catch {
    return toPosix(absolute);
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  const trimmedRoot = normalizeAbsolute(root).replace(/\/+$/, '').toLowerCase();
  const normalized = normalizeAbsolute(candidate).toLowerCase();
  return normalized === trimmedRoot || normalized.startsWith(`${trimmedRoot}/`);
}
