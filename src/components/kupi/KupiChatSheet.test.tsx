import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderChat() {
  const view = render(
    <KupiChatSheet open onClose={vi.fn()} onOpenForm={vi.fn()} profileId="profile" />
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
  await db.close();
});

describe("Kupi chat action flow", () => {
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
