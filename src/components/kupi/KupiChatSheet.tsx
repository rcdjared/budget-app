import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle, Plus, Send, X } from "lucide-react";
import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import { createAccount } from "@/db/repositories/accounts";
import { formatMoney, parseMoney } from "@/domain/money";
import { loadAppSettings } from "@/lib/settings";
import type { Account, AccountType, Category, Transaction } from "@/domain/types";
import {
  type KupiAction,
  type KupiActionProposal,
  type KupiDbSnapshot,
  type KupiIntent,
  type DraftTxn,
  type Mood,
  type ParseResult,
  type SessionContext,
  type TargetRef,
  type Template,
} from "@/kupi/contracts";
import { commitAction, undoAction } from "@/kupi/actions/commit";
import { proposeAction } from "@/kupi/actions/propose";
import { validateAction } from "@/kupi/actions/validate";
import { reduceDialogue, type DialogueState } from "@/kupi/dialogue/reducer";
import { executeStatsQuery } from "@/kupi/queries/executeStatsQuery";
import { generateResponse, type ResponseFacts } from "@/kupi/responses/generateResponse";
import type { StatsQueryResult } from "@/kupi/queries/executeStatsQuery";
import { RESPONSE_TEMPLATES } from "@/kupi/responses/responseTemplates";
import { parseKupiInput } from "@/kupi/parser/parseKupiInput";
import { KupiActionReviewCard, KupiUndoToast } from "./KupiActionReviewCard";

type ChatMessage = { role: "user" | "assistant"; text: string; mood?: Mood };

interface PendingCandidates {
  result: ParseResult;
}

interface PendingIntentChoice {
  text: string;
  result: ParseResult;
}

type SetupDraft =
  | { kind: "account"; name: string; type: AccountType; amount: number }
  | { kind: "budget"; category: Category; amount: number };

const STARTER_MESSAGES = [
  "Coffee 180 today",
  "Salary 30k",
  "How much did I spend this month?",
];

function moneyFact(amount: number): string {
  return formatMoney(amount).replace(/^[^\d-]*/u, "");
}

function factsForQuery(result: StatsQueryResult): ResponseFacts {
  const facts: Record<string, string | number> = {};
  switch (result.metric) {
    case "total":
    case "daily_average":
      facts.periodTotal = moneyFact(result.amountCentavos);
      facts.periodLabel = result.period.label;
      facts.count = result.transactionCount;
      if (result.metric === "daily_average") facts.dailyAverage = moneyFact(result.amountCentavos);
      if (result.groups?.[0]) {
        facts.topCategory = result.groups[0].name;
        facts.topAmount = moneyFact(result.groups[0].amountCentavos);
      }
      break;
    case "by_category":
      facts.periodTotal = moneyFact(result.amountCentavos);
      facts.periodLabel = result.period.label;
      facts.count = result.groups.reduce((sum, group) => sum + group.transactionCount, 0);
      if (result.groups[0]) {
        facts.topCategory = result.groups[0].name;
        facts.topAmount = moneyFact(result.groups[0].amountCentavos);
      }
      if (result.groups[1]) {
        facts.secondCategory = result.groups[1].name;
        facts.secondAmount = moneyFact(result.groups[1].amountCentavos);
      }
      break;
    case "top_category":
      facts.periodTotal = moneyFact(result.amountCentavos);
      facts.periodLabel = result.period.label;
      facts.topCategory = result.top?.name ?? "No spending";
      facts.topAmount = moneyFact(result.top?.amountCentavos ?? 0);
      facts.count = result.top?.transactionCount ?? 0;
      break;
    case "biggest_expense":
      facts.periodLabel = result.period.label;
      facts.biggestAmount = moneyFact(result.transaction?.amountCentavos ?? 0);
      facts.biggestNote = result.transaction?.note || result.transaction?.category || "No expense";
      facts.biggestDate = result.transaction?.date ?? "—";
      break;
    case "count":
      facts.periodLabel = result.period.label;
      facts.count = result.transactionCount;
      break;
    case "remaining_budget":
      facts.catRemaining = moneyFact(result.amountCentavos);
      facts.periodTotal = moneyFact(result.amountCentavos);
      break;
    case "safe_to_spend":
      facts.dailySafe = moneyFact(result.dailyAmountCentavos);
      facts.periodTotal = moneyFact(result.dailyAmountCentavos);
      break;
    case "vs_last_period":
      facts.periodTotal = moneyFact(result.currentAmountCentavos);
      facts.periodLabel = result.period.label;
      facts.comparePeriodLabel = result.previousPeriod.label;
      facts.diffAmount = moneyFact(Math.abs(result.changeCentavos));
      break;
    case "net_worth":
      facts.netWorth = moneyFact(result.netWorthCentavos);
      facts.periodTotal = moneyFact(result.netWorthCentavos);
      break;
  }
  return facts;
}

