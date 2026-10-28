import type { ExecutionBinding } from 'workspace-contracts';

/** Binding rows owned by the experts being deleted (including team members). */
export function bindingRowsForExperts<T extends ExecutionBinding>(
  entries: Iterable<readonly [string, T]>,
  expertIds: ReadonlySet<string>,
): readonly (readonly [string, T])[] {
  return [...entries].filter(([, binding]) => expertIds.has(binding.expertRevisionRef.expertId));
}

/** Existing non-blank Sessions are conversations that still depend on the binding. */
export function activeBoundSessionIds(
  bindings: readonly ExecutionBinding[],
  sessions: readonly { readonly sessionId: string; readonly blank: boolean }[],
): readonly string[] {
  const bound = new Set(bindings.map((binding) => binding.sessionId));
  return [...new Set(
    sessions
      .filter((session) => bound.has(session.sessionId) && !session.blank)
      .map((session) => session.sessionId),
  )];
}
