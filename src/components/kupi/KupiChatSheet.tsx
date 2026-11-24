import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Mic, MicOff, Send, X } from "lucide-react";
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
  type KupiFocus,
  type KupiIntent,
  type DraftTxn,
  type Mood,
  type ParseResult,
  type SessionContext,
  type StatsQuery,
  type TargetRef,
  type Template,
} from "@/kupi/contracts";
import { commitAction, undoAction } from "@/kupi/actions/commit";
import { proposeAction } from "@/kupi/actions/propose";
import { validateAction } from "@/kupi/actions/validate";
import { reduceDialogue, type DialogueState } from "@/kupi/dialogue/reducer";
import { advanceFocus } from "@/kupi/dialogue/focus";
import { executeStatsQuery } from "@/kupi/queries/executeStatsQuery";
import { generateResponse, type ResponseFacts } from "@/kupi/responses/generateResponse";
import type { StatsQueryResult } from "@/kupi/queries/executeStatsQuery";
import { RESPONSE_TEMPLATES } from "@/kupi/responses/responseTemplates";
import { parseKupiInput } from "@/kupi/parser/parseKupiInput";
import {
  mostUsedAccount,
  createRule,
} from "@/kupi/learning/learning";
import { KupiActionReviewCard, KupiUndoToast } from "./KupiActionReviewCard";

type ChatMessage = { role: "user" | "assistant"; text: string; mood?: Mood };

interface SpeechRecognitionResultLike extends ArrayLike<{ transcript: string }> {}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

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

type EditClarification =
  | { stage: "target"; candidateIds?: string[] }
  | { stage: "field"; transactionId: string }
  | { stage: "value"; transactionId: string; field: "amount" | "category" | "account" | "date" };

const STARTER_MESSAGES = [
  "Coffee 180 today",
  "Salary 30k",
  "How much did I spend this month?",
];

const CHAT_GUIDE_SECTIONS = [
  {
    title: "Log expenses and income",
    examples: ["Spent ₱180 on coffee today", "Received ₱30,000 salary today"],
  },
  {
    title: "Move money",
    examples: ["Transfer ₱500 from Cash to Maya"],
  },
  {
    title: "Edit an expense or income",
    examples: ["Change coffee to ₱250", "Change salary to ₱30,000"],
  },
  {
    title: "Ask about your money",
    examples: [
      "How much did I spend this month?",
      "What is my safe-to-spend today?",
      "What was my biggest expense this month?",
    ],
  },
];

function moneyFact(amount: number): string {
  return formatMoney(amount).replace(/^[^\d-]*/u, "");
}

