// Test-only seam for the Ticket-lock transactions (docs/lab-04/tests.md WF-08,
// WF-14, WF-16). A test installs a hook to pause a transaction right after it
// has taken the Ticket row lock, or to force a failure just before it commits.
//
// Inert outside the test runner: `setTransactionHook` does nothing unless
// NODE_ENV is "test" (vitest sets it), and with no hook installed `runHook`
// returns immediately, so production code paths are unchanged.

export type HookStage = 'after-lock' | 'before-commit';
export type HookScope = 'status' | 'action-create' | 'action-update';
export type TransactionHook = (stage: HookStage, scope: HookScope) => Promise<void> | void;

let hook: TransactionHook | null = null;

export function setTransactionHook(next: TransactionHook | null): void {
  if (process.env.NODE_ENV !== 'test') return;
  hook = next;
}

export async function runHook(stage: HookStage, scope: HookScope): Promise<void> {
  if (hook === null) return;
  await hook(stage, scope);
}
