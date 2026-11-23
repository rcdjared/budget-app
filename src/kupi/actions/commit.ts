import { KUPI_CONFIG, type KupiAction, type KupiTransferData } from "../contracts";
import { db } from "@/db/schema";
import { getProfileRecord, profileRecords } from "@/db/profileScope";
import type { KupiActionRecord, Transaction } from "@/domain/types";
import {
  createTransaction,
  createTransfer,
  restoreTransaction,
  softDeleteTransaction,
  updateTransaction,
  updateTransfer,
} from "@/db/repositories/transactions";
import { validateAction, type KupiActionSnapshot } from "./validate";

export interface CommitActionResult {
  actionId: string;
  transactionId: string;
  updatedAt: string;
  replayed: boolean;
}

function actionJson(action: KupiAction): string {
  return JSON.stringify(action);
}

async function actionSnapshot(profileId: string): Promise<KupiActionSnapshot> {
  const [accounts, categories, txns] = await Promise.all([
    profileRecords(db.accounts, profileId).toArray(),
    profileRecords(db.categories, profileId).toArray(),
    profileRecords(db.transactions, profileId).toArray(),
  ]);
  return { accounts, categories, txns, now: new Date() };
}

function transferDataFromTransaction(
  transaction: Transaction,
  feeCategoryId?: string | null
): KupiTransferData {
  return {
    profileId: transaction.profileId,
    amount: transaction.amount,
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId ?? null,
    sourceType: transaction.sourceType ?? "my",
    destinationType: transaction.destinationType ?? (transaction.toAccountId ? "my" : "external"),
    externalFromName: transaction.externalFromName ?? null,
    externalToName: transaction.externalToName ?? null,
    transferFee: transaction.transferFee ?? 0,
    feeCategoryId: feeCategoryId ?? null,
    date: transaction.date,
    time: transaction.transferTime ?? "",
    note: transaction.note ?? null,
  };
}

async function updateTransferFromSnapshot(transaction: Transaction): Promise<void> {
  let feeCategoryId: string | null | undefined;
  if (transaction.feeTransactionId) {
    const fee = await getProfileRecord(db.transactions, transaction.feeTransactionId, transaction.profileId);
    feeCategoryId = fee?.categoryId ?? null;
  }
  await updateTransfer(
    transaction.id,
    transferDataFromTransaction(transaction, feeCategoryId)
  );
}

async function applyUpdate(before: Transaction, after: Transaction): Promise<void> {
  if (before.type === "transfer") {
    await updateTransferFromSnapshot(after);
    return;
  }
  await updateTransaction(before.id, before.profileId, {
    amount: after.amount,
    accountId: after.accountId,
    categoryId: after.categoryId ?? null,
    date: after.date,
    note: after.note ?? null,
  });
}

async function applyAction(action: KupiAction): Promise<string> {
  switch (action.kind) {
    case "create":
      return createTransaction(action.after);
    case "transfer":
      return createTransfer(action.after);
    case "update":
      await applyUpdate(action.before, action.after);
      return action.before.id;
    case "delete":
      await softDeleteTransaction(action.before.id, action.profileId);
      return action.before.id;
  }
}

function checkActionSet(actions: readonly KupiAction[]): void {
  const ids = new Set<string>();
  const targets = new Set<string>();
  let profileId: string | undefined;
  for (const action of actions) {
    if (!action.id.trim()) throw new Error("Kupi action id must not be empty.");
    if (!action.profileId.trim()) throw new Error("Kupi action profile id must not be empty.");
    if (ids.has(action.id)) throw new Error("A Kupi action batch cannot contain duplicate action ids.");
    ids.add(action.id);
    if (profileId && profileId !== action.profileId) {
      throw new Error("A Kupi action batch cannot cross profile boundaries.");
    }
    profileId = action.profileId;
    if (action.kind === "update" || action.kind === "delete") {
      if (targets.has(action.before.id)) {
        throw new Error("A Kupi action batch cannot change the same transaction more than once.");
      }
      targets.add(action.before.id);
    }
  }
}

async function enforceUndoLimit(profileId: string): Promise<void> {
  const activeReceipts = await db.kupiActions.where("profileId").equals(profileId)
    .filter((record) => record.undoAvailable && !record.undoneAt)
    .toArray();
  activeReceipts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const expired = activeReceipts.slice(
    0,
    Math.max(0, activeReceipts.length - KUPI_CONFIG.dialogue.undoStackCap)
  );
  const timestamp = new Date().toISOString();
  for (const record of expired) {
    await db.kupiActions.update(record.id, { undoAvailable: false, updatedAt: timestamp });
  }
}

function replayResult(record: KupiActionRecord, actionId: string): CommitActionResult {
  return {
    actionId,
    transactionId: record.transactionId,
    updatedAt: record.resultUpdatedAt,
    replayed: true,
  };
}