function summaryForQuery(result: StatsQueryResult, query: StatsQuery): string {
  const isIncome = query.filters?.type === "income";
  switch (result.metric) {
    case "total": {
      if (!result.transactionCount) return `No ${isIncome ? "income" : "expenses"} found ${result.period.label}.`;
      const description = isIncome
        ? `income transaction${result.transactionCount === 1 ? "" : "s"}`
        : `transaction${result.transactionCount === 1 ? "" : "s"}`;
      return `You ${isIncome ? "received" : "spent"} ${formatMoney(result.amountCentavos)} ${result.period.label} across ${result.transactionCount} ${description}.`;
    }
    case "daily_average":
      if (!result.transactionCount) return `No expenses were recorded ${result.period.label}, so there’s no daily average yet.`;
      return isIncome
        ? `Your average daily income was ${formatMoney(result.amountCentavos)} ${result.period.label}.`
        : `Your daily average spending was ${formatMoney(result.amountCentavos)} ${result.period.label}.`;
    case "by_category":
      return result.groups.length
        ? `${isIncome ? "Income" : "Spending"} ${result.period.label}: ${result.groups.slice(0, 3).map((group) => `${group.name} ${formatMoney(group.amountCentavos)}`).join(", ")}.`
        : `No ${isIncome ? "income" : "spending"} found ${result.period.label}.`;
    case "top_category":
      return result.top
        ? `${result.top.name} was your top ${isIncome ? "income source" : "spending category"} ${result.period.label} at ${formatMoney(result.top.amountCentavos)}.`
        : `No ${isIncome ? "income" : "spending"} found ${result.period.label} to rank by category.`;
    case "biggest_expense":
      return result.transaction
        ? `Your biggest expense ${result.period.label} was ${formatMoney(result.transaction.amountCentavos)} for ${result.transaction.note || result.transaction.category} on ${result.transaction.date}.`
        : `No expenses found ${result.period.label}.`;
    case "count":
      if (!result.transactionCount) return `No transactions were recorded ${result.period.label}.`;
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
      if (!result.currentAmountCentavos && !result.previousAmountCentavos) {
        return `No ${isIncome ? "income" : "spending"} was recorded in either period.`;
      }
      const direction = result.changeCentavos > 0 ? "more" : result.changeCentavos < 0 ? "less" : "the same";
      return `Your ${isIncome ? "income" : "spending"} was ${formatMoney(result.currentAmountCentavos)} ${result.period.label}, ${direction} than ${result.previousPeriod.label} by ${formatMoney(Math.abs(result.changeCentavos))}.`;
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
  onOpenKupiSettings = () => undefined,
  profileId,
  initialMessage,
  initialMood = "idle",
}: {
  open: boolean;
  onClose: () => void;
  onOpenForm: () => void;
  onOpenKupiSettings?: () => void;
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
  const merchantRules = useLiveQuery(
    () => profileRecords(db.kupiMerchantRules, profileId).filter((rule) => !rule.deletedAt && rule.enabled).toArray(),
    [profileId],
    []
  );
  const profileSetting = useLiveQuery(
    () => db.settings.where("profileId").equals(profileId).filter((setting) => setting.key === "kupit-app-settings").first(),
    [profileId]
  );

  const [message, setMessage] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<KupiAction[]>([]);
  const [actionWarnings, setActionWarnings] = useState<string[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState<PendingCandidates | null>(null);
  const [pendingIntentChoice, setPendingIntentChoice] = useState<PendingIntentChoice | null>(null);
  const [bestGuessResult, setBestGuessResult] = useState<ParseResult | null>(null);
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [editClarification, setEditClarification] = useState<EditClarification | null>(null);
  const [dialogue, setDialogue] = useState<DialogueState>({ status: "idle" });
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [undoActionIds, setUndoActionIds] = useState<string[]>([]);
  const [learningSuggestion, setLearningSuggestion] = useState<{
    merchant: string;
    categoryId: string;
    categoryName: string;
  } | null>(null);
  const [avatarMood, setAvatarMood] = useState<Mood>("idle");
  const [semanticHint, setSemanticHint] = useState<string | null>(null);
  const [nluModelStatus, setNluModelStatus] = useState<string | null>(null);
  const [smartKupiInstalled, setSmartKupiInstalled] = useState(false);
  const [viewport, setViewport] = useState({ height: 0, top: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTimeoutRef = useRef<number | null>(null);
  const voiceBaseTextRef = useRef("");
  const voiceTranscriptRef = useRef("");
  const undoTimerRef = useRef<number | null>(null);
  const nluCleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<SessionContext>({
    recentTemplateIds: [],
    personality: "classic",
    rngSeed: 984_271,
  });
  const activeProfileIdRef = useRef(profileId);
  activeProfileIdRef.current = profileId;
  const chatGenerationRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refreshAvailability = async () => {
      try {
        let modelSize: "0.6B" | "1.7B" = "0.6B";
        try {
          const saved = JSON.parse(profileSetting?.value ?? "{}") as { kupiSmartModelSize?: "0.6B" | "1.7B" };
          modelSize = saved.kupiSmartModelSize ?? "0.6B";
        } catch { /* Use the default local model size. */ }
        const [{ isEmbeddingModelCached }, { isLocalLlmModelCached }] = await Promise.all([
          import("@/kupi/nlu/embedder"),
          import("@/kupi/nlu/llmParser"),
        ]);
        const [embedding, smart] = await Promise.all([
          isEmbeddingModelCached(),
          isLocalLlmModelCached(modelSize),
        ]);
        if (active) setSmartKupiInstalled(embedding && smart);
      } catch {
        if (active) setSmartKupiInstalled(false);
      }
    };
    void refreshAvailability();
    window.addEventListener("kupit:smart-models-updated", refreshAvailability);
    return () => {
      active = false;
      window.removeEventListener("kupit:smart-models-updated", refreshAvailability);
    };
  }, [open, profileSetting?.value]);

  useEffect(() => {
    if (open) return;
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
    voiceTimeoutRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
    setVoiceListening(false);
    setVoiceStatus("");
    setGuideOpen(false);
    setTyping(false);
    setEditClarification(null);
  }, [open]);

  useEffect(() => {
    if (open) return;
    chatGenerationRef.current++;
    nluCleanupRef.current?.();
    nluCleanupRef.current = null;
  }, [open]);

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
    let personality: "chill" | "classic" | "dramatic" = "classic";
    if (profileSetting?.value) {
      try {
        const saved = JSON.parse(profileSetting.value) as { kupiPersonality?: "chill" | "classic" | "dramatic" };
        personality = saved.kupiPersonality ?? "classic";
      } catch {
        personality = "classic";
      }
    }
    sessionRef.current = { ...sessionRef.current, personality };
  }, [profileSetting?.value]);

  useEffect(() => {
    chatGenerationRef.current++;
    nluCleanupRef.current?.();
    nluCleanupRef.current = null;
    sessionRef.current = {
      recentTemplateIds: [],
      personality: sessionRef.current.personality,
      rngSeed: 984_271,
    };
    setConversation([]);
    setPendingActions([]);
    setActionWarnings([]);
    setPendingCandidates(null);
    setPendingIntentChoice(null);
    setBestGuessResult(null);
    setSetupDraft(null);
    setEditClarification(null);
    setDialogue({ status: "idle" });
    setUndoActionIds([]);
    setMessage("");
    setError("");
    setAvatarMood("idle");
    setTyping(false);
    setSemanticHint(null);
    setNluModelStatus(null);
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
  }, [profileId]);

  useEffect(() => {
    if (!open || !initialMessage) return;
    sessionRef.current = {
      recentTemplateIds: [],
      personality: sessionRef.current.personality,
      rngSeed: 984_271,
    };
    setConversation([{ role: "assistant", text: initialMessage, mood: initialMood }]);
    setPendingActions([]);
    setActionWarnings([]);
    setPendingCandidates(null);
    setPendingIntentChoice(null);
    setBestGuessResult(null);
    setSetupDraft(null);
    setEditClarification(null);
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
    if (!node) return;
    const frame = window.requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    return () => window.cancelAnimationFrame(frame);
  }, [open, viewport.height, conversation, pendingActions, pendingCandidates, pendingIntentChoice, bestGuessResult, setupDraft, typing]);

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
    speechRecognitionRef.current?.abort();
  }, []);

  const scopedTransactions = transactions ?? [];
  const scopedAccounts = accounts ?? [];
  const scopedCategories = categories ?? [];
  const scopedBudgets = budgets ?? [];
  const dataReady = accounts !== undefined && categories !== undefined
    && transactions !== undefined && budgets !== undefined;

  const getSnapshot = (): KupiDbSnapshot => ({
    accounts: scopedAccounts.map(({ id, name }) => ({
      id,
      name,
      aliases: (merchantRules ?? [])
        .filter((rule) => rule.kind === "account_alias" && rule.targetId === id)
        .map((rule) => rule.source),
    })),
    categories: scopedCategories.map(({ id, name }) => ({ id, name })),
    merchantRules: (merchantRules ?? []).map((rule) => ({
      kind: rule.kind === "account_alias" ? "account_alias" : "merchant_category",
      source: rule.source,
      targetId: rule.targetId,
      targetName: rule.targetName,
    })),
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
    const defaultAccount = mostUsedAccount(scopedAccounts, scopedTransactions) ?? scopedAccounts[0];
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
        if (!draft.account && account) defaultAccountWarnings.push(`Using your most-used account, ${account.name}.`);
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

  const rememberRecentAction = (action: KupiAction) => {
    const transaction = action.kind === "create" ? action.after
      : action.kind === "transfer" ? null
      : action.kind === "update" ? action.after
      : action.before;
    const accountId = action.kind === "transfer" ? action.after.accountId : transaction?.accountId;
    const categoryId = transaction?.categoryId;
    const recent: NonNullable<KupiFocus["recent"]> = {
      account: scopedAccounts.find(({ id }) => id === accountId)?.name,
      category: scopedCategories.find(({ id }) => id === categoryId)?.name,
      type: action.kind === "transfer" ? "transfer"
        : transaction?.type === "expense" || transaction?.type === "income" || transaction?.type === "transfer"
          ? transaction.type
          : undefined,
    };
    sessionRef.current = {
      ...sessionRef.current,
      focus: { ...sessionRef.current.focus, recent, turnsRemaining: 6 },
    };
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
      for (const action of actions) rememberRecentAction(action);
      const generated = actions.length === 1 ? responseForAction(actions[0], "done") : null;
      addAssistant(
        generated?.text ?? `Saved ${actions.length} ${actions.length === 1 ? "transaction" : "transactions"} to your ledger.`,
        generated?.mood ?? "idle"
      );
      for (const action of actions) {
        if (action.kind !== "update" || action.before.categoryId === action.after.categoryId) continue;
        const merchant = action.before.note?.trim();
        const category = scopedCategories.find(({ id }) => id === action.after.categoryId);
        if (merchant && merchant.length <= 80 && category) {
          setLearningSuggestion({
            merchant,
            categoryId: category.id,
            categoryName: category.name,
          });
          break;
        }
      }
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
      setActionWarnings(result.interpretedByModel ? ["Kupi interpreted this using the optional offline model. Review every detail before confirming."] : []);
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
        setActionWarnings([
          ...review.warnings,
          ...(result.interpretedByModel ? ["Kupi interpreted this using the optional offline model. Review every detail before confirming."] : []),
        ]);
        for (const action of review.actions) rememberRecentAction(action);
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
      sessionRef.current = {
        ...sessionRef.current,
        focus: { ...sessionRef.current.focus, lastQuery: result.query, turnsRemaining: 6 },
      };
      addAssistant(summaryForQuery(queryResult, result.query));
      return;
    }
    if (result.intent === "HELP") {
      addAssistant("I can log expenses or income, transfer money, edit or delete a transaction, and answer spending or budget questions. For example: ‘coffee 180’, ‘change my last transaction to 200’, or ‘how much did I spend this month?’ What would you like to do?");
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
      addAssistant("I’m not sure what you want to do yet. Are you trying to log spending or income, edit a transaction, move money, or ask about your budget? Tell me which one and I’ll ask for any missing detail.");
      return;
    }
    const response = chooseResponse("UNKNOWN", undefined, {}, { intent: "UNKNOWN" });
    addAssistant("I didn’t catch that. Are you trying to log spending or income, edit a transaction, move money, or ask about your budget? Your ledger hasn’t changed.", response?.mood ?? "idle");
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
    const accountManagementQuestion =
      /\b(?:change|edit|rename|manage)\b.*\baccounts?\b/i.test(text)
      || /\baccounts?\b.*\b(change|edit|rename|manage)\b/i.test(text)
      || /\bcan (?:you )?(?:change|edit|rename|manage) (?:my )?accounts?\b/i.test(text);
    if (accountManagementQuestion && !/\b(?:create|add|set up)\b.*\b(account|wallet|bank)\b.*\b(?:opening|balance)\b/i.test(text)) {
      addAssistant("Account names and details are managed from Wallet. Open Wallet, choose the account, and use its edit option. I can help you log spending, income, transfers, and budgets.");
      return true;
    }
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
    const processingProfileId = profileId;
    const processingGeneration = chatGenerationRef.current;
    setMessage("");
    setError("");
    setConversation((current) => [...current, { role: "user", text }]);
    setTyping(true);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    if (activeProfileIdRef.current !== processingProfileId || chatGenerationRef.current !== processingGeneration) {
      if (chatGenerationRef.current === processingGeneration) setTyping(false);
      return;
    }
    try {
      if (!dataReady) throw new Error("Your profile data is still loading. Please try again in a moment.");
      const normalizedText = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const transactionLabel = (transaction: Transaction) => {
        const category = scopedCategories.find(({ id }) => id === transaction.categoryId)?.name ?? "Uncategorized";
        const account = scopedAccounts.find(({ id }) => id === transaction.accountId)?.name ?? "Unknown account";
        return `${transaction.note || category} · ${formatMoney(transaction.amount)} · ${account} · ${transaction.date}`;
      };
      if (editClarification && /^(?:cancel|never mind|nevermind|stop)$/u.test(normalizedText)) {
        setEditClarification(null);
        addAssistant("Okay, I cancelled the edit. Nothing was changed.");
        return;
      }
      if (editClarification?.stage === "target") {
        const mostRecent = [...scopedTransactions].sort((a, b) => b.date.localeCompare(a.date))[0];
        let candidates = /^\d+$/u.test(normalizedText) && editClarification.candidateIds
          ? [scopedTransactions.find(({ id }) => id === editClarification.candidateIds?.[Number(normalizedText) - 1])].filter((item): item is Transaction => Boolean(item))
          : /\b(?:last|latest|most recent|that)\b/u.test(normalizedText)
          ? [scopedTransactions.find(({ id }) => id === sessionRef.current.lastTxnId) ?? mostRecent].filter((item): item is Transaction => Boolean(item))
          : scopedTransactions.filter((transaction) => {
              const category = scopedCategories.find(({ id }) => id === transaction.categoryId)?.name ?? "";
              const account = scopedAccounts.find(({ id }) => id === transaction.accountId)?.name ?? "";
              const amount = (transaction.amount / 100).toFixed(2);
              const searchable = [transaction.note ?? "", category, account, transaction.date, amount]
                .join(" ")
                .toLocaleLowerCase();
              const terms = normalizedText.split(/\s+/u).filter((term) => !["the", "a", "an", "my", "last", "transaction", "transactions", "one", "please"].includes(term));
              return terms.length > 0 && terms.every((term) => searchable.includes(term));
            });
        candidates = candidates.slice(0, 3);
        if (candidates.length === 1) {
          setEditClarification({ stage: "field", transactionId: candidates[0].id });
          addAssistant(`Which detail should I change for ${transactionLabel(candidates[0])}: amount, category, account, or date?`);
        } else if (candidates.length > 1) {
          setEditClarification({ stage: "target", candidateIds: candidates.map(({ id }) => id) });
          addAssistant(`I found a few matches: ${candidates.map((transaction, index) => `${index + 1}) ${transactionLabel(transaction)}`).join("; ")}. Reply with 1, 2, or 3, or send a distinguishing name, amount, or date.`);
        } else {
          const recent = [...scopedTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
          addAssistant(`I couldn't find that transaction. Which one should I edit?${recent.length ? ` Recent transactions: ${recent.map(transactionLabel).join("; ")}.` : " There are no transactions in this profile yet."}`);
        }
        return;
      }
      if (editClarification?.stage === "field") {
        const field = /\b(?:amount|price|cost)\b/u.test(normalizedText) ? "amount"
          : /\bcategory\b/u.test(normalizedText) ? "category"
          : /\baccount\b/u.test(normalizedText) ? "account"
          : /\bdate|day\b/u.test(normalizedText) ? "date"
          : undefined;
        if (!field) {
          addAssistant("Which detail should I change: amount, category, account, or date?");
          return;
        }
        setEditClarification({ ...editClarification, stage: "value", field });
        addAssistant(`What should the new ${field} be?`);
        return;
      }
      if (editClarification?.stage === "value") {
        const transactionId = editClarification.transactionId;
        sessionRef.current = { ...sessionRef.current, lastTxnId: transactionId };
        const command = editClarification.field === "category"
          ? `change last transaction category to ${text}`
          : editClarification.field === "account"
            ? `change that to ${text}`
            : editClarification.field === "date"
              ? `change last transaction date to ${text}`
              : `change last transaction to ${text}`;
        const edited = parseKupiInput(command, sessionRef.current, getSnapshot(), new Date());
        if (edited.intent === "EDIT_TXN" && edited.edit) {
          setEditClarification(null);
          handleParsedResult(edited, command);
        } else {
          addAssistant(`I couldn't match that ${editClarification.field}. Please try a different ${editClarification.field} value.`);
        }
        return;
      }
      if (/^(?:edit|change)\s+(?:(?:a|the|my)\s+)?transactions?$/iu.test(normalizedText)) {
        setEditClarification({ stage: "target" });
        const recent = [...scopedTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
        addAssistant(`Which transaction would you like to edit?${recent.length ? ` Recent ones: ${recent.map(transactionLabel).join("; ")}.` : " You have no transactions in this profile yet."}`);
        return;
      }
      const draftAmountEdit = text.match(/^\s*(?:change|make) that to\s+([\d,.]+(?:\.\d+)?\s*[km]?)\s*[.!]?\s*$/i);
      if (draftAmountEdit && pendingActions.length === 1 && pendingActions[0].kind === "create") {
        const amount = parseMoney(draftAmountEdit[1]);
        if (amount > 0) {
          const updated = { ...pendingActions[0], after: { ...pendingActions[0].after, amount } };
          const validation = validateAction(updated, { accounts: scopedAccounts, categories: scopedCategories, txns: scopedTransactions, now: new Date() });
          if (!validation.valid) throw new Error(validation.errors.join(" "));
          setPendingActions([updated]);
          setActionWarnings(validation.warnings);
          addAssistant(`Updated the draft to ${formatMoney(amount)}. Review it before saving.`);
          return;
        }
      }
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
      const context = advanceFocus(sessionRef.current);
      sessionRef.current = context;
      const snapshot = getSnapshot();
      const rulesResult = parseKupiInput(text, context, snapshot, now);
      const categoryChoicesFor = (transactionId?: string) => {
        const transaction = scopedTransactions.find(({ id }) => id === transactionId);
        const type = transaction?.type === "income" ? "income" : "expense";
        return scopedCategories
          .filter((category) => category.type === type && !category.deletedAt)
          .map(({ name }) => name)
          .slice(0, 8);
      };
      const categoryQuestion = (unknown?: string) => {
        const choices = categoryChoicesFor(context.lastTxnId);
        return `${unknown ? `I couldn't match “${unknown}” to a category. ` : ""}Which category should I use for your last transaction?${choices.length ? ` Choose from: ${choices.join(", ")}.` : ""}`;
      };
      if (context.pending?.kind === "slot" && context.pending.slot === "editCategory") {
        if (rulesResult.intent === "EDIT_TXN" && rulesResult.edit?.field === "category") {
          setSemanticHint(null);
          handleParsedResult(rulesResult, text);
        } else {
          addAssistant(categoryQuestion(text));
        }
        return;
      }
      const categoryEditRequest = /\b(?:last|my last)\s+transaction\b/iu.test(text)
        && /\bcategor(?:y|ies)\b/iu.test(text)
        && /\b(?:change|edit|set|forgot|forgotten)\b/iu.test(text);
      if (context.lastTxnId && categoryEditRequest && rulesResult.intent !== "EDIT_TXN") {
        sessionRef.current = {
          ...sessionRef.current,
          pending: { kind: "slot", slot: "editCategory", intent: "EDIT_TXN" },
        };
        const unknown = text.match(/\b(?:to|for)\s+(.+?)[.!?]*$/iu)?.[1]
          ?.replace(/\s+categor(?:y|ies)\s*$/iu, "")
          .trim();
        addAssistant(categoryQuestion(unknown));
        return;
      }
      if (rulesResult.tier === "ask" || rulesResult.intent === "UNKNOWN" || rulesResult.intent === "CLARIFY") {
        // Ask the user a focused follow-up immediately; uncertain turns must not wait for model startup.
        setSemanticHint(null);
        setNluModelStatus(null);
        handleParsedResult(rulesResult, text);
        return;
      }
      let profileSettings: { kupiSmartAssist?: boolean; kupiSmartMode?: boolean; kupiSmartModelSize?: "0.6B" | "1.7B" } = {};
      try { if (profileSetting?.value) profileSettings = JSON.parse(profileSetting.value) as typeof profileSettings; } catch { /* Ignore malformed optional settings. */ }
      let result: ParseResult;
      if (profileSettings.kupiSmartAssist || profileSettings.kupiSmartMode) {
        setNluModelStatus("Checking the optional offline model…");
        const { releaseNluResources, resolveWithFallback } = await import("@/kupi/nlu/resolve");
        nluCleanupRef.current = releaseNluResources;
        const resolved = await resolveWithFallback(text, context, snapshot, now, {
          smartAssist: profileSettings.kupiSmartAssist,
          smartMode: profileSettings.kupiSmartMode,
          modelSize: profileSettings.kupiSmartModelSize,
          onProgress: (_progress, status) => {
            if (activeProfileIdRef.current === processingProfileId && chatGenerationRef.current === processingGeneration) setNluModelStatus(status);
          },
        });
        if (activeProfileIdRef.current !== processingProfileId || chatGenerationRef.current !== processingGeneration) return;
        setSemanticHint(resolved.suggestion ? `Possible match: ${resolved.suggestion.label} (${Math.round(resolved.suggestion.score * 100)}% similarity). Kupi has not applied this suggestion.` : null);
        result = resolved.result;
      } else {
        setSemanticHint(null);
        result = rulesResult;
      }
      if (activeProfileIdRef.current !== processingProfileId || chatGenerationRef.current !== processingGeneration) return;
      setNluModelStatus(null);
      handleParsedResult(result, text);
    } catch (processingError) {
      if (activeProfileIdRef.current !== processingProfileId || chatGenerationRef.current !== processingGeneration) return;
      const detail = processingError instanceof Error ? processingError.message : "Message processing failed.";
      setError(detail);
      setNluModelStatus(null);
      addAssistant(`I couldn't process that safely: ${detail}`, "idle");
    } finally {
      if (chatGenerationRef.current === processingGeneration) setTyping(false);
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
    ? "/icons/thinking.png"
    : avatarMood === "happy"
      ? "/icons/happy.png"
      : avatarMood === "worried"
        ? "/icons/worried.png"
        : "/icons/idle.png";

  const insertGuideExample = (example: string) => {
    setMessage(example);
    setGuideOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const toggleVoiceInput = () => {
    if (voiceListening) {
      const recognition = speechRecognitionRef.current;
      recognition?.stop();
      setVoiceStatus("Finishing voice input…");
      if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = window.setTimeout(() => {
        if (!recognition || speechRecognitionRef.current !== recognition) return;
        speechRecognitionRef.current = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.abort(); } catch { /* Recognition may already have stopped. */ }
        setVoiceListening(false);
        setVoiceStatus("Voice input stopped. You can review the draft or keep typing.");
      }, 2_000);
      return;
    }

    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("Voice input isn’t supported here. Try your keyboard’s dictation microphone.");
      return;
    }

    try {
      const recognition = new Recognition();
      let failed = false;
      voiceBaseTextRef.current = message.trim();
      voiceTranscriptRef.current = "";
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join("")
          .trim();
        voiceTranscriptRef.current = transcript;
        setMessage([voiceBaseTextRef.current, transcript].filter(Boolean).join(" "));
      };
      recognition.onerror = (event) => {
        failed = true;
        if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
        voiceTimeoutRef.current = null;
        if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
        setVoiceListening(false);
        try { recognition.abort(); } catch { /* Recognition may already have stopped. */ }
        setVoiceStatus(
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "Microphone access was denied. Check your browser permissions and try again."
            : event.error === "no-speech"
              ? "No speech detected. Tap the microphone to try again."
              : "Voice input failed. Check your connection and microphone permission."
        );
      };
      recognition.onend = () => {
        if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
        voiceTimeoutRef.current = null;
        setVoiceListening(false);
        if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
        if (!failed) {
          setVoiceStatus(
            voiceTranscriptRef.current
              ? "Voice draft ready. Review and edit it before sending."
              : "No speech captured. Tap the microphone to try again."
          );
        }
      };
      speechRecognitionRef.current = recognition;
      setVoiceStatus("Listening… Speak now.");
      setVoiceListening(true);
      recognition.start();
      voiceTimeoutRef.current = window.setTimeout(() => {
        if (speechRecognitionRef.current !== recognition) return;
        speechRecognitionRef.current = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.abort(); } catch { /* Recognition may already have stopped. */ }
        setVoiceListening(false);
        setVoiceStatus("Voice input timed out. You can type your message or try the microphone again.");
      }, 30_000);
    } catch (error) {
      if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
      speechRecognitionRef.current = null;
      setVoiceListening(false);
      setVoiceStatus("Could not start voice input. Check your microphone permission and try again.");
      console.error("Could not start Kupi voice input:", error);
    }
  };

  if (!open) return null;
  return (
    <div
      className="sheet-backdrop kupi-chat-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Chat"
      style={viewport.height ? { height: viewport.height, top: viewport.top } : undefined}
    >
      <section className={`account-sheet chat-sheet chat-screen kupi-chat-screen${typing ? " is-thinking" : ""}`}>
        <header className="sheet-header kupi-chat-header">
          <button type="button" onClick={onClose} aria-label="Close chat">
            <X size={20} />
          </button>
          <div className="chat-heading">
            <div>
              <b>Chat</b>
            </div>
          </div>
          <button
            type="button"
            className="kupi-chat-guide-toggle"
            onClick={() => setGuideOpen((current) => !current)}
            aria-label={guideOpen ? "Hide chat guide" : "Open chat guide"}
            aria-expanded={guideOpen}
            aria-controls="kupi-chat-guide"
            title="Chat guide"
          >
            <BookOpen size={18} />
          </button>
        </header>
        {guideOpen && (
          <aside className="kupi-chat-guide" id="kupi-chat-guide" aria-label="Chat guide">
            <div className="kupi-chat-guide-heading">
              <div>
                <b>What can I ask?</b>
                <p>Choose an example to add it to your message. You can edit it before sending.</p>
              </div>
              <button type="button" onClick={() => setGuideOpen(false)} aria-label="Close chat guide">
                <X size={18} />
              </button>
            </div>
            <div className="kupi-chat-guide-sections">
              {CHAT_GUIDE_SECTIONS.map((section) => (
                <section key={section.title}>
                  <h3>{section.title}</h3>
                  <div className="kupi-chat-guide-examples">
                    {section.examples.map((example) => (
                      <button type="button" key={example} onClick={() => insertGuideExample(example)}>
                        {example}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <p className="kupi-chat-guide-note">
              Goals, debts, and collections are managed in Plan for now; Chat can’t create or edit them yet.
            </p>
            <p className="kupi-chat-guide-note">
              Text chat and finance data stay on this device. Optional model downloads contact model hosts; voice input may use browser services.
            </p>
            <p className="kupi-chat-guide-note">
              Voice transcription may need internet. Your draft stays editable until you tap Send.
            </p>
          </aside>
        )}
        <div className="chat-messages" ref={messagesRef} aria-live="polite" aria-relevant="additions text">
          {!conversation.length && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
              <div className="assistant-message">
                {scopedAccounts.length === 0 ? (
                  <>
                    <b>Welcome! Let’s set up your budget.</b>
                    <p><strong>Step 1:</strong> Add an account so Kupi knows where your money lives.</p>
                    <p><strong>Step 2:</strong> Log income or an expense.</p>
                    <p><strong>Step 3:</strong> Review spending and ask Kupi for guidance.</p>
                  </>
                ) : scopedTransactions.length === 0 ? (
                  <>
                    <b>You’re ready for your first transaction.</b>
                    <p>Log an expense or income, then Kupi can help you track, review, and understand it.</p>
                  </>
                ) : (
                  <>
                    <b>Hi! What would you like to do?</b>
                    <p>I can log and review transactions, or answer questions using this profile’s saved data.</p>
                  </>
                )}
                <div className="chat-examples kupi-starter-chips">
                  {scopedAccounts.length === 0 ? (
                    <>
                      <button type="button" onClick={() => {
                        setMessage("Add account named Cash with opening balance ");
                        textareaRef.current?.focus();
                      }}>Set up Cash</button>
                      <button type="button" onClick={() => void processMessage("How do I set up an account?")}>How it works</button>
                    </>
                  ) : scopedTransactions.length === 0 ? (
                    <>
                      <button type="button" onClick={() => void processMessage("Coffee 180 today")}>Log Coffee 180</button>
                      <button type="button" onClick={() => void processMessage("Salary 30000")}>Log income</button>
                      <button type="button" onClick={() => onOpenForm()}>Use the form</button>
                    </>
                  ) : (
                    <>
                      {STARTER_MESSAGES.map((starter) => (
                        <button type="button" key={starter} onClick={() => void processMessage(starter)}>{starter}</button>
                      ))}
                      <button type="button" onClick={() => {
                        setMessage("Change last transaction to ");
                        textareaRef.current?.focus();
                      }}>Edit a transaction</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {conversation.map((entry, index) => (
            entry.role === "assistant" ? (
              <div key={`assistant-${index}`} className="chat-turn assistant">
                <img
                  className="chat-kupi-avatar"
                  src={entry.mood === "happy" ? "/icons/happy.png" : entry.mood === "worried" ? "/icons/worried.png" : "/icons/idle.png"}
                  alt={`Kupi ${entry.mood}`}
                />
                <div className="chat-message assistant">{entry.text}</div>
              </div>
            ) : (
              <div key={`user-${index}`} className="chat-turn user">
                <div className="chat-message user">{entry.text}</div>
              </div>
            )
          ))}
          {pendingCandidates && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
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
            </div>
          )}
          {pendingIntentChoice && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
              <div className="kupi-candidate-chips" aria-label="Possible intents">
                {[pendingIntentChoice.result.intent, ...pendingIntentChoice.result.alternatives.map(({ intent }) => intent)]
                  .filter((intent, index, list) => list.indexOf(intent) === index)
                  .map((intent) => (
                    <button type="button" key={intent} onClick={() => selectIntent(intent)}>
                      {intent.replaceAll("_", " ").toLowerCase()}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {bestGuessResult && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
              <div className="kupi-candidate-chips" aria-label="Suggested best guess">
                <button type="button" onClick={() => handleParsedResult(bestGuessResult, "best guess")}>
                  Use best guess — leave category uncategorized
                </button>
              </div>
            </div>
          )}
          {semanticHint && (
            <div className="chat-turn assistant" role="status">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
              <div className="kupi-candidate-chips" aria-label="Offline language suggestion">{semanticHint}</div>
            </div>
          )}
          {pendingActions.length > 0 && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
              <KupiActionReviewCard
                actions={pendingActions}
                accounts={scopedAccounts}
                categories={scopedCategories}
                warnings={actionWarnings}
                busy={busy}
                onConfirm={() => void commitPending(pendingActions)}
                onEdit={(updated) => {
                  setPendingActions((actions) => actions.map((action) => action.id === updated.id ? updated : action));
                  const validation = validateAction(updated, { accounts: scopedAccounts, categories: scopedCategories, txns: scopedTransactions, now: new Date() });
                  setActionWarnings(validation.valid ? validation.warnings : validation.errors);
                }}
                onCancel={() => {
                  setPendingActions([]);
                  setActionWarnings([]);
                  setDialogue({ status: "idle" });
                  sessionRef.current = { ...sessionRef.current, pending: undefined };
                  addAssistant("Cancelled. Nothing was saved.");
                }}
              />
            </div>
          )}
          {setupDraft && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
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
            </div>
          )}
          {learningSuggestion && (
            <div className="chat-turn assistant">
              <img className="chat-kupi-avatar" src={avatarSrc} alt={`Kupi ${avatarMood}`} />
              <section className="kupi-action-card" aria-label="Remember category correction">
                <article className="kupi-confirm-card">
                  <h3>Remember this category?</h3>
                  <p>Always file {learningSuggestion.merchant} under {learningSuggestion.categoryName}?</p>
                </article>
                <div className="kupi-action-buttons">
                  <button
                    type="button"
                    className="save-button"
                    onClick={async () => {
                      const rule = createRule(
                        profileId,
                        "merchant_category",
                        learningSuggestion.merchant,
                        learningSuggestion.categoryId,
                        learningSuggestion.categoryName
                      );
                      await db.kupiMerchantRules.put(rule);
                      setLearningSuggestion(null);
                      addAssistant(`Remembered: ${rule.source} is ${rule.targetName}.`);
                    }}
                  >
                    Always
                  </button>
                  <button type="button" className="chat-clear-learning" onClick={() => setLearningSuggestion(null)}>
                    Not always
                  </button>
                </div>
              </section>
            </div>
          )}
          {undoActionIds.length > 0 && <KupiUndoToast busy={busy} onUndo={() => void undoLastCommit()} />}
          {error && <p className="kupi-chat-error" role="alert">{error}</p>}
          {typing && (
            <div className="kupi-typing-indicator" role="status" aria-label="Kupi is thinking">
              <img src={avatarSrc} alt="Kupi thinking" />
              <span><i /><i /><i /></span>
              <small>Kupi is thinking…</small>
            </div>
          )}
          {nluModelStatus && <p className="kupi-data-loading" role="status">{nluModelStatus}</p>}
          {!dataReady && <p className="kupi-data-loading" role="status">Loading this profile’s local data…</p>}
          {!smartKupiInstalled && (
            <button type="button" className="kupi-smart-unlock" onClick={onOpenKupiSettings}>
              Unlock smarter Kupi
            </button>
          )}
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
            rows={1}
            aria-label="Message Kupi"
            placeholder="Ask Kupi"
            onFocus={() => window.requestAnimationFrame(() => {
              const node = messagesRef.current;
              if (node) node.scrollTop = node.scrollHeight;
            })}
            disabled={!dataReady}
          />
          <button
            type="button"
            className={`kupi-voice-button${voiceListening ? " is-listening" : ""}`}
            onClick={toggleVoiceInput}
            aria-label={voiceListening ? "Stop voice input" : "Start voice input"}
            aria-pressed={voiceListening}
            disabled={busy || typing || !dataReady}
            title={voiceListening ? "Stop voice input" : "Speak your message"}
          >
            {voiceListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button type="submit" aria-label="Send message" disabled={!message.trim() || busy || typing || !dataReady}>
            <Send size={18} />
          </button>
          <small>AI can make mistakes. Review important details.</small>
          {voiceStatus && <small className="kupi-voice-status" role="status">{voiceStatus}</small>}
        </form>
      </section>
    </div>
  );
}
