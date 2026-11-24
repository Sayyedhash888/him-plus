export interface ApprovalDecision {
  allow: boolean;
  /** True when the user asked to allow this tool for the rest of the session. */
  always: boolean;
}

const approvalResolvers = new Map<string, (decision: ApprovalDecision) => void>();

export function waitForApproval(sessionId: string): Promise<ApprovalDecision> {
  return new Promise<ApprovalDecision>((resolve) => {
    approvalResolvers.set(sessionId, (decision) => {
      approvalResolvers.delete(sessionId);
      resolve(decision);
    });
  });
}

export function resolveApproval(
  sessionId: string,
  allow: boolean,
  always = false,
): boolean {
  const resolver = approvalResolvers.get(sessionId);
  if (!resolver) return false;
  resolver({ allow, always: allow && always });
  return true;
}

export function cancelApproval(sessionId: string): void {
  const resolver = approvalResolvers.get(sessionId);
  if (resolver) resolver({ allow: false, always: false });
}

export function hasPendingApproval(sessionId: string): boolean {
  return approvalResolvers.has(sessionId);
}
