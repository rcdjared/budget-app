import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, withoutOutbox } from "@/db/schema";
import type { Account, Category, Transaction } from "@/domain/types";
import { KupiChatSheet } from "./KupiChatSheet";

const timestamp = "2026-11-24T04:00:00.000Z";
const account: Account = {
  id: "cash",
  profileId: "profile",
  name: "Cash",
  type: "cash",
  openingBalance: 0,
  currency: "PHP",
  color: "#000000",
  icon: "wallet",
  isArchived: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const category: Category = {
  id: "food",
  profileId: "profile",
  name: "Food",
  type: "expense",
  icon: "utensils",
  color: "#000000",
  sortOrder: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const existingTransaction: Transaction = {
  id: "coffee",
  profileId: "profile",
  type: "expense",
  amount: 18000,
  accountId: account.id,
  categoryId: category.id,
  date: "2026-11-24",
  note: "Coffee",
  createdAt: timestamp,
  updatedAt: timestamp,
};

type MockRecognitionEvent = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

class MockSpeechRecognition {
  static latest: MockSpeechRecognition | null = null;

  lang = "";
  continuous = false;
  interimResults = false;
  started = false;
  onresult: ((event: MockRecognitionEvent) => void) | null = null;
  onerror: ((event: Event & { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    MockSpeechRecognition.latest = this;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.onend?.();
  }
}

async function resetDatabase(transaction?: Transaction) {
  await db.delete();
  await db.open();
  await withoutOutbox(async () => {
    await db.accounts.add(account);
    await db.categories.add(category);
    if (transaction) await db.transactions.add(transaction);
  });
  await db.outbox.clear();
}

function renderChat(profileId = "profile") {
  const view = render(
    <KupiChatSheet open onClose={vi.fn()} onOpenForm={vi.fn()} profileId={profileId} />
  );
  const input = screen.getByRole("textbox", { name: "Message Kupi" });
  const send = screen.getByRole("button", { name: "Send message" });
  return {
    ...view,
    send: async (text: string) => {
      await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
      fireEvent.change(input, { target: { value: text } });
      await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));
      fireEvent.click(send);
      expect(await screen.findByLabelText("Kupi is thinking")).toBeTruthy();
      await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    },
  };
}

beforeEach(async () => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.close();
});

describe("Kupi chat action flow", () => {
  it("uses a simple Chat header and lets users load editable guide examples", async () => {
    await resetDatabase(existingTransaction);
    const { container } = renderChat();

    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close chat" })).toBeTruthy();
    expect(screen.queryByText("Offline assistant · your data stays on this device")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open transaction form" })).toBeNull();
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Message Kupi" }) as HTMLTextAreaElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    expect(screen.getByRole("heading", { name: "Move money" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit an expense or income" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ask about your money" })).toBeTruthy();
    expect(screen.getByText("Goals, debts, and collections are managed in Plan for now; Chat can’t create or edit them yet.")).toBeTruthy();
    expect(screen.getByText(/Chat text and finance data are processed on this device/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Spent ₱180 on coffee today" }));
    const input = screen.getByRole("textbox", { name: "Message Kupi" }) as HTMLTextAreaElement;
    expect(input.value).toBe("Spent ₱180 on coffee today");
    expect(container.querySelector(".chat-message.user")).toBeNull();
  });

  it("turns voice input into an editable draft without sending it", async () => {
    await resetDatabase(existingTransaction);
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);
    const { container } = renderChat();

    const input = screen.getByRole("textbox", { name: "Message Kupi" }) as HTMLTextAreaElement;
    const send = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    expect(MockSpeechRecognition.latest?.started).toBe(true);

    const resultEvent = Object.assign(new Event("result"), {
      results: [[{ transcript: "Spent 180 on coffee today" }]],
    });
    act(() => {
      MockSpeechRecognition.latest?.onresult?.(resultEvent);
      MockSpeechRecognition.latest?.onend?.();
    });

    expect(input.value).toBe("Spent 180 on coffee today");
    expect(input.disabled).toBe(false);
    expect(send.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Voice draft ready. Review and edit it before sending.")).toBeTruthy();
    expect(container.querySelector(".chat-message.user")).toBeNull();
  });

  it("answers spending totals and top-category questions with the matching facts", async () => {
    await resetDatabase({
      ...existingTransaction,
      date: new Date().toISOString().slice(0, 10),
    });
    const { send } = renderChat();

    await send("How much did I spend this month?");
    expect(await screen.findByText("You spent ₱180.00 this month across 1 transaction.")).toBeTruthy();

    await send("What was my top spending category this month?");
    expect(await screen.findByText("Food was your top spending category this month at ₱180.00.")).toBeTruthy();
  });

  it("clears conversational focus when the active profile changes", async () => {
    await resetDatabase(existingTransaction);
    const view = renderChat();
    await view.send("How much did I spend this month?");
    expect(await screen.findByText(/You spent/)).toBeTruthy();

    view.rerender(
      <KupiChatSheet open onClose={vi.fn()} onOpenForm={vi.fn()} profileId="other-profile" />
    );
    const input = screen.getByRole("textbox", { name: "Message Kupi" }) as HTMLTextAreaElement;
    const send = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "last month" } });
    fireEvent.click(send);
    expect(await screen.findByText(/Could you say what you want to do/)).toBeTruthy();
  });

  it("answers account-management questions without confusing them as transactions", async () => {
    await resetDatabase();
    const { send } = renderChat();

    await send("can you change accounts?");
    expect(await screen.findByText(/Account names and details are managed from Wallet/)).toBeTruthy();
  });

  it("shows setup guidance when the profile has no accounts", async () => {
    await db.delete();
    await db.open();
    renderChat();

    expect(await screen.findByText("Welcome! Let’s set up your budget.")).toBeTruthy();
    expect(screen.getByText("Step 1:", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up Cash" })).toBeTruthy();
  });

  it("previews a transaction, commits only after confirmation, and offers undo", async () => {
    await resetDatabase();
    const { send } = renderChat();

    await send("spent 180 food today");
    expect(await screen.findByRole("heading", { name: "Review transaction" })).toBeTruthy();
    expect(await db.transactions.count()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(async () => expect(await db.transactions.count()).toBe(1));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => {
      const saved = await db.transactions.toArray();
      expect(saved).toHaveLength(1);
      expect(saved[0].deletedAt).toBeTruthy();
    });
  });

  it("opens from a Home nudge with that nudge as Kupi's first message", async () => {
    await resetDatabase();
    render(
      <KupiChatSheet
        open
        onClose={vi.fn()}
        onOpenForm={vi.fn()}
        profileId="profile"
        initialMessage="Food is over budget. Want to review it?"
        initialMood="worried"
      />
    );

    expect(await screen.findByText("Food is over budget. Want to review it?")).toBeTruthy();
    expect(screen.queryByText("Hi! What would you like to do?")).toBeNull();
    expect(await screen.findByAltText("Kupi worried")).toBeTruthy();
  });

  it("shows a before-and-after card and commits an edit only after confirmation", async () => {
    await resetDatabase(existingTransaction);
    const { send } = renderChat();

    await send("change the coffee to 45");
    expect(await screen.findByRole("heading", { name: "Review transaction edit" })).toBeTruthy();
    expect(screen.getByText("₱180.00")).toBeTruthy();
    expect(screen.getByText("₱45.00")).toBeTruthy();
    expect((await db.transactions.get(existingTransaction.id))?.amount).toBe(18000);

    fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    await waitFor(async () => expect((await db.transactions.get(existingTransaction.id))?.amount).toBe(4500));
  });

  it("soft-deletes the selected transaction and lets the user undo it", async () => {
    await resetDatabase(existingTransaction);
    const { send } = renderChat();

    await send("delete coffee 180");
    expect(await screen.findByRole("heading", { name: "Delete this transaction?" })).toBeTruthy();
    expect((await db.transactions.get(existingTransaction.id))?.deletedAt).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(async () => expect((await db.transactions.get(existingTransaction.id))?.deletedAt).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await db.transactions.get(existingTransaction.id))?.deletedAt).toBeNull());
  });

  it("offers only a reviewable uncategorized guess after repeated category clarification", async () => {
    await resetDatabase();
    const { send } = renderChat();

    await send("180");
    expect(await screen.findByText("I need the category before I can prepare a review card.")).toBeTruthy();
    await send("180");
    expect(await screen.findAllByText("I need the category before I can prepare a review card.")).toHaveLength(2);
    await send("180");
    fireEvent.click(await screen.findByRole("button", { name: /Use best guess/i }));

    expect(await screen.findByRole("heading", { name: "Review transaction" })).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    expect(await db.transactions.count()).toBe(0);
  });
});
