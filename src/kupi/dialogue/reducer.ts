import { KUPI_CONFIG, type KupiIntent, type ParseResult } from "../contracts";

export type DialogueState =
  | { status: "idle" }
  | {
      status: "awaitingSlot";
      result: ParseResult;
      slot: string;
      questionsAsked: number;
      questionLimitReached: boolean;
    }
  | { status: "awaitingConfirm"; result: ParseResult }
  | { status: "awaitingDisambiguation"; result: ParseResult; candidates: readonly string[] };

export type DialogueEvent =
  | { type: "parsed"; result: ParseResult }
  | { type: "reset" };

const ACTION_INTENTS = new Set<KupiIntent>([
  "LOG_EXPENSE",
  "LOG_INCOME",
  "TRANSFER",
  "EDIT_TXN",
  "DELETE_TXN",
]);

function stateForResult(result: ParseResult, previous: DialogueState): DialogueState {
  if (result.targetCandidates?.length) {
    return {
      status: "awaitingDisambiguation",
      result,
      candidates: result.targetCandidates.slice(0, 3),
    };
  }

  if (result.missing.length) {
    const interrupted = result.flags.includes("interrupts_pending");
    const sameDialogue = previous.status === "awaitingSlot"
      && previous.result.intent === result.intent
      && !interrupted;
    const questionsAsked = sameDialogue ? previous.questionsAsked : 0;
    if (questionsAsked >= KUPI_CONFIG.dialogue.maxQuestions) {
      return {
        status: "awaitingSlot",
        result,
        slot: result.missing[0],
        questionsAsked,
        questionLimitReached: true,
      };
    }
    return {
      status: "awaitingSlot",
      result,
      slot: result.missing[0],
      questionsAsked: questionsAsked + 1,
      questionLimitReached: false,
    };
  }

  if (ACTION_INTENTS.has(result.intent)) {
    return { status: "awaitingConfirm", result };
  }

  return { status: "idle" };
}

/** Replaces pending dialogue with a new topic; confirm/cancel replies resolve the pending action. */
export function reduceDialogue(state: DialogueState, event: DialogueEvent): DialogueState {
  if (event.type === "reset") return { status: "idle" };

  const { result } = event;
  if (result.intent === "CANCEL" || result.intent === "UNDO") return { status: "idle" };
  if (result.intent === "CONFIRM") return state.status === "awaitingConfirm" ? { status: "idle" } : state;

  return stateForResult(result, state);
}
