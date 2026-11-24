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
}: KupiActionReviewCardProps) {
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