function summaryForQuery(result: StatsQueryResult): string {
  switch (result.metric) {
    case "total":
      return `You spent ${formatMoney(result.amountCentavos)} ${result.period.label} across ${result.transactionCount} transactions.`;
    case "daily_average":
      return `Your daily average was ${formatMoney(result.amountCentavos)} ${result.period.label}.`;
    case "by_category":
      return result.groups.length
        ? `Spending ${result.period.label}: ${result.groups.slice(0, 3).map((group) => `${group.name} ${formatMoney(group.amountCentavos)}`).join(", ")}.`
        : `No spending found ${result.period.label}.`;
    case "top_category":
      return result.top
        ? `${result.top.name} was your top category ${result.period.label} at ${formatMoney(result.top.amountCentavos)}.`
        : `No spending found ${result.period.label}.`;
    case "biggest_expense":
      return result.transaction
        ? `Your biggest expense ${result.period.label} was ${formatMoney(result.transaction.amountCentavos)} for ${result.transaction.note || result.transaction.category} on ${result.transaction.date}.`
        : `No expenses found ${result.period.label}.`;
    case "count":
      return `You have ${result.transactionCount} transactions ${result.period.label}.`;
    case "remaining_budget":
      return result.budgetsFound
        ? `${formatMoney(result.amountCentavos)} remains across ${result.budgetCount} active budgets in this budget cycle.`
        : "There are no active budgets to calculate what remains.";
    case "safe_to_spend":
      return result.budgetsFound
        ? `Your safe-to-spend estimate is ${formatMoney(result.dailyAmountCentavos)} per day for the current budget cycle.`
        : "There are no active budgets to calculate safe-to-spend.";
    case "vs_last_period": {
      const direction = result.changeCentavos > 0 ? "more" : result.changeCentavos < 0 ? "less" : "the same";
      return `You spent ${formatMoney(result.currentAmountCentavos)} ${result.period.label}, ${direction} than ${result.previousPeriod.label} by ${formatMoney(Math.abs(result.changeCentavos))}.`;
    }
    case "net_worth":
      return `Your net worth is ${formatMoney(result.netWorthCentavos)}.`;
  }
  throw new Error("Unsupported stats query result.");
}

function resolveTargetTransaction(
  target: TargetRef | undefined,
  transactions: readonly Transaction[],
  lastTxnId?: string
): Transaction | undefined {
  if (!target || typeof target !== "object") return undefined;
  const ref = target;
  if (ref.kind === "id" && ref.id) return transactions.find((transaction) => transaction.id === ref.id);
  if (ref.kind === "last") return transactions.find((transaction) => transaction.id === lastTxnId);
  if (ref.kind === "match") {
    return transactions.find((transaction) =>
      (ref.amount === undefined || transaction.amount === ref.amount)
      && (ref.date === undefined || transaction.date === ref.date)
      && (ref.category === undefined || transaction.categoryId === ref.category)
      && (ref.note === undefined || transaction.note?.toLowerCase().includes(ref.note.toLowerCase()))
    );
  }
  return undefined;
}

function actionResponseFacts(
  action: KupiAction,
  accounts: readonly Account[],
  categories: readonly Category[]
): ResponseFacts {
  if (action.kind === "create") {
    const tx = action.after;
    return {
      amount: moneyFact(tx.amount),
      category: categories.find(({ id }) => id === tx.categoryId)?.name ?? "Uncategorized",
      account: accounts.find(({ id }) => id === tx.accountId)?.name ?? "your account",
      date: tx.date,
    };
  }
  if (action.kind === "transfer") {
    return {
      amount: moneyFact(action.after.amount),
      fromAccount: accounts.find(({ id }) => id === action.after.accountId)?.name ?? "your account",
      toAccount: accounts.find(({ id }) => id === action.after.toAccountId)?.name ?? "external",
      fee: moneyFact(action.after.transferFee),
    };
  }
  if (action.kind === "update") {
    let field: string;
    let oldValue: string;
    let newValue: string;
    if (action.before.amount !== action.after.amount) {
      field = "amount";
      oldValue = moneyFact(action.before.amount);
      newValue = moneyFact(action.after.amount);
    } else if (action.before.accountId !== action.after.accountId) {
      field = "account";
      oldValue = accounts.find(({ id }) => id === action.before.accountId)?.name ?? "Unknown account";
      newValue = accounts.find(({ id }) => id === action.after.accountId)?.name ?? "Unknown account";
    } else if (action.before.categoryId !== action.after.categoryId) {
      field = "category";
      oldValue = categories.find(({ id }) => id === action.before.categoryId)?.name ?? "Uncategorized";
      newValue = categories.find(({ id }) => id === action.after.categoryId)?.name ?? "Uncategorized";
    } else if (action.before.date !== action.after.date) {
      field = "date";
      oldValue = action.before.date;
      newValue = action.after.date;
    } else {
      field = "note";
      oldValue = action.before.note ?? "";
      newValue = action.after.note ?? "";
    }
    return {
      field,
      oldValue,
      newValue,
      category: categories.find(({ id }) => id === action.after.categoryId)?.name ?? "Uncategorized",
      oldAmount: moneyFact(action.before.amount),
      newAmount: moneyFact(action.after.amount),
    };
  }
  return {
    amount: moneyFact(action.before.amount),
    category: categories.find(({ id }) => id === action.before.categoryId)?.name ?? "Uncategorized",
    date: action.before.date,
  };
}

