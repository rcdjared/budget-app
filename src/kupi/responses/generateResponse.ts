import { KUPI_CONFIG } from "../contracts";
import type { Intensity, Language, Mood, Personality, ResponseIntent, Template } from "../contracts";
import { matchesTemplate, RESPONSE_TEMPLATES } from "./responseTemplates";

const SENSITIVE_INTENTS = new Set<ResponseIntent>([
  "DELETE_TXN",
  "UNDO",
  "UNKNOWN",
  "CANCEL",
  "ERROR",
  "UNSUPPORTED",
]);

export interface MoodState {
  intent: ResponseIntent;
  catPercent?: number;
  amountPctOfBudget?: number;
  todayExpenseAmounts?: readonly number[];
  streakDays?: number;
  isError?: boolean;
  lowBalance?: boolean;
}

export interface MoodResult {
  mood: Mood;
  intensity: Intensity;
  tags: string[];
}

export type ResponseFacts = Readonly<Record<string, string | number>>;

export interface GenerateResponseInput {
  state: MoodState;
  language: Language;
  personality: Personality;
  facts: ResponseFacts;
  recentTemplateIds: readonly string[];
  rngSeed: number;
  templates?: readonly Template[];
  stage?: Template["stage"];
  slot?: string;
}

export interface GeneratedResponse extends MoodResult {
  text: string;
  templateId: string;
  recentTemplateIds: string[];
  rngSeed: number;
}

function personalityCap(personality: Personality): Intensity {
  if (personality === "chill") return 1;
  if (personality === "classic") return 2;
  return 3;
}

/** Mood is derived only from supplied budget/activity facts and never from randomness. */
export function computeMood(state: MoodState, personality: Personality = "dramatic"): MoodResult {
  const tags: string[] = [];
  let mood: Mood = "idle";
  let intensity: Intensity = 1;

  if (state.isError) return { mood, intensity, tags };

  if (state.intent === "LOG_INCOME") {
    mood = "happy";
    intensity = 3;
    if (state.streakDays && state.streakDays >= 3) tags.push("streak");
  } else if ((state.intent === "LOG_EXPENSE" || state.intent === "PROACTIVE") && state.catPercent !== undefined) {
    if (state.catPercent > KUPI_CONFIG.mood.overBudgetPct) {
      mood = "worried";
      intensity = 3;
      tags.push("over_budget");
    } else if (state.catPercent >= KUPI_CONFIG.mood.worriedAtBudgetPct) {
      mood = "worried";
      intensity = 2;
      tags.push("near_budget");
    } else if (state.catPercent < KUPI_CONFIG.mood.happyBelowBudgetPct) {
      mood = "happy";
      intensity = 2;
    }
  }

  if (
    state.intent === "LOG_EXPENSE"
    && state.amountPctOfBudget !== undefined
    && state.amountPctOfBudget >= KUPI_CONFIG.mood.bigExpensePctOfBudget
  ) {
    mood = "worried";
    intensity = Math.max(intensity, 2) as Intensity;
    tags.push("big_expense");
  }
  const microSpendCount = state.todayExpenseAmounts?.filter((amount) =>
    Number.isSafeInteger(amount) && amount > 0 && amount < KUPI_CONFIG.mood.microSpendMax
  ).length ?? 0;
  if (
    (state.intent === "LOG_EXPENSE" || state.intent === "PROACTIVE")
    && microSpendCount >= KUPI_CONFIG.mood.microSpendCount
  ) {
    tags.push("micro_spend");
    intensity = Math.max(intensity, 2) as Intensity;
  }

  if (state.lowBalance) tags.push("remaining_low");
  if (SENSITIVE_INTENTS.has(state.intent) || state.lowBalance) intensity = 1;
  intensity = Math.min(intensity, personalityCap(personality)) as Intensity;
  return { mood, intensity, tags };
}

function nextSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new RangeError("Kupi response RNG seed must be a safe integer.");
  return (Math.imul(seed >>> 0, 1_664_525) + 1_013_904_223) >>> 0;
}

function scoreTemplate(template: Template, filter: {
  mood: Mood;
  intensity: Intensity;
  tags: readonly string[];
}): number {
  let score = template.mood === filter.mood ? 3 : 0;
  if (template.intensity === filter.intensity) score += 2;
  score += filter.tags.filter((tag) => template.tags?.includes(tag)).length * 4;
  return score;
}

export function renderTemplate(template: Template, facts: ResponseFacts): string {
  const placeholders = [...template.text.matchAll(/\{([A-Za-z_]\w*)\}/gu)].map((match) => match[1]);
  const uniquePlaceholders = [...new Set(placeholders)];
  if (
    uniquePlaceholders.length !== template.vars.length
    || uniquePlaceholders.some((key, index) => key !== template.vars[index])
  ) {
    throw new Error(`Template "${template.id}" has undeclared or unused placeholders.`);
  }

  const rendered = template.text.replace(/\{([A-Za-z_]\w*)\}/gu, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(facts, key)) {
      throw new Error(`Template "${template.id}" is missing fact "${key}".`);
    }
    const value = facts[key];
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RangeError(`Template fact "${key}" must be finite.`);
    }
    return String(value);
  });
  if (/\{\{|\{[A-Za-z_]\w*\}|\b(?:undefined|NaN)\b/u.test(rendered)) {
    throw new Error(`Template "${template.id}" rendered an invalid response.`);
  }
  return rendered;
}

/** Returns null when every eligible template is inside the anti-repeat window. */
export function generateResponse(input: GenerateResponseInput): GeneratedResponse | null {
  const mood = computeMood(input.state, input.personality);
  const filter = {
    intent: input.state.intent,
    mood: mood.mood,
    intensity: mood.intensity,
    language: input.language,
    tags: mood.tags,
    stage: input.stage,
    slot: input.slot,
  };
  const recent = new Set(input.recentTemplateIds.slice(-KUPI_CONFIG.dialogue.antiRepeatWindow));
  const eligible = (input.templates ?? RESPONSE_TEMPLATES)
    .filter((template) => matchesTemplate(template, filter))
    .filter((template) => !recent.has(template.id));
  if (!eligible.length) return null;

  const scored = eligible.map((template) => ({ template, score: scoreTemplate(template, mood) }));
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore).map(({ template }) => template);
  const seed = nextSeed(input.rngSeed);
  const selected = best[Math.floor((seed / 0x1_0000_0000) * best.length)];
  const recentTemplateIds = [...input.recentTemplateIds, selected.id].slice(-KUPI_CONFIG.dialogue.antiRepeatWindow);

  return {
    ...mood,
    text: renderTemplate(selected, input.facts),
    templateId: selected.id,
    recentTemplateIds,
    rngSeed: seed,
  };
}
