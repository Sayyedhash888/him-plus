/**
 * HIM+ permission policy for ACP tool-permission requests. Kept pure so it can be
 * tested; the Electron layer only adds the approval dialog.
 *
 * Modes:
 *  - plan:   reads only, everything else denied
 *  - review: reads auto-allowed, writes/commands need approval
 *  - auto:   everything auto-allowed (agent-local destructive prompts still apply)
 */

export type AcpPermissionKind = 'read' | 'write' | 'execute' | 'other';

export function classifyAcpPermission(toolCall: Record<string, unknown>): AcpPermissionKind {
  const kind = typeof toolCall.kind === 'string' ? toolCall.kind.toLowerCase() : '';
  const title = typeof toolCall.title === 'string' ? toolCall.title.toLowerCase() : '';
  const name =
    toolCall.rawInput && typeof toolCall.rawInput === 'object'
      ? JSON.stringify(toolCall.rawInput).toLowerCase()
      : '';
  const text = `${kind} ${title} ${name}`;
  if (/(execute|terminal|command|shell|run_commands?|bash|process)/.test(text)) return 'execute';
  if (/(write|edit|patch|delete|remove|move|rename|create|apply|replace)/.test(text)) {
    return 'write';
  }
  if (/(read|search|list|glob|grep|fetch|inspect|view|get_file|open)/.test(text)) return 'read';
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'write';
  if (kind === 'execute') return 'execute';
  return 'other';
}

export function shouldAutoAllowAcp(
  mode: 'plan' | 'review' | 'auto',
  kind: AcpPermissionKind,
): boolean {
  if (mode === 'plan') return kind === 'read';
  if (mode === 'auto') return true;
  return kind === 'read';
}

/** Stable key for "always allow this kind of operation in this ACP session". */
export function acpGrantKey(kind: AcpPermissionKind, toolCall: Record<string, unknown>): string {
  const title = typeof toolCall.title === 'string' ? toolCall.title.trim().slice(0, 80) : '';
  return `${kind}:${title || 'tool'}`;
}
