import { useState } from "react";
import type { Account, Category, Transaction } from "@/domain/types";
import { formatMoney } from "@/domain/money";
import type { KupiAction } from "@/kupi/contracts";

interface KupiActionReviewCardProps {
  actions: readonly KupiAction[];
  accounts: readonly Account[];
  categories: readonly Category[];
  warnings: readonly string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onEdit?: (action: Extract<KupiAction, { kind: "create" }>) => void;
}

function accountName(id: string | null | undefined, accounts: readonly Account[]): string {
  return accounts.find((account) => account.id === id)?.name ?? "Unknown account";
}

function categoryName(id: string | null | undefined, categories: readonly Category[]): string {
  return categories.find((category) => category.id === id)?.name ?? "Uncategorized";
}

function transactionDetails(
  transaction: Pick<Transaction, "amount" | "accountId" | "categoryId" | "date" | "note" | "type">,
  accounts: readonly Account[],
  categories: readonly Category[]
) {
  return [
    ["Type", transaction.type.replace("_", " ")],
    ["Amount", formatMoney(transaction.amount)],
    ["Account", accountName(transaction.accountId, accounts)],
    ...(transaction.type === "transfer"
      ? []
      : [["Category", categoryName(transaction.categoryId, categories)]]),
    ["Date", transaction.date],
    ...(transaction.note ? [["Note", transaction.note]] : []),
  ];
}

function changedDetails(
  before: Transaction,
  after: Transaction,
  accounts: readonly Account[],
  categories: readonly Category[]
) {
  const beforeDetails = transactionDetails(before, accounts, categories);
  const afterDetails = transactionDetails(after, accounts, categories);
  return afterDetails.filter(([label, value], index) => value !== beforeDetails[index]?.[1])
    .map(([label, value], index) => ({
      label,
      before: beforeDetails.find(([beforeLabel]) => beforeLabel === label)?.[1] ?? "",
      after: value,
      index,
    }));
}

export function KupiActionReviewCard({
  actions,
  accounts,
  categories,
  warnings,
  busy,
  onConfirm,
  onCancel,
  onEdit = () => undefined,
}: KupiActionReviewCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  if (!actions.length) return null;
  const containsDelete = actions.some((action) => action.kind === "delete");
  const containsUpdate = actions.some((action) => action.kind === "update");
  const confirmLabel = containsDelete
    ? "Confirm delete"
    : containsUpdate
      ? "Confirm changes"
      : "Confirm and save";

  return (
    <section className="kupi-action-card" aria-label="Review proposed changes">
      {actions.map((action) => {
        if (action.kind === "delete") {
          return (
            <article className="kupi-delete-card" key={action.id}>
              <h3>Delete this transaction?</h3>
              <dl>
                {transactionDetails(action.before, accounts, categories).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p>This will be moved to deleted items and can be undone.</p>
            </article>
          );
        }

        if (action.kind === "update") {
          const changes = changedDetails(action.before, action.after, accounts, categories);
          return (
            <article className="kupi-diff-card" key={action.id}>
              <h3>Review transaction edit</h3>
              <dl>
                {changes.map(({ label, before, after }) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd><del>{before}</del><span aria-hidden="true"> → </span><strong>{after}</strong></dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        }

        if (action.kind === "transfer") {
          return (
            <article className="kupi-confirm-card" key={action.id}>
              <h3>Review transfer</h3>
              <dl>
                <div><dt>Amount</dt><dd>{formatMoney(action.after.amount)}</dd></div>
                <div><dt>From</dt><dd>{accountName(action.after.accountId, accounts)}</dd></div>
                <div><dt>To</dt><dd>{accountName(action.after.toAccountId, accounts)}</dd></div>
                <div><dt>Date</dt><dd>{action.after.date}</dd></div>
                {action.after.transferFee > 0 && (
                  <div><dt>Fee</dt><dd>{formatMoney(action.after.transferFee)}</dd></div>
                )}
              </dl>
            </article>
          );
        }

        return (
          <article className="kupi-confirm-card" key={action.id}>
            <h3>Review transaction</h3>
            <dl>
              {transactionDetails(action.after, accounts, categories).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {action.after.type === "expense" && !action.after.categoryId && (
              <p>No category was identified. You can edit the transaction after saving.</p>
            )}
            <button type="button" className="chat-clear-learning" onClick={() => {
              setEditingId(editingId === action.id ? null : action.id);
              setEditAmount((action.after.amount / 100).toString());
            }} disabled={busy}>{editingId === action.id ? "Close editor" : "Edit transaction"}</button>
            {editingId === action.id && (
              <form className="kupi-inline-edit" onSubmit={(event) => {
                event.preventDefault();
                const amount = Number(editAmount.replace(/,/g, ""));
                if (!Number.isFinite(amount) || amount <= 0) return;
                onEdit({ ...action, after: { ...action.after, amount: Math.round(amount * 100) } });
                setEditingId(null);
              }}>
                <label>Amount<input aria-label="Edit transaction amount" inputMode="decimal" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} /></label>
                <label>Account<select aria-label="Edit transaction account" value={action.after.accountId} onChange={(event) => onEdit({ ...action, after: { ...action.after, accountId: event.target.value } })}>
                  {accounts.filter((account) => account.profileId === action.profileId && !account.deletedAt && !account.isArchived).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select></label>
                {action.after.type !== "transfer" && <label>Category<select aria-label="Edit transaction category" value={action.after.categoryId ?? ""} onChange={(event) => onEdit({ ...action, after: { ...action.after, categoryId: event.target.value || null } })}>
                  <option value="">Uncategorized</option>{categories.filter((category) => category.profileId === action.profileId && category.type === action.after.type && !category.deletedAt).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select></label>}
                <label>Date<input aria-label="Edit transaction date" type="date" value={action.after.date} onChange={(event) => onEdit({ ...action, after: { ...action.after, date: event.target.value } })} /></label>
                <label>Note<input aria-label="Edit transaction note" value={action.after.note ?? ""} onChange={(event) => onEdit({ ...action, after: { ...action.after, note: event.target.value || null } })} /></label>
                <button type="submit" className="save-button" disabled={busy}>Apply amount</button>
              </form>
            )}
          </article>
        );
      })}
      {warnings.map((warning) => <p className="kupi-action-warning" key={warning}>{warning}</p>)}
      <div className="kupi-action-buttons">
        <button type="button" className="save-button" onClick={onConfirm} disabled={busy}>
          {busy ? "Saving…" : confirmLabel}
        </button>
        <button type="button" className="chat-clear-learning" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export function KupiUndoToast({
  busy,
  onUndo,
}: {
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="kupi-undo-toast" role="status">
      <span>Saved to your ledger.</span>
      <button type="button" onClick={onUndo} disabled={busy}>
        {busy ? "Undoing…" : "Undo"}
      </button>
    </div>
  );
}
