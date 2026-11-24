import { describe, expect, it } from "vitest";
import type { ParseResult } from "../contracts";
import { reduceDialogue, type DialogueState } from "./reducer";

function result(
  intent: ParseResult["intent"],
  overrides: Partial<ParseResult> = {}
): ParseResult {
  return {
    intent,
    confidence: 0.9,
    tier: "auto",
    alternatives: [],
    drafts: [],
    missing: [],
    flags: [],
    ...overrides,
  };
}

describe("reduceDialogue", () => {
  it("moves through slot, confirmation, and disambiguation states", () => {
    const awaitingSlot = reduceDialogue({ status: "idle" }, {
      type: "parsed",
      result: result("LOG_EXPENSE", { missing: ["amount", "category"] }),
    });
    expect(awaitingSlot).toMatchObject({
      status: "awaitingSlot",
      slot: "amount",
      questionsAsked: 1,
      questionLimitReached: false,
    });

    const awaitingConfirm = reduceDialogue(awaitingSlot, {
      type: "parsed",
      result: result("LOG_EXPENSE"),
    });
    expect(awaitingConfirm.status).toBe("awaitingConfirm");

    const awaitingDisambiguation = reduceDialogue(awaitingConfirm, {
      type: "parsed",
      result: result("DELETE_TXN", { targetCandidates: ["a", "b", "c", "d"] }),
    });
    expect(awaitingDisambiguation).toMatchObject({
      status: "awaitingDisambiguation",
      candidates: ["a", "b", "c"],
    });
  });

  it("clears a pending confirmation on confirm/cancel and replaces it on interruption", () => {
    const pending: DialogueState = {
      status: "awaitingConfirm",
      result: result("LOG_EXPENSE"),
    };
    expect(reduceDialogue(pending, { type: "parsed", result: result("CONFIRM") })).toEqual({ status: "idle" });
    expect(reduceDialogue(pending, { type: "parsed", result: result("CANCEL") })).toEqual({ status: "idle" });
    expect(reduceDialogue(pending, { type: "parsed", result: result("QUERY_STATS") })).toEqual({ status: "idle" });
  });

  it("does not treat confirmation as a slot answer and supports reset", () => {
    const pending: DialogueState = {
      status: "awaitingSlot",
      result: result("LOG_EXPENSE", { missing: ["amount"] }),
      slot: "amount",
      questionsAsked: 1,
      questionLimitReached: false,
    };
    expect(reduceDialogue(pending, { type: "parsed", result: result("CONFIRM") })).toBe(pending);
    expect(reduceDialogue(pending, { type: "reset" })).toEqual({ status: "idle" });
  });

  it("stops asking after the configured follow-up limit", () => {
    const first = reduceDialogue({ status: "idle" }, {
      type: "parsed",
      result: result("LOG_EXPENSE", { missing: ["amount"] }),
    });
    const second = reduceDialogue(first, {
      type: "parsed",
      result: result("LOG_EXPENSE", { missing: ["amount"] }),
    });
    expect(second).toMatchObject({ status: "awaitingSlot", questionsAsked: 2 });
    expect(reduceDialogue(second, {
      type: "parsed",
      result: result("LOG_EXPENSE", { missing: ["amount"] }),
    })).toMatchObject({ status: "awaitingSlot", questionsAsked: 2, questionLimitReached: true });
  });

  it("resets the question count when a parse interrupts the pending dialogue", () => {
    const pending = {
      status: "awaitingSlot" as const,
      result: result("LOG_EXPENSE", { missing: ["amount"] }),
      slot: "amount",
      questionsAsked: 2,
      questionLimitReached: false,
    };
    expect(reduceDialogue(pending, {
      type: "parsed",
      result: result("LOG_EXPENSE", { missing: ["amount"], flags: ["interrupts_pending"] }),
    })).toMatchObject({ status: "awaitingSlot", questionsAsked: 1, questionLimitReached: false });
  });
});