export async function commitAction(
  actions: readonly KupiAction[],
  confirmed: boolean
): Promise<CommitActionResult[]> {
  if (!confirmed) throw new Error("Kupi actions must be explicitly confirmed before commit.");
  if (!actions.length) return [];
  checkActionSet(actions);

  const results = new Map<string, CommitActionResult>();
  await db.transaction("rw", db.tables, async () => {
    const pending: KupiAction[] = [];
    for (const action of actions) {
      const existing = await db.kupiActions.get(action.id);
      if (!existing) {
        pending.push(action);
        continue;
      }
      if (existing.profileId !== action.profileId || existing.actionJson !== actionJson(action)) {
        throw new Error("Kupi action id was already used for a different action.");
      }
      results.set(action.id, replayResult(existing, action.id));
    }

    if (!pending.length) return;
    const snapshot = await actionSnapshot(pending[0].profileId);
    const errors = pending.flatMap((action) => validateAction(action, snapshot).errors);
    if (errors.length) throw new Error(errors.join(" "));

    let receiptTime = Date.now() - 1;
    for (const action of pending) {
      const transactionId = await applyAction(action);
      const transaction = await getProfileRecord(db.transactions, transactionId, action.profileId);
      if (!transaction) throw new Error("Kupi action completed without a readable transaction.");
      receiptTime = Math.max(Date.now(), receiptTime + 1);
      const timestamp = new Date(receiptTime).toISOString();
      const receipt: KupiActionRecord = {
        id: action.id,
        profileId: action.profileId,
        actionJson: actionJson(action),
        transactionId,
        resultUpdatedAt: transaction.updatedAt,
        undoAvailable: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.kupiActions.add(receipt);
      results.set(action.id, {
        actionId: action.id,
        transactionId,
        updatedAt: transaction.updatedAt,
        replayed: false,
      });
    }
    await enforceUndoLimit(pending[0].profileId);
  });

  return actions.map((action) => {
    const result = results.get(action.id);
    if (!result) throw new Error("Kupi action result was not recorded.");
    return result;
  });
}

export interface UndoActionResult {
  actionId: string;
  transactionId: string;
  updatedAt: string;
  replayed: boolean;
}

function parseAction(record: KupiActionRecord): KupiAction {
  const action: unknown = JSON.parse(record.actionJson);
  if (!isKupiAction(action)) {
    throw new Error("Stored Kupi action receipt is invalid.");
  }
  return action;
}

function isKupiAction(value: unknown): value is KupiAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.profileId !== "string"
    || !Array.isArray(candidate.warnings)
    || !candidate.warnings.every((warning) => typeof warning === "string")
  ) return false;
  if (candidate.kind === "create" || candidate.kind === "transfer") {
    return candidate.before === null && Boolean(candidate.after) && typeof candidate.after === "object";
  }
  if (candidate.kind === "update") {
    return Boolean(candidate.before) && typeof candidate.before === "object"
      && Boolean(candidate.after) && typeof candidate.after === "object";
  }
  if (candidate.kind === "delete") {
    return Boolean(candidate.before) && typeof candidate.before === "object" && candidate.after === null;
  }
  return false;
}

async function applyUndo(action: KupiAction, transactionId: string): Promise<void> {
  switch (action.kind) {
    case "create":
    case "transfer":
      await softDeleteTransaction(transactionId, action.profileId);
      return;
    case "delete":
      await restoreTransaction(action.before.id, action.profileId);
      return;
    case "update":
      await applyUpdate(action.after, action.before);
      return;
  }
}

export async function undoAction(profileId: string, actionId: string): Promise<UndoActionResult> {
  const undoId = `${actionId}:undo`;
  let result: UndoActionResult | undefined;
  await db.transaction("rw", db.tables, async () => {
    const completedUndo = await db.kupiActions.get(undoId);
    if (completedUndo) {
      if (completedUndo.profileId !== profileId) throw new Error("Kupi action is not available in this profile.");
      result = {
        actionId,
        transactionId: completedUndo.transactionId,
        updatedAt: completedUndo.resultUpdatedAt,
        replayed: true,
      };
      return;
    }

    const receipt = await getProfileRecord(db.kupiActions, actionId, profileId);
    if (!receipt) throw new Error("Kupi action was not found in this profile.");
    if (receipt.undoneAt) throw new Error("Kupi action has already been undone.");
    if (!receipt.undoAvailable) throw new Error("This Kupi action is outside the undo history limit.");
    const action = parseAction(receipt);
    if (action.profileId !== profileId || action.id !== actionId) {
      throw new Error("Stored Kupi action receipt does not match its profile or id.");
    }
    const current = await getProfileRecord(db.transactions, receipt.transactionId, profileId);
    if (!current) throw new Error("The Kupi action transaction no longer exists.");
    if (current.updatedAt !== receipt.resultUpdatedAt) {
      throw new Error("This transaction changed after the Kupi action and cannot be safely undone.");
    }

    await applyUndo(action, receipt.transactionId);
    const restored = await getProfileRecord(db.transactions, receipt.transactionId, profileId);
    if (!restored) throw new Error("Kupi undo completed without a readable transaction.");
    const timestamp = new Date().toISOString();
    const undoReceipt: KupiActionRecord = {
      id: undoId,
      profileId,
      actionJson: JSON.stringify({ undoOf: actionId }),
      transactionId: restored.id,
      resultUpdatedAt: restored.updatedAt,
      undoAvailable: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.kupiActions.add(undoReceipt);
    await db.kupiActions.update(actionId, { undoAvailable: false, undoneAt: timestamp, updatedAt: timestamp });
    result = {
      actionId,
      transactionId: restored.id,
      updatedAt: restored.updatedAt,
      replayed: false,
    };
  });

  if (!result) throw new Error("Kupi undo result was not recorded.");
  return result;
}
