/**
 * Parses the Copilot language server's auth/status notifications.
 *
 * The server emits several shapes:
 *  - didChangeStatus        { kind, message, busy }
 *  - didChangeStatus/v2     { statuses: [{ category: 'auth', kind, result: { status, user } }] }
 *  - statusNotification     { status, kind, message }
 *  - copilot/quotaChange    { completions: { percentRemaining } }
 */

export interface ParsedCopilotStatus {
  signedIn?: boolean;
  user?: string;
  kind?: string;
  message?: string;
  busy?: boolean;
  completionsPercentRemaining?: number;
}

export function parseCopilotStatusNotification(
  method: string,
  params: unknown,
): ParsedCopilotStatus | null {
  if (!params || typeof params !== 'object') {
    if (method === 'didChangeStatus') return null;
    return null;
  }
  const payload = params as Record<string, unknown>;
  if (method === 'didChangeStatus/v2') {
    const statuses = Array.isArray(payload.statuses) ? payload.statuses : [];
    const result: ParsedCopilotStatus = {};
    for (const raw of statuses) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const category = typeof entry.category === 'string' ? entry.category : '';
      const kind = typeof entry.kind === 'string' ? entry.kind : undefined;
      const authResult =
        entry.result && typeof entry.result === 'object'
          ? (entry.result as Record<string, unknown>)
          : null;
      if (kind) result.kind = kind;
      if (category === 'auth') {
        const user = authResult && typeof authResult.user === 'string' ? authResult.user : '';
        if (user) {
          result.signedIn = true;
          result.user = user;
          result.message = `Signed in as ${user}.`;
        } else if (kind === 'Error') {
          result.signedIn = false;
          result.message = 'Not signed in to GitHub Copilot.';
        }
      }
      if (category === 'completion' && entry.busy === true) result.busy = true;
    }
    return result;
  }
  if (method === 'didChangeStatus') {
    const kind = typeof payload.kind === 'string' ? payload.kind : undefined;
    const message = typeof payload.message === 'string' ? payload.message : '';
    const busy = payload.busy === true;
    const parsed: ParsedCopilotStatus = { kind, busy };
    if (kind === 'Error') {
      parsed.signedIn = false;
      parsed.message = message || 'Not signed in to GitHub Copilot.';
    } else if (message) {
      parsed.message = message;
    }
    return parsed;
  }
  if (method === 'statusNotification') {
    const kind = typeof payload.kind === 'string' ? payload.kind : undefined;
    const message = typeof payload.message === 'string' ? payload.message : '';
    const parsed: ParsedCopilotStatus = { kind };
    if (kind === 'Error') {
      parsed.signedIn = false;
      parsed.message = message || 'Not signed in to GitHub Copilot.';
    } else if (message) {
      parsed.message = message;
    }
    return parsed;
  }
  if (method === 'copilot/quotaChange') {
    const completions =
      payload.completions && typeof payload.completions === 'object'
        ? (payload.completions as Record<string, unknown>)
        : null;
    if (completions && typeof completions.percentRemaining === 'number') {
      return { completionsPercentRemaining: completions.percentRemaining };
    }
    return null;
  }
  return null;
}

export interface ParsedSignInResponse {
  alreadySignedIn: boolean;
  user?: string;
  userCode?: string;
  command?: { command: string; arguments: unknown[] };
  status?: string;
}

export function parseCopilotSignInResponse(response: unknown): ParsedSignInResponse {
  const payload =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const status = typeof payload.status === 'string' ? payload.status : undefined;
  const user = typeof payload.user === 'string' ? payload.user : undefined;
  const userCode = typeof payload.userCode === 'string' ? payload.userCode : undefined;
  const rawCommand =
    payload.command && typeof payload.command === 'object'
      ? (payload.command as Record<string, unknown>)
      : null;
  const command =
    rawCommand && typeof rawCommand.command === 'string'
      ? {
          command: rawCommand.command,
          arguments: Array.isArray(rawCommand.arguments) ? rawCommand.arguments : [],
        }
      : undefined;
  const alreadySignedIn =
    status === 'AlreadySignedIn' || (Boolean(user) && !userCode && !command) || status === 'SignedIn';
  return { alreadySignedIn, user, userCode, command, status };
}
