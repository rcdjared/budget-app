import type { SessionContext } from "../contracts";

/** Advances ephemeral conversational focus once per user turn. */
export function advanceFocus(context: SessionContext, ttlTurns = 6): SessionContext {
  const focus = context.focus;
  if (!focus) return context;
  const remaining = focus.turnsRemaining ?? ttlTurns;
  if (remaining <= 0) return { ...context, focus: undefined };
  return { ...context, focus: { ...focus, turnsRemaining: remaining - 1 } };
}
