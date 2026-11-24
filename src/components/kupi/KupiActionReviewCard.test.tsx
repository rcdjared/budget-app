import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account, Category, Transaction } from "@/domain/types";
import type { KupiAction } from "@/kupi/contracts";
import { KupiActionReviewCard, KupiUndoToast } from "./KupiActionReviewCard";

const accounts: Account[] = [{
  id: "cash",
  profileId: "profile",
  name: "Cash",
  type: "cash",
  openingBalance: 0,
  currency: "PHP",
  color: "#000000",
  icon: "banknote",
  isArchived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}];

const categories: Category[] = [{
  id: "food",
  profileId: "profile",
  name: "Food",
  type: "expense",
  icon: "utensils",
  color: "#000000",
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}];

const transaction: Transaction = {
  id: "txn",
  profileId: "profile",
  type: "expense",
  amount: 18000,
  accountId: "cash",
  categoryId: "food",
  date: "2026-11-24",
  note: "Coffee",
  createdAt: "2026-11-24T00:00:00.000Z",
  updatedAt: "2026-11-24T00:00:00.000Z",
};

function renderCard(action: KupiAction, onConfirm = vi.fn()) {
  render(
    <KupiActionReviewCard
      actions={[action]}
      accounts={accounts}
      categories={categories}
      warnings={[]}
      busy={false}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  );
  return onConfirm;
}

describe("Kupi action review cards", () => {
  it("requires an explicit confirmation for a new transaction", () => {
    const onConfirm = renderCard({
      id: "create-action",
      profileId: "profile",
      kind: "create",
      before: null,
      after: {
        profileId: transaction.profileId,
        type: transaction.type,
        amount: transaction.amount,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        date: transaction.date,
        note: transaction.note,
      },
      warnings: [],
    });

    expect(screen.getByRole("heading", { name: "Review transaction" })).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows before-and-after values for an edit", () => {
    const onConfirm = renderCard({
      id: "edit-action",
      profileId: "profile",
      kind: "update",
      before: transaction,
      after: { ...transaction, amount: 4500 },
      warnings: [],
    });

    expect(screen.getByRole("heading", { name: "Review transaction edit" })).toBeTruthy();
    expect(screen.getByText("₱180.00")).toBeTruthy();
    expect(screen.getByText("₱45.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows a separate delete confirmation before a soft delete", () => {
    const onConfirm = renderCard({
      id: "delete-action",
      profileId: "profile",
      kind: "delete",
      before: transaction,
      after: null,
      warnings: [],
    });

    expect(screen.getByRole("heading", { name: "Delete this transaction?" })).toBeTruthy();
    expect(screen.getByText(/moved to deleted items and can be undone/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("offers an undo action after a commit", () => {
    const onUndo = vi.fn();
    render(<KupiUndoToast busy={false} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});