export function KupiChatSheet({
  open,
  onClose,
  onOpenForm,
  profileId,
  initialMessage,
  initialMood = "idle",
}: {
  open: boolean;
  onClose: () => void;
  onOpenForm: () => void;
  profileId: string;
  initialMessage?: string;
  initialMood?: Mood;
}) {
  const accounts = useLiveQuery(
    () => profileRecords(db.accounts, profileId).filter((account) => !account.deletedAt && !account.isArchived).toArray(),
    [profileId]
  );
  const categories = useLiveQuery(
    () => profileRecords(db.categories, profileId).filter((category) => !category.deletedAt).toArray(),
    [profileId]
  );
  const transactions = useLiveQuery(
    () => profileRecords(db.transactions, profileId).filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt).toArray(),
    [profileId]
  );
  const budgets = useLiveQuery(
    () => profileRecords(db.budgets, profileId).filter((budget) => !budget.deletedAt).toArray(),
    [profileId]
  );

  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<KupiAction[]>([]);
  const [actionWarnings, setActionWarnings] = useState<string[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState<PendingCandidates | null>(null);
  const [pendingIntentChoice, setPendingIntentChoice] = useState<PendingIntentChoice | null>(null);
  const [bestGuessResult, setBestGuessResult] = useState<ParseResult | null>(null);
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [dialogue, setDialogue] = useState<DialogueState>({ status: "idle" });
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [undoActionIds, setUndoActionIds] = useState<string[]>([]);
  const [avatarMood, setAvatarMood] = useState<Mood>("idle");
  const [viewport, setViewport] = useState({ height: 0, top: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const undoTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<SessionContext>({
    recentTemplateIds: [],
    personality: "classic",
    rngSeed: 984_271,
  });

  useEffect(() => {
    if (!open) return;
    const visualViewport = window.visualViewport;
    const updateViewport = () => {
      setViewport({
        height: visualViewport?.height ?? window.innerHeight,
        top: visualViewport?.offsetTop ?? 0,
      });
    };
    updateViewport();
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [open]);

  useEffect(() => {
    sessionRef.current = {
      recentTemplateIds: [],
      personality: "classic",
      rngSeed: 984_271,
    };
    setConversation([]);
    setPendingActions([]);
    setActionWarnings([]);
    setPendingCandidates(null);
    setPendingIntentChoice(null);
    setBestGuessResult(null);
    setSetupDraft(null);
    setDialogue({ status: "idle" });
    setUndoActionIds([]);
    setMessage("");
    setError("");
    setAvatarMood("idle");
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, [profileId]);

  useEffect(() => {
    if (!open || !initialMessage) return;
    sessionRef.current = {
      recentTemplateIds: [],
      personality: "classic",
      rngSeed: 984_271,
    };
    setConversation([{ role: "assistant", text: initialMessage, mood: initialMood }]);
    setPendingActions([]);
    setActionWarnings([]);
    setPendingCandidates(null);
    setPendingIntentChoice(null);
    setBestGuessResult(null);
    setSetupDraft(null);
    setDialogue({ status: "idle" });
    setTyping(false);
    setBusy(false);
    setMessage("");
    setError("");
    setAvatarMood(initialMood);
  }, [open, initialMessage, initialMood]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 120);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversation, pendingActions, pendingCandidates, pendingIntentChoice, bestGuessResult, setupDraft, typing]);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, []);

  const scopedTransactions = transactions ?? [];
  const scopedAccounts = accounts ?? [];
  const scopedCategories = categories ?? [];
  const scopedBudgets = budgets ?? [];
  const dataReady = accounts !== undefined && categories !== undefined
    && transactions !== undefined && budgets !== undefined;

  const getSnapshot = (): KupiDbSnapshot => ({
    accounts: scopedAccounts.map(({ id, name }) => ({ id, name })),
    categories: scopedCategories.map(({ id, name }) => ({ id, name })),
    txns: scopedTransactions.map((transaction) => ({
      id: transaction.id,
      amountCentavos: transaction.amount,
      category: scopedCategories.find(({ id }) => id === transaction.categoryId)?.name ?? null,
      account: scopedAccounts.find(({ id }) => id === transaction.accountId)?.name,
      date: transaction.date,
      note: transaction.note ?? undefined,
      type: transaction.type === "expense" || transaction.type === "income" || transaction.type === "transfer"
        ? transaction.type
        : undefined,
      createdAt: transaction.createdAt,
    })),
  });

  const chooseResponse = (
    intent: KupiIntent,
    stage: Template["stage"] | undefined,
    facts: ResponseFacts,
    moodState: Parameters<typeof generateResponse>[0]["state"]
  ): { text: string; mood: Mood } | null => {
    const usableTemplates = RESPONSE_TEMPLATES.filter((template) =>
      template.intent === intent
      && (stage === undefined || template.stage === stage)
      && template.vars.every((key) => Object.prototype.hasOwnProperty.call(facts, key))
    );
    if (!usableTemplates.length) return null;
    const settings = loadAppSettings();
    const generated = generateResponse({
      state: moodState,
      language: settings.language === "fil" ? "en-tl" : "en",
      personality: sessionRef.current.personality,
      facts,
      recentTemplateIds: sessionRef.current.recentTemplateIds,
      rngSeed: sessionRef.current.rngSeed,
      templates: usableTemplates,
      stage,
    });
    if (!generated) return null;
    sessionRef.current = {
      ...sessionRef.current,
      recentTemplateIds: generated.recentTemplateIds,
      rngSeed: generated.rngSeed,
    };
    return { text: generated.text, mood: generated.mood };
  };

  const addAssistant = (text: string, mood: Mood = "idle") => {
    setAvatarMood(mood);
    setConversation((current) => [...current, { role: "assistant", text, mood }]);
  };

  const proposeForResult = (result: ParseResult): { actions: KupiAction[]; warnings: string[] } => {
    const now = new Date();
    const proposals: KupiActionProposal[] = [];
    const defaultAccount = scopedAccounts[0];
    const accountByName = (name: string | undefined) =>
      scopedAccounts.find((account) => account.name.toLowerCase() === name?.toLowerCase());
    const categoryByName = (name: string | null | undefined, type: "expense" | "income") =>
      scopedCategories.find((category) => category.type === type && category.name.toLowerCase() === name?.toLowerCase());
    const defaultAccountWarnings: string[] = [];

    if (result.intent === "LOG_EXPENSE" || result.intent === "LOG_INCOME" || result.intent === "TRANSFER") {
      if (!result.drafts.length) throw new Error("I need a complete transaction before I can prepare a review card.");
      if (!scopedAccounts.length) throw new Error("Add an account before logging a transaction.");
      for (const draft of result.drafts) {
        const type = draft.type;
        const namedAccount = draft.account ? accountByName(draft.account.value) : undefined;
        if (draft.account && !namedAccount) {
          throw new Error(`The account ${draft.account.value} is no longer available in this profile.`);
        }
        const account = namedAccount ?? defaultAccount;
        const date = draft.date?.value ?? (() => {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).formatToParts(now);
          const values = Object.fromEntries(parts.map(({ type: partType, value }) => [partType, value]));
          return `${values.year}-${values.month}-${values.day}`;
        })();
        if (!draft.account && account) defaultAccountWarnings.push(`Using your first available account, ${account.name}.`);
        if (type === "transfer") {
          const toAccount = accountByName(draft.toAccount?.value);
          if (draft.toAccount && !toAccount) {
            throw new Error(`The destination account ${draft.toAccount.value} is no longer available in this profile.`);
          }
          if (!draft.amount?.value || !account || !toAccount) {
            throw new Error("A transfer needs an amount, source account, and destination account.");
          }
          const fee = draft.fee?.value ?? 0;
          const feeCategory = scopedCategories.find((category) =>
            category.type === "expense" && /transfer fee|fees? & charges/i.test(category.name)
          );
          proposals.push({
            kind: "transfer",
            profileId,
            after: {
              profileId,
              amount: draft.amount.value,
              accountId: account.id,
              toAccountId: toAccount.id,
              sourceType: "my",
              destinationType: "my",
              transferFee: fee,
              feeCategoryId: fee ? feeCategory?.id ?? null : null,
              date,
              time: "",
              note: draft.note ?? null,
            },
          });
          continue;
        }
        if (!draft.amount?.value || !account) {
          throw new Error("I need an amount and account before I can prepare a review card.");
        }
        const category = draft.category
          ? categoryByName(draft.category.value, type)
          : undefined;
        if (draft.category?.value && !category) {
          throw new Error(`The category ${draft.category.value} is no longer available in this profile.`);
        }
        proposals.push({
          kind: "create",
          profileId,
          after: {
            profileId,
            type,
            amount: draft.amount.value,
            accountId: account.id,
            categoryId: category?.id ?? null,
            date,
            note: draft.note?.trim() || null,
          },
        });
      }
    } else if (result.intent === "EDIT_TXN" && result.edit) {
      const transaction = resolveTargetTransaction(
        result.edit.target,
        scopedTransactions,
        sessionRef.current.lastTxnId
      );
      if (!transaction) throw new Error("I couldn't find that transaction in this profile.");
      const field = result.edit.field;
      const value = result.edit.value;
      let changes: Partial<Transaction>;
      if (field === "amount" && typeof value === "number") changes = { amount: value };
      else if (field === "account" && typeof value === "string") {
        const account = accountByName(value);
        if (!account) throw new Error(`I couldn't find an account named ${value} in this profile.`);
        changes = { accountId: account.id };
      } else if (field === "category" && typeof value === "string") {
        const category = categoryByName(value, transaction.type === "income" ? "income" : "expense");
        if (!category) throw new Error(`I couldn't find a category named ${value} in this profile.`);
        changes = { categoryId: category.id };
      } else if (field === "date" && typeof value === "string") changes = { date: value };
      else if (field === "note" && typeof value === "string") changes = { note: value };
      else throw new Error("I couldn't safely prepare that edit. Please include the new amount, account, or date.");
      proposals.push({ kind: "update", profileId, before: transaction, changes });
    } else if (result.intent === "DELETE_TXN" && result.deleteTarget) {
      const transaction = resolveTargetTransaction(
        result.deleteTarget,
        scopedTransactions,
        sessionRef.current.lastTxnId
      );
      if (!transaction) throw new Error("I couldn't find that transaction in this profile.");
      proposals.push({ kind: "delete", profileId, before: transaction });
    } else {
      throw new Error("I couldn't prepare that action safely.");
    }

    const actions = proposeAction(proposals);
    const warnings = [...defaultAccountWarnings];
    for (const action of actions) {
      const validation = validateAction(action, {
        accounts: scopedAccounts,
        categories: scopedCategories,
        txns: scopedTransactions,
        now,
      });
      if (!validation.valid) throw new Error(validation.errors.join(" "));
      warnings.push(...validation.warnings);
    }
    return { actions, warnings: [...new Set(warnings)] };
  };

  const getActionIntent = (action: KupiAction): KupiIntent => {
    if (action.kind === "create") return action.after.type === "income" ? "LOG_INCOME" : "LOG_EXPENSE";
    if (action.kind === "transfer") return "TRANSFER";
    if (action.kind === "update") return "EDIT_TXN";
    return "DELETE_TXN";
  };

  const responseForAction = (action: KupiAction, stage: "confirm" | "done") => {
    const intent = getActionIntent(action);
    const facts: Record<string, string | number> = {
      ...actionResponseFacts(action, scopedAccounts, scopedCategories),
    };
    const moodState: Parameters<typeof generateResponse>[0]["state"] = { intent };
    if (action.kind === "create" && action.after.type === "expense" && action.after.categoryId) {
      const budget = scopedBudgets.find(({ categoryId }) => categoryId === action.after.categoryId);
      if (budget) {
        const remaining = executeStatsQuery({
          metric: "remaining_budget",
          filters: { category: budget.categoryId },
        }, {
          accounts: scopedAccounts,
          budgets: scopedBudgets,
          categories: scopedCategories,
          transactions: scopedTransactions,
          now: new Date(),
        });
        const remainingCentavos = remaining.metric === "remaining_budget"
          ? remaining.amountCentavos - action.after.amount
          : 0;
        const spent = budget.amount - remainingCentavos;
        moodState.catPercent = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
        moodState.amountPctOfBudget = budget.amount > 0 ? (action.after.amount / budget.amount) * 100 : 0;
        facts.catPercent = Math.round(moodState.catPercent);
        facts.catRemaining = moneyFact(remainingCentavos);
      }
    }
    return chooseResponse(intent, stage, facts, moodState);
  };

  const commitPending = async (actions: readonly KupiAction[]) => {
    if (!actions.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await commitAction(actions, true);
      setPendingActions([]);
      setActionWarnings([]);
      setPendingCandidates(null);
      setDialogue({ status: "idle" });
      sessionRef.current = { ...sessionRef.current, pending: undefined };
      sessionRef.current.lastTxnId = result[result.length - 1]?.transactionId;
      const generated = actions.length === 1 ? responseForAction(actions[0], "done") : null;
      addAssistant(
        generated?.text ?? `Saved ${actions.length} ${actions.length === 1 ? "transaction" : "transactions"} to your ledger.`,
        generated?.mood ?? "idle"
      );
      setUndoActionIds(actions.map(({ id }) => id));
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setUndoActionIds([]), 8_000);
    } catch (commitError) {
      const text = commitError instanceof Error ? commitError.message : "The transaction could not be saved.";
      setError(text);
      addAssistant(`I couldn't save that safely: ${text}`, "idle");
    } finally {
      setBusy(false);
    }
  };

  const undoLastCommit = async () => {
    if (!undoActionIds.length) return;
    setBusy(true);
    setError("");
    try {
      for (const actionId of [...undoActionIds].reverse()) await undoAction(profileId, actionId);
      setUndoActionIds([]);
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      addAssistant("Undone. Your ledger has been restored.", "idle");
      sessionRef.current = { ...sessionRef.current, lastTxnId: undefined };
    } catch (undoError) {
      const text = undoError instanceof Error ? undoError.message : "That action could not be undone.";
      setError(text);
      addAssistant(`I couldn't undo that safely: ${text}`, "idle");
    } finally {
      setBusy(false);
    }
  };

  const handleParsedResult = (result: ParseResult, text: string) => {
    const nextDialogue = reduceDialogue(dialogue, { type: "parsed", result });
    setDialogue(nextDialogue);
    setPendingCandidates(null);
    setPendingIntentChoice(null);
    setBestGuessResult(null);
    if (result.intent !== "CONFIRM" && result.intent !== "CANCEL" && result.intent !== "UNDO") {
      setPendingActions([]);
      setActionWarnings([]);
      if (
        sessionRef.current.pending?.kind === "confirmAction"
        || sessionRef.current.pending?.intent !== result.intent
      ) {
        sessionRef.current = { ...sessionRef.current, pending: undefined };
      }
    }

    if (result.intent === "CONFIRM") {
      if (pendingActions.length) void commitPending(pendingActions);
      else addAssistant("There isn't a transaction waiting for confirmation.");
      return;
    }
    if (result.intent === "CANCEL") {
      setPendingActions([]);
      setActionWarnings([]);
      setDialogue({ status: "idle" });
      sessionRef.current = { ...sessionRef.current, pending: undefined };
      addAssistant("Cancelled. Nothing was saved.");
      return;
    }
    if (result.intent === "UNDO") {
      if (pendingActions.length) {
        addAssistant("That change has not been saved yet. Confirm or cancel its review card first.");
      } else {
        sessionRef.current = { ...sessionRef.current, pending: undefined };
        if (undoActionIds.length) void undoLastCommit();
        else addAssistant("There is nothing recent to undo.");
      }
      return;
    }
    if (result.targetCandidates?.length) {
      setPendingCandidates({ result });
      addAssistant("I found a few possible matches. Choose the transaction you mean.");
      return;
    }
    if (result.missing.length) {
      const slot = nextDialogue.status === "awaitingSlot" ? nextDialogue.slot : result.missing[0];
      const canUseBestGuess = nextDialogue.status === "awaitingSlot"
        && nextDialogue.questionLimitReached
        && result.drafts.length > 0
        && result.drafts.every((draft) => Boolean(draft.amount?.value))
        && result.missing.every((missing) => missing === "category")
        && ["LOG_EXPENSE", "LOG_INCOME"].includes(result.intent);
      const question = nextDialogue.status === "awaitingSlot" && nextDialogue.questionLimitReached
        ? canUseBestGuess
          ? `I still need a category. I can leave it uncategorized for your review; nothing will be saved unless you confirm.`
          : `I still need a clear ${slot}. Send the transaction details together; nothing has been saved.`
        : `I need the ${slot} before I can prepare a review card.`;
      if (canUseBestGuess) setBestGuessResult({ ...result, missing: [], tier: "confirm" });
      sessionRef.current = {
        ...sessionRef.current,
        pending: {
          kind: "slot",
          slot,
          intent: result.intent,
          draft: result.drafts[0],
        },
      };
      addAssistant(question);
      return;
    }
    if (
      result.tier === "ask"
      && ["LOG_EXPENSE", "LOG_INCOME", "TRANSFER", "EDIT_TXN", "DELETE_TXN"].includes(result.intent)
    ) {
      const clarification = result.flags.includes("trailing_account_scope")
        ? "Which account should the other transactions use? I won't guess."
        : result.flags.includes("trailing_date_scope")
          ? "Should that date apply to all the listed transactions? I won't guess."
          : result.flags.includes("same_account")
            ? "Choose two different accounts for the transfer."
            : result.flags.includes("future_date")
              ? "That date is in the future. Send a date today or earlier."
              : "I need one detail clarified before preparing a safe review card.";
      addAssistant(clarification);
      return;
    }
    if (
      result.alternatives.length
      && ["LOG_EXPENSE", "LOG_INCOME", "TRANSFER"].includes(result.intent)
    ) {
      setPendingIntentChoice({ text, result });
      addAssistant("Did you mean one of these? Choose the intended action before I prepare anything.");
      return;
    }
    if (result.intent === "LOG_EXPENSE" || result.intent === "LOG_INCOME" || result.intent === "TRANSFER"
      || result.intent === "EDIT_TXN" || result.intent === "DELETE_TXN") {
      try {
        const review = proposeForResult(result);
        setPendingActions(review.actions);
        setActionWarnings(review.warnings);
        sessionRef.current = {
          ...sessionRef.current,
          pending: { kind: "confirmAction", actionId: review.actions[0]?.id },
        };
        const response = review.actions.length === 1 ? responseForAction(review.actions[0], "confirm") : null;
        addAssistant(response?.text ?? "Review the details below. Nothing will be saved until you confirm.", response?.mood ?? "idle");
      } catch (proposalError) {
        const text = proposalError instanceof Error ? proposalError.message : "I couldn't prepare that action.";
        setError(text);
        if (text.includes("Add an account")) {
          addAssistant(`${text} Use the transaction form to add one.`, "idle");
        } else {
          addAssistant(`I couldn't prepare that safely: ${text}`, "idle");
        }
      }
      return;
    }
    if (result.intent === "QUERY_STATS" && result.query) {
      const queryResult = executeStatsQuery(result.query, {
        accounts: scopedAccounts,
        budgets: scopedBudgets,
        categories: scopedCategories,
        transactions: scopedTransactions,
        now: new Date(),
      });
      const facts = factsForQuery(queryResult);
      const response = chooseResponse("QUERY_STATS", undefined, facts, { intent: "QUERY_STATS" });
      addAssistant(response?.text ?? summaryForQuery(queryResult), response?.mood ?? "idle");
      return;
    }
    if (result.intent === "HELP") {
      const response = chooseResponse("HELP", undefined, {}, { intent: "HELP" });
      addAssistant(response?.text ?? "I can log expenses or income, move money between accounts, edit or delete a transaction, and answer questions about your budget.", "idle");
      return;
    }
    if (result.unsupported) {
      addAssistant(`I can't handle ${result.unsupported.replace("_", " ")} yet. Your data stays unchanged.`, "idle");
      return;
    }
    if (result.intent === "SMALLTALK") {
      const response = chooseResponse("SMALLTALK", undefined, {}, { intent: "SMALLTALK" });
      addAssistant(response?.text ?? "Hi! Ready when you are. Want to log something or check your budget?", "idle");
      return;
    }
    if (result.intent === "CLARIFY") {
      addAssistant("Could you say what you want to do? For example, “log coffee 180” or “change my last expense to 45.”");
      return;
    }
    const response = chooseResponse("UNKNOWN", undefined, {}, { intent: "UNKNOWN" });
    addAssistant(response?.text ?? "I didn't catch that. Try a transaction, an edit, or a money question. Your ledger hasn't changed.", "idle");
  };

  const saveSetupDraft = async (draft: SetupDraft) => {
    try {
      if (draft.kind === "account") {
        const duplicate = scopedAccounts.some((account) => account.name.toLowerCase() === draft.name.toLowerCase());
        if (duplicate) {
          addAssistant(`An account named ${draft.name} already exists in this profile.`);
          return;
        }
        await createAccount({
          profileId,
          name: draft.name,
          type: draft.type,
          openingBalance: draft.amount,
          currency: "PHP",
          color: draft.type === "cash" ? "#22C55E" : "#019B51",
          icon: draft.type === "cash" ? "banknote" : draft.type === "ewallet" ? "wallet" : "landmark",
          isArchived: false,
        });
        addAssistant(`Saved ${draft.name} with an opening balance of ${formatMoney(draft.amount)}.`);
        return;
      }

      const existing = await profileRecords(db.budgets, profileId)
        .filter((budget) => !budget.deletedAt && budget.categoryId === draft.category.id && budget.period === "monthly")
        .first();
      const timestamp = new Date().toISOString();
      await db.budgets.put({
        id: existing?.id || crypto.randomUUID(),
        profileId,
        categoryId: draft.category.id,
        period: "monthly",
        amount: draft.amount,
        rolloverEnabled: existing?.rolloverEnabled ?? false,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      });
      addAssistant(`Saved a monthly ${draft.category.name} budget of ${formatMoney(draft.amount)}.`);
    } catch (saveError) {
      const detail = saveError instanceof Error ? saveError.message : "The setup change could not be saved.";
      setError(detail);
      addAssistant(`I couldn't save that safely: ${detail}`, "idle");
    } finally {
      setSetupDraft(null);
    }
  };

  const prepareSetupDraft = (text: string): boolean => {
    const amountText = text.match(/(?:₱|php|\$)?\s*(\d[\d,]*(?:\.\d{1,2})?\s*[km]?)/i)?.[1];
    const amount = amountText ? parseMoney(amountText) : null;
    const accountIntent = /\b(?:create|add|set up|make)\b.*\b(account|wallet|bank)\b/i.test(text);
    if (accountIntent) {
      const name = text.match(/\b(?:account|wallet|bank)\s+(?:named|called)\s+["']?(.+?)["']?(?=\s+(?:with|and)\s+(?:an?\s+)?(?:opening\s+)?balance|[,;.]|$)/i)?.[1]?.trim();
      if (!name || amount === null) {
        addAssistant("To set up an account, include its name and opening balance, for example: “Add account named Savings with opening balance 500.”");
        return true;
      }
      const type: AccountType = /\bcash\b/i.test(text) ? "cash"
        : /\b(wallet|e-?wallet|gcash|maya|paymaya)\b/i.test(text) ? "ewallet"
        : /\bcredit\s*card\b/i.test(text) ? "credit_card"
        : /\binvestment\b/i.test(text) ? "investment"
        : /\bloan\b/i.test(text) ? "loan"
        : "bank";
      setSetupDraft({ kind: "account", name, type, amount });
      addAssistant(`Review the new ${type.replace("_", " ")} account and opening balance below.`);
      return true;
    }

    const budgetIntent = /\b(?:create|add|set|make|keep|cap)\b.*\b(budget|spending limit|spending|spend)\b/i.test(text)
      || /\b(?:monthly|weekly|daily)\s+budget\b/i.test(text);
    if (!budgetIntent) return false;
    const aliases: Record<string, string[]> = {
      "Food & Dining": ["food", "dining", "meal", "meals", "restaurant"],
      Transportation: ["transport", "transportation", "commute", "commuting", "travel"],
      "Bills & Utilities": ["bills", "utilities", "utility"],
      "Housing & Rent": ["housing", "rent"],
      "Health & Wellness": ["health", "wellness", "medical"],
      "Entertainment & Leisure": ["entertainment", "leisure"],
      "Personal Care & Beauty": ["personal care", "beauty"],
    };
    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const expenseCategories = scopedCategories.filter((category) => category.type === "expense");
    const category = [...expenseCategories]
      .sort((a, b) => b.name.length - a.name.length)
      .find((candidate) => {
        const name = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        return normalized.includes(name)
          || (aliases[candidate.name] ?? []).some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(normalized));
      });
    if (!category || amount === null) {
      addAssistant("Tell me the spending category and monthly limit, for example: “Set a Food budget of 500.”");
      return true;
    }
    setSetupDraft({ kind: "budget", category, amount });
    addAssistant(`Review the monthly ${category.name} budget below.`);
    return true;
  };

  const processMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy || typing) return;
    setMessage("");
    setError("");
    setConversation((current) => [...current, { role: "user", text }]);
    setTyping(true);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    try {
      if (!dataReady) throw new Error("Your profile data is still loading. Please try again in a moment.");
      if (setupDraft && /^(?:yes|y|yes save|confirm|save it|looks good|correct)[.! ]*$/i.test(text)) {
        setSetupDraft(null);
        await saveSetupDraft(setupDraft);
        return;
      }
      if (setupDraft && /^(?:no|n|change|edit|not quite|cancel)[.! ]*$/i.test(text)) {
        setSetupDraft(null);
        addAssistant("Cancelled. Nothing was saved.");
        return;
      }
      if (setupDraft) setSetupDraft(null);
      if (prepareSetupDraft(text)) {
        setPendingActions([]);
        setActionWarnings([]);
        setPendingCandidates(null);
        setPendingIntentChoice(null);
        setBestGuessResult(null);
        setDialogue({ status: "idle" });
        sessionRef.current = { ...sessionRef.current, pending: undefined };
        return;
      }
      const now = new Date();
      const context = sessionRef.current;
      const result = parseKupiInput(text, context, getSnapshot(), now);
      handleParsedResult(result, text);
    } catch (processingError) {
      const detail = processingError instanceof Error ? processingError.message : "Message processing failed.";
      setError(detail);
      addAssistant(`I couldn't process that safely: ${detail}`, "idle");
    } finally {
      setTyping(false);
    }
  };

  const selectCandidate = (transactionId: string) => {
    const transaction = scopedTransactions.find(({ id }) => id === transactionId);
    if (!transaction || !pendingCandidates) return;
    sessionRef.current = { ...sessionRef.current, lastTxnId: transactionId, pending: undefined };
    const { result } = pendingCandidates;
    setPendingCandidates(null);
    if (result.intent === "DELETE_TXN") {
      const selected: ParseResult = {
        ...result,
        targetCandidates: undefined,
        deleteTarget: { kind: "id", id: transactionId },
        missing: [],
      };
      setConversation((current) => [...current, { role: "assistant", text: "Selected. Please review the delete card before anything changes." }]);
      handleParsedResult(selected, "delete selected transaction");
    } else {
      addAssistant(`Selected ${transaction.note || transaction.categoryId || "transaction"}. What should I change? For example, “make that 45” or “kahapon pala.”`);
    }
  };

  const selectIntent = (intent: KupiIntent) => {
    if (!pendingIntentChoice) return;
    const source = pendingIntentChoice.result;
    const sourceText = pendingIntentChoice.text;
    let result: ParseResult = { ...source, intent, alternatives: [], tier: "confirm" };
    if (intent !== source.intent) {
      const type: DraftTxn["type"] = intent === "LOG_INCOME"
        ? "income"
        : intent === "TRANSFER"
          ? "transfer"
          : "expense";
      const drafts = source.drafts.map((draft) => {
        const category = type === "transfer"
          ? undefined
          : draft.category && scopedCategories.some((item) =>
              item.type === type && item.name.toLowerCase() === draft.category?.value?.toLowerCase()
            )
            ? draft.category
            : undefined;
        return { ...draft, type, category };
      });
      const missing = [...source.missing];
      if (type !== "transfer" && drafts.some((draft) => !draft.category) && !missing.includes("category")) {
        missing.push("category");
      }
      if (type === "transfer") {
        if (drafts.some((draft) => !draft.account) && !missing.includes("fromAccount")) missing.push("fromAccount");
        if (drafts.some((draft) => !draft.toAccount) && !missing.includes("toAccount")) missing.push("toAccount");
      }
      result = { ...result, drafts, missing };
    }
    setPendingIntentChoice(null);
    handleParsedResult(result, sourceText);
  };

  const avatarSrc = typing
    ? "/icons/idle.png"
    : avatarMood === "happy"
      ? "/icons/happy.png"
      : avatarMood === "worried"
        ? "/icons/worried.png"
        : "/icons/idle.png";

  if (!open) return null;
  return (
    <div
      className="sheet-backdrop kupi-chat-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Kupi chat"
      style={viewport.height ? { height: viewport.height, top: viewport.top } : undefined}
    >
      <section className={`account-sheet chat-sheet chat-screen kupi-chat-screen${typing ? " is-thinking" : ""}`}>
        <header className="sheet-header kupi-chat-header">
          <button type="button" onClick={onClose} aria-label="Close Kupi chat">
            <X size={20} />
          </button>
          <img className={`kupi-chat-avatar${typing ? " kupi-chat-avatar-thinking" : ""}`} src={avatarSrc} alt={`Kupi ${typing ? "thinking" : avatarMood}`} />
          <div className="chat-heading">
            <b>Kupi</b>
            <small>Offline assistant · your data stays on this device</small>
          </div>
          <button className="chat-form-shortcut" onClick={onOpenForm} aria-label="Open transaction form" title="Use transaction form">
            <Plus size={19} />
          </button>
        </header>
        <div className="chat-messages" ref={messagesRef} aria-live="polite" aria-relevant="additions text">
          {!conversation.length && (
            <div className="assistant-message">
              <span className="assistant-mark"><MessageCircle size={17} /></span>
              <div>
                <b>Hi! What would you like to do?</b>
                <p>I can log and review transactions, or answer questions using this profile’s saved data.</p>
                <div className="chat-examples kupi-starter-chips">
                  {STARTER_MESSAGES.map((starter) => (
                    <button type="button" key={starter} onClick={() => void processMessage(starter)}>{starter}</button>
                  ))}
                  <button type="button" onClick={() => {
                    setMessage("Change last transaction to ");
                    textareaRef.current?.focus();
                  }}>Edit a transaction</button>
                </div>
              </div>
            </div>
          )}
          {conversation.map((entry, index) => (
            <div key={`${entry.role}-${index}`} className={`chat-message ${entry.role}`}>
              {entry.text}
            </div>
          ))}
          {pendingCandidates && (
            <div className="kupi-candidate-chips" aria-label="Matching transactions">
              {pendingCandidates.result.targetCandidates?.map((id) => {
                const transaction = scopedTransactions.find(({ id: transactionId }) => transactionId === id);
                if (!transaction) return null;
                const category = scopedCategories.find(({ id: categoryId }) => categoryId === transaction.categoryId)?.name ?? "Uncategorized";
                return (
                  <button type="button" key={id} onClick={() => selectCandidate(id)}>
                    {transaction.note || category} · {formatMoney(transaction.amount)} · {transaction.date}
                  </button>
                );
              })}
            </div>
          )}
          {pendingIntentChoice && (
            <div className="kupi-candidate-chips" aria-label="Possible intents">
              {[pendingIntentChoice.result.intent, ...pendingIntentChoice.result.alternatives.map(({ intent }) => intent)]
                .filter((intent, index, list) => list.indexOf(intent) === index)
                .map((intent) => (
                  <button type="button" key={intent} onClick={() => selectIntent(intent)}>
                    {intent.replaceAll("_", " ").toLowerCase()}
                  </button>
                ))}
            </div>
          )}
          {bestGuessResult && (
            <div className="kupi-candidate-chips" aria-label="Suggested best guess">
              <button type="button" onClick={() => handleParsedResult(bestGuessResult, "best guess")}>
                Use best guess — leave category uncategorized
              </button>
            </div>
          )}
          <KupiActionReviewCard
            actions={pendingActions}
            accounts={scopedAccounts}
            categories={scopedCategories}
            warnings={actionWarnings}
            busy={busy}
            onConfirm={() => void commitPending(pendingActions)}
            onCancel={() => {
              setPendingActions([]);
              setActionWarnings([]);
              setDialogue({ status: "idle" });
              sessionRef.current = { ...sessionRef.current, pending: undefined };
              addAssistant("Cancelled. Nothing was saved.");
            }}
          />
          {setupDraft && (
            <section className="kupi-action-card kupi-setup-card" aria-label="Review account or budget setup">
              <article className="kupi-confirm-card">
                <h3>{setupDraft.kind === "account" ? "Review new account" : "Review monthly budget"}</h3>
                <dl>
                  <div>
                    <dt>{setupDraft.kind === "account" ? "Account" : "Category"}</dt>
                    <dd>{setupDraft.kind === "account" ? setupDraft.name : setupDraft.category.name}</dd>
                  </div>
                  {setupDraft.kind === "account" && (
                    <div><dt>Type</dt><dd>{setupDraft.type.replace("_", " ")}</dd></div>
                  )}
                  <div>
                    <dt>{setupDraft.kind === "account" ? "Opening balance" : "Monthly limit"}</dt>
                    <dd>{formatMoney(setupDraft.amount)}</dd>
                  </div>
                </dl>
              </article>
              <div className="kupi-action-buttons">
                <button
                  type="button"
                  className="save-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void saveSetupDraft(setupDraft).finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Saving…" : "Yes, save"}
                </button>
                <button
                  type="button"
                  className="chat-clear-learning"
                  disabled={busy}
                  onClick={() => {
                    setSetupDraft(null);
                    addAssistant("Cancelled. Nothing was saved.");
                  }}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
          {undoActionIds.length > 0 && <KupiUndoToast busy={busy} onUndo={() => void undoLastCommit()} />}
          {error && <p className="kupi-chat-error" role="alert">{error}</p>}
          {typing && (
            <div className="kupi-typing-indicator" role="status" aria-label="Kupi is thinking">
              <img src="/icons/idle.png" alt="" />
              <span><i /><i /><i /></span>
              <small>Kupi is thinking…</small>
            </div>
          )}
          {!dataReady && <p className="kupi-data-loading" role="status">Loading this profile’s local data…</p>}
        </div>
        <form className="chat-composer kupi-chat-composer" onSubmit={(event) => {
          event.preventDefault();
          void processMessage(message);
        }}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void processMessage(message);
              }
            }}
            placeholder="Ask Kupi or describe a transaction"
            rows={1}
            aria-label="Message Kupi"
            disabled={busy || typing || !dataReady}
          />
          <button type="submit" aria-label="Send message" disabled={!message.trim() || busy || typing || !dataReady}>
            <Send size={18} />
          </button>
          <small>Enter to send · Shift + Enter for a new line</small>
        </form>
      </section>
    </div>
  );
}
