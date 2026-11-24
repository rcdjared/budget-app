import { describe, expect, it } from "vitest";
import { advanceFocus } from "./focus";
import type { SessionContext } from "../contracts";

const context: SessionContext = {
  recentTemplateIds: [],
  personality: "classic",
  rngSeed: 1,
  focus: { lastQuery: { metric: "total", period: "this_month" }, turnsRemaining: 1 },
};

describe("ephemeral Kupi focus", () => {
  it("keeps focus for the last allowed turn and expires it on the next", () => {
    const lastAllowedTurn = advanceFocus(context);
    expect(lastAllowedTurn.focus?.turnsRemaining).toBe(0);
    expect(advanceFocus(lastAllowedTurn).focus).toBeUndefined();
  });

  it("does not mutate a context without focus", () => {
    const empty: SessionContext = { ...context, focus: undefined };
    expect(advanceFocus(empty)).toBe(empty);
  });
});
