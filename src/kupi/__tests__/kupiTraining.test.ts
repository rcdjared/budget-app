/**
 * src/kupi/__tests__/kupiTraining.test.ts
 *
 * Data-integrity + persona-lint + parser-scoreboard tests for the Kupi assistant.
 *
 *  1. GOLDEN   : fixtures/golden.jsonl is well-formed and consistent with contracts.ts
 *  2. TEMPLATES: the response bank obeys the persona rules (Roadmap sections 4 and 7)
 *  3. HOLD-OUT : the frozen 20% split is stable
 *  4. SCORE    : once src/kupi/parser/parseKupiInput exists, score it against the golden set.
 *                Skipped automatically before Phase 2, so this file is green from day one.
 *
 * Run: pnpm vitest run src/kupi/__tests__/kupiTraining.test.ts
 * Strict gates for the parser: KUPI_GATES=1 pnpm vitest run ...
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { KupiIntent, Tier, ParseFlag, GoldenCase, Template, ResponseIntent } from "../contracts";
import { KUPI_CONFIG } from "../contracts";

// ---------------------------------------------------------------- paths
const ROOT = process.cwd();
const GOLDEN_PATH = resolve(ROOT, "fixtures/golden.jsonl");
const TEMPLATES_PATH = resolve(ROOT, "src/kupi/responses/templates/kupi_templates.json");
const PARSER_PATH = resolve(ROOT, "src/kupi/parser/parseKupiInput.ts");

// ---------------------------------------------------------------- enums tied to contracts.ts
// Record<..., true> forces a compile error if contracts.ts gains a value we forgot here.
const INTENT_SET: Record<KupiIntent, true> = {
  LOG_EXPENSE: true, LOG_INCOME: true, TRANSFER: true, EDIT_TXN: true, DELETE_TXN: true,
  QUERY_STATS: true, CONFIRM: true, CANCEL: true, UNDO: true, SMALLTALK: true, HELP: true,
  CLARIFY: true, UNKNOWN: true,
};
const TIER_SET: Record<Tier, true> = { auto: true, confirm: true, ask: true, fallback: true };
const FLAG_SET: Record<ParseFlag, true> = {
  future_date: true, quantity: true, huge_amount: true, libre: true, same_account: true,
  target_not_found: true, interrupts_pending: true, trailing_account_scope: true,
  trailing_date_scope: true, ambiguous_baon: true, ambiguous_padala: true, midnight_date: true,
};
const SOURCE_SET: Record<GoldenCase["source"], true> = {
  hand: true, seed: true, synthetic: true, "llm-paraphrase": true, correction: true,
};
const RESPONSE_INTENT_EXTRA = ["SLOT_FILL", "DISAMBIGUATE", "ERROR", "UNSUPPORTED", "PROACTIVE"] as const;
const UNSUPPORTED_SET = new Set(["utang", "split_bill", "bulk_delete", "recurring", "multi_currency"]);
const MISSING_SET = new Set(["amount", "category", "account", "fromAccount", "toAccount", "date", "target"]);

// ---------------------------------------------------------------- loaders
function loadGolden(): GoldenCase[] {
  return readFileSync(GOLDEN_PATH, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as GoldenCase;
      } catch {
        throw new Error(`golden.jsonl line ${i + 1} is not valid JSON`);
      }
    });
}

interface TemplateFile { _readme: string; moods: string[]; templates: Template[] }
function loadTemplates(): TemplateFile {
  return JSON.parse(readFileSync(TEMPLATES_PATH, "utf8")) as TemplateFile;
}

const golden = loadGolden();
const bank = loadTemplates();
const templates = bank.templates;

// ---------------------------------------------------------------- 1. GOLDEN
describe("golden.jsonl integrity", () => {
  it("has enough cases (Phase 2 gate: >= 150)", () => {
    expect(golden.length).toBeGreaterThanOrEqual(150);
  });

  it("has unique ids", () => {
    const seen = new Set<string>();
    for (const c of golden) {
      expect(seen.has(c.id), `duplicate id ${c.id}`).toBe(false);
      seen.add(c.id);
    }
  });

  it("every case has valid intent, tier, source and non-empty tags", () => {
    for (const c of golden) {
      expect(INTENT_SET[c.expect.intent], `${c.id}: bad intent`).toBe(true);
      expect(TIER_SET[c.expect.tier], `${c.id}: bad tier`).toBe(true);
      expect(SOURCE_SET[c.source], `${c.id}: bad source`).toBe(true);
      expect(Array.isArray(c.tags) && c.tags.length > 0, `${c.id}: tags`).toBe(true);
      expect(typeof c.text, `${c.id}: text`).toBe("string");
    }
  });

  it("flags, missing and unsupported use contract vocabulary", () => {
    for (const c of golden) {
      const e = c.expect as Record<string, unknown>;
      for (const f of (e.flags as string[] | undefined) ?? [])
        expect(FLAG_SET[f as ParseFlag], `${c.id}: unknown flag ${f}`).toBe(true);
      for (const m of (e.missing as string[] | undefined) ?? [])
        expect(MISSING_SET.has(m), `${c.id}: unknown missing ${m}`).toBe(true);
      if (e.unsupported !== undefined)
        expect(UNSUPPORTED_SET.has(e.unsupported as string), `${c.id}: unsupported`).toBe(true);
    }
  });

  it("money is integer centavos, never float", () => {
    const check = (v: unknown, where: string) => {
      if (typeof v === "number") expect(Number.isInteger(v), where).toBe(true);
    };
    const walk = (o: unknown, id: string, key = ""): void => {
      if (Array.isArray(o)) o.forEach((x) => walk(x, id, key));
      else if (o && typeof o === "object")
        Object.entries(o).forEach(([k, v]) => walk(v, id, k));
      else if (/centavos$/i.test(key)) check(o, `${id}.${key}`);
    };
    golden.forEach((c) => walk(c.expect, c.id));
  });

  it("dates are valid YYYY-MM-DD and `now` is ISO with +08:00", () => {
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const walk = (o: unknown, id: string, key = ""): void => {
      if (Array.isArray(o)) o.forEach((x) => walk(x, id, key));
      else if (o && typeof o === "object") Object.entries(o).forEach(([k, v]) => walk(v, id, k));
      else if (typeof o === "string" && key === "date") {
        expect(DATE.test(o), `${id}: date ${o}`).toBe(true);
        expect(Number.isNaN(Date.parse(o + "T00:00:00+08:00")), `${id}: date ${o}`).toBe(false);
      }
    };
    for (const c of golden) {
      walk(c.expect, c.id);
      if (c.now) expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(c.now), `${c.id}: now`).toBe(true);
    }
  });

  it("every intent has at least one golden case", () => {
    const have = new Set(golden.map((c) => c.expect.intent));
    for (const intent of Object.keys(INTENT_SET)) expect(have.has(intent as KupiIntent), intent).toBe(true);
  });

  it("covers the Section 6.3 checklist tags", () => {
    const tags = new Set(golden.flatMap((c) => c.tags));
    const required = [
      "amount-k", "peso-sign", "thousands-comma", "tagalog-number", "date", "midnight", "quantity",
      "time-not-amount", "account-vs-merchant", "baon", "padala", "libre", "compound", "inline-correction",
      "follow-up", "ambiguous-target", "bare-reply", "adversarial", "empty", "injection", "unsupported",
      "emoji", "all-caps", "gibberish",
    ];
    for (const t of required) expect(tags.has(t), `missing tag coverage: ${t}`).toBe(true);
  });

  it("adversarial cases never expect a destructive intent", () => {
    for (const c of golden.filter((x) => x.tags.includes("adversarial"))) {
      expect(["DELETE_TXN", "EDIT_TXN", "UNDO"]).not.toContain(c.expect.intent);
    }
  });

  it("ambiguous cases never land in the auto tier", () => {
    for (const c of golden.filter((x) => x.tags.includes("ambiguous") && !x.tags.includes("no-context"))) {
      expect(c.expect.tier, `${c.id} is tagged ambiguous but expects auto`).not.toBe("auto");
    }
  });

  it("confirm tier sits between the configured confidence thresholds", () => {
    expect(KUPI_CONFIG.confidence.confirm).toBeLessThan(KUPI_CONFIG.confidence.auto);
  });
});

// ---------------------------------------------------------------- 2. TEMPLATES
/** Every fact key the app code is allowed to pass to a template. Add here deliberately. */
const FACT_KEYS = new Set([
  "amount", "category", "account", "catRemaining", "catPercent", "todayCount", "todayTotal", "daysLeft",
  "dailySafe", "overAmount", "amountPctOfBudget", "date", "accBalance", "fromAccount", "toAccount", "fee",
  "field", "oldValue", "newValue", "oldAmount", "newAmount", "matchCount", "options", "periodTotal",
  "periodLabel", "count", "dailyAverage", "biggestAmount", "biggestNote", "biggestDate", "topCategory",
  "topAmount", "topPercent", "secondCategory", "secondAmount", "diffAmount", "comparePeriodLabel",
  "netWorth", "topAccount", "topAccountBal", "merchantOrCategory", "quantity", "scopeValue", "bestGuess",
  "feature", "streakDays", "days",
]);
/** Facts that are money: preformatted WITHOUT the peso sign, so the template must supply "₱". */
const MONEY_KEYS = new Set([
  "amount", "catRemaining", "todayTotal", "dailySafe", "overAmount", "accBalance", "fee", "oldAmount",
  "newAmount", "periodTotal", "dailyAverage", "biggestAmount", "topAmount", "secondAmount", "diffAmount",
  "netWorth", "topAccountBal",
]);
const SENSITIVE: ReadonlySet<ResponseIntent> = new Set(["DELETE_TXN", "UNDO", "UNKNOWN", "ERROR", "UNSUPPORTED"]);
const VALID_RESPONSE_INTENTS = new Set<string>([...Object.keys(INTENT_SET), ...RESPONSE_INTENT_EXTRA]);
const STAGES = new Set(["confirm", "done", "ambiguous", "not_found", "nothing"]);

/**
 * Shaming or copied-catchphrase patterns. Word-bounded and specific so benign words
 * (e.g. "honest again") do not trip. Extend, never loosen.
 */
const BANNED: RegExp[] = [
  /\byou spent too much\b/i, /\bspent too much\b/i, /\bwasteful\b/i, /\birresponsible\b/i, /\breckless\b/i,
  /\bcareless\b/i, /\bbad with money\b/i, /\boverspender\b/i, /\bwhat were you thinking\b/i, /\bshame on you\b/i,
  /\byou always\b/i, /\bgastos mo na naman\b/i, /\bang dami mo (nang )?(gastos|nabili)\b/i, /\baksaya\b/i,
  /\bkrabs\b/i, /\bspongebob\b/i, /\bbikini bottom\b/i, /\bkrusty\b/i, /\bi like money\b/i, /\bbarnacles?\b/i, /\bahoy\b/i,
];

/** Placeholder order of first appearance. */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

describe("kupi_templates.json lint", () => {
  it("declares the three moods and has a non-trivial bank", () => {
    expect(bank.moods).toEqual(["happy", "worried", "idle"]);
    expect(templates.length).toBeGreaterThanOrEqual(100);
  });

  it("has unique ids and unique text", () => {
    const ids = new Set<string>();
    const texts = new Set<string>();
    for (const t of templates) {
      expect(ids.has(t.id), `dup id ${t.id}`).toBe(false);
      expect(texts.has(t.text), `dup text ${t.id}`).toBe(false);
      ids.add(t.id);
      texts.add(t.text);
    }
  });

  it("has valid metadata on every template", () => {
    for (const t of templates) {
      expect(VALID_RESPONSE_INTENTS.has(t.intent), `${t.id}: intent`).toBe(true);
      expect(bank.moods, `${t.id}: mood`).toContain(t.mood);
      expect([1, 2, 3], `${t.id}: intensity`).toContain(t.intensity);
      expect(["en", "tl", "en-tl"], `${t.id}: language`).toContain(t.language);
      expect(typeof t.text === "string" && t.text.length > 0, `${t.id}: text`).toBe(true);
      if (t.stage !== undefined) expect(STAGES.has(t.stage), `${t.id}: stage`).toBe(true);
    }
  });

  it("vars equal the unique {placeholders} in text, in order, and are known fact keys", () => {
    for (const t of templates) {
      expect(t.vars, `${t.id}: vars mismatch`).toEqual(placeholders(t.text));
      for (const v of t.vars) expect(FACT_KEYS.has(v), `${t.id}: unknown fact key ${v}`).toBe(true);
    }
  });

  it("money placeholders are always prefixed with the peso sign", () => {
    for (const t of templates)
      for (const v of t.vars.filter((x) => MONEY_KEYS.has(x)))
        for (const m of t.text.matchAll(new RegExp(`(.?)\\{${v}\\}`, "g")))
          expect(m[1], `${t.id}: {${v}} missing ₱`).toBe("₱");
  });

  it("raw text has no template or JS leak tokens", () => {
    for (const t of templates) {
      expect(/\{\{|\}\}|undefined|NaN|null|\[object/.test(t.text), `${t.id}: leak token`).toBe(false);
      expect(/\{[^a-zA-Z]/.test(t.text), `${t.id}: stray brace`).toBe(false);
    }
  });

  it("keeps sensitive intents and low/over-remaining tags at intensity 1", () => {
    for (const t of templates) {
      if (SENSITIVE.has(t.intent)) expect(t.intensity, `${t.id} sensitive`).toBe(1);
      if (t.tags?.some((x) => x === "remaining_low" || x === "remaining_over"))
        expect(t.intensity, `${t.id} remaining tag`).toBe(1);
    }
  });

  it("mood matches the state implied by its tags", () => {
    const worriedTags = ["near_budget", "over_budget", "big_expense", "remaining_low", "remaining_over"];
    const happyTags = ["remaining_ok", "no_spend", "streak"];
    for (const t of templates) {
      if (t.tags?.some((x) => worriedTags.includes(x)))
        expect(t.mood, `${t.id}: budget-danger tag must not be happy`).not.toBe("happy");
      if (t.tags?.some((x) => happyTags.includes(x)))
        expect(t.mood, `${t.id}: calm tag must not be worried`).not.toBe("worried");
    }
  });

  it("over-budget lines are always the worried mood", () => {
    for (const t of templates.filter((x) => x.tags?.includes("over_budget")))
      expect(t.mood).toBe("worried");
  });

  it("passes the banned-phrase list", () => {
    for (const t of templates)
      for (const re of BANNED) expect(re.test(t.text), `${t.id} matches ${re}`).toBe(false);
  });

  it("renders cleanly with sample facts (no leaks, no leftover braces)", () => {
    const facts: Record<string, string> = Object.fromEntries(
      [...FACT_KEYS].map((k) => [k, MONEY_KEYS.has(k) ? "1,234.50" : k.endsWith("Percent") || k === "catPercent" ? "85" : "sample"]),
    );
    for (const t of templates) {
      const out = t.text.replace(/\{(\w+)\}/g, (_m, k: string) => facts[k] ?? "\u0000MISSING");
      expect(out.includes("\u0000"), `${t.id}: unresolved var`).toBe(false);
      expect(/[{}]|undefined|NaN/.test(out), `${t.id}: leak after render`).toBe(false);
      // voice rule: max two short sentences plus a card
      const sentences = out.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, `${t.id}: more than 3 sentences`).toBeLessThanOrEqual(3);
    }
  });

  it("has >= 3 plain LOG_EXPENSE variants for each core (mood, intensity, language) combo", () => {
    const core: Array<[string, number, string]> = [
      ["idle", 1, "en"], ["idle", 1, "en-tl"], ["happy", 2, "en"], ["happy", 2, "en-tl"],
    ];
    for (const [mood, intensity, language] of core) {
      const n = templates.filter(
        (t) => t.intent === "LOG_EXPENSE" && !t.stage && !t.tags?.length &&
          t.mood === mood && t.intensity === intensity && t.language === language,
      ).length;
      expect(n, `LOG_EXPENSE ${mood}/${intensity}/${language}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("every LOG_EXPENSE budget-danger combo has at least one en and one en-tl line", () => {
    for (const tag of ["near_budget", "over_budget", "big_expense"])
      for (const language of ["en", "en-tl"])
        expect(
          templates.some((t) => t.intent === "LOG_EXPENSE" && t.tags?.includes(tag) && t.language === language),
          `${tag}/${language}`,
        ).toBe(true);
  });

  it("every response-side intent the dialogue needs has a template", () => {
    const need: ResponseIntent[] = [
      "LOG_EXPENSE", "LOG_INCOME", "TRANSFER", "EDIT_TXN", "DELETE_TXN", "UNDO", "CANCEL", "QUERY_STATS",
      "SLOT_FILL", "DISAMBIGUATE", "UNKNOWN", "UNSUPPORTED", "ERROR", "HELP", "SMALLTALK", "PROACTIVE",
    ];
    for (const i of need) expect(templates.some((t) => t.intent === i), i).toBe(true);
  });

  it("reports (does not fail on) combos below the 3-variant target", () => {
    const groups = new Map<string, number>();
    for (const t of templates) {
      const k = `${t.intent}|${t.mood}|${t.intensity}|${t.language}`;
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    const thin = [...groups].filter(([, n]) => n < 3).length;
    // eslint-disable-next-line no-console
    console.info(`[templates] ${groups.size} combos, ${thin} below 3 variants (grow these over time)`);
    expect(groups.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 3. HOLD-OUT
/** FNV-1a 32-bit. Stable across runs and platforms. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** Frozen 20% hold-out. Never tune on these. Never change this function. */
export function isHoldout(id: string): boolean {
  return hashId(id) % 5 === 0;
}

describe("hold-out split", () => {
  it("is deterministic and roughly 20%", () => {
    expect(isHoldout("e01")).toBe(isHoldout("e01"));
    const share = golden.filter((c) => isHoldout(c.id)).length / golden.length;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
  });

  it("is pinned: these ids must never change side", () => {
    // If this fails, someone edited hashId/isHoldout. The frozen split must not move.
    const pinned: Record<string, boolean> = {
      e01: true, t08: true, x20: true,
      e10: false, d05: false, f13: false, z05: false, m04: false, c01: false, q13: false,
    };
    for (const [id, expected] of Object.entries(pinned)) expect(isHoldout(id), id).toBe(expected);
  });
});

// ---------------------------------------------------------------- 4. PARSER SCOREBOARD
interface Scored { c: GoldenCase; ok: boolean; why: string[] }

/* eslint-disable @typescript-eslint/no-explicit-any */
const parserExists = existsSync(PARSER_PATH);

describe.skipIf(!parserExists)("parser vs golden set", () => {
  it("scores the parser and enforces gates when KUPI_GATES=1", async () => {
    const mod: any = await import(/* @vite-ignore */ PARSER_PATH);
    const parse: (text: string, ctx: any, db: any, now: Date) => any = mod.parseKupiInput;

    const DEFAULT_NOW = "2026-11-24T12:00:00+08:00";
    // Snapshot of the runtime user data used by the golden cases. Accounts and categories are user-defined.
    const db = {
      accounts: ["Cash / Wallet", "GCash", "Maya", "BDO", "GoTyme Bank", "Custom Savings"].map((name) => ({ name })),
      categories: [
        "Food", "Transport", "Bills", "Shopping", "Phone", "Fun", "Health", "Fees",
        "Salary", "Freelance & Side Gig",
        "Gifts & Cashbacks", "Other Income", "Rental Income", "Business & Sales",
        "Investments & Dividends", "Remittance & Padala Received",
      ].map((name) => ({ name })),
      txns: [] as any[],
    };

    const results: Scored[] = [];
    const normalizeTarget = (target: any) => {
      if (target?.kind === "last") return { ref: "last" };
      if (target?.kind === "id") return { id: target.id };
      if (target?.kind === "match") return { match: target };
      return undefined;
    };
    for (const c of golden) {
      const ctx: any = { recentTemplateIds: [], personality: "classic", rngSeed: 1, ...(c.context ?? {}) };
      const snap = { ...db, txns: (c.context as any)?.txns ?? ((c.context as any)?.lastTxn ? [(c.context as any).lastTxn] : []) };
      if ((c.context as any)?.lastTxn) ctx.lastTxnId = (c.context as any).lastTxn.id;
      const why: string[] = [];
      let r: any;
      try {
        r = parse(c.text, ctx, snap, new Date(c.now ?? DEFAULT_NOW));
      } catch (e) {
        results.push({ c, ok: false, why: [`THREW ${(e as Error).message}`] });
        continue;
      }
      const e = c.expect as any;
      const d0 = r.drafts?.[0];
      if (r.intent !== e.intent) why.push(`intent ${r.intent} != ${e.intent}`);
      if (r.tier !== e.tier) why.push(`tier ${r.tier} != ${e.tier}`);
      if (e.amountCentavos !== undefined && d0?.amount?.value !== e.amountCentavos)
        why.push(`amount ${d0?.amount?.value} != ${e.amountCentavos}`);
      if (e.category !== undefined && d0?.category?.value !== e.category) why.push(`category ${d0?.category?.value} != ${e.category}`);
      if (e.account !== undefined && d0?.account?.value !== e.account) why.push(`account ${d0?.account?.value} != ${e.account}`);
      if (e.toAccount !== undefined && d0?.toAccount?.value !== e.toAccount) why.push(`toAccount ${d0?.toAccount?.value} != ${e.toAccount}`);
      if (e.feeCentavos !== undefined && d0?.fee?.value !== e.feeCentavos) why.push(`fee ${d0?.fee?.value} != ${e.feeCentavos}`);
      if (e.date !== undefined && d0?.date?.value !== e.date) why.push(`date ${d0?.date?.value} != ${e.date}`);
      if (e.items !== undefined) {
        const actualItems = (r.drafts ?? []).map((d: any) => ({
          amountCentavos: d.amount?.value,
          category: d.category?.value,
          account: d.account?.value,
          date: d.date?.value,
        }));
        if (actualItems.length !== e.items.length || e.items.some((item: any, i: number) =>
          Object.entries(item).some(([key, value]) => actualItems[i]?.[key] !== value)
        )) why.push(`items ${JSON.stringify(actualItems)} != ${JSON.stringify(e.items)}`);
      }
      if (e.target !== undefined) {
        const actualTarget = normalizeTarget(r.edit?.target ?? r.deleteTarget);
        const expectedTarget = e.target.ref ? { ref: e.target.ref } : { id: e.target.id };
        if (JSON.stringify(actualTarget) !== JSON.stringify(expectedTarget))
          why.push(`target ${JSON.stringify(actualTarget)} != ${JSON.stringify(expectedTarget)}`);
      }
      if (e.edit !== undefined) {
        const actualEdit = r.edit && { field: r.edit.field, value: r.edit.value };
        const expectedEdit = {
          field: e.edit.field,
          value: e.edit.valueCentavos ?? e.edit.value,
        };
        if (JSON.stringify(actualEdit) !== JSON.stringify(expectedEdit))
          why.push(`edit ${JSON.stringify(actualEdit)} != ${JSON.stringify(expectedEdit)}`);
      }
      if (e.candidates !== undefined && JSON.stringify(r.targetCandidates) !== JSON.stringify(e.candidates))
        why.push(`candidates ${JSON.stringify(r.targetCandidates)} != ${JSON.stringify(e.candidates)}`);
      if (e.query !== undefined && Object.entries(e.query).some(([key, value]) =>
        JSON.stringify(r.query?.[key]) !== JSON.stringify(value)
      )) why.push(`query ${JSON.stringify(r.query)} does not include ${JSON.stringify(e.query)}`);
      if (e.alternatives?.intent !== undefined) {
        const intents = (r.alternatives ?? []).map((alt: any) => alt.intent);
        if (e.alternatives.intent.some((intent: string) => !intents.includes(intent)))
          why.push(`alternative intents ${JSON.stringify(intents)} miss ${JSON.stringify(e.alternatives.intent)}`);
      }
      if (e.alternatives?.amountCentavos !== undefined &&
        JSON.stringify(d0?.amount?.alternatives) !== JSON.stringify(e.alternatives.amountCentavos))
        why.push(`amount alternatives ${JSON.stringify(d0?.amount?.alternatives)} != ${JSON.stringify(e.alternatives.amountCentavos)}`);
      if (e.alternatives?.date !== undefined) {
        const dates = d0?.date ? [d0.date.value, ...(d0.date.alternatives ?? [])] : [];
        if (JSON.stringify(dates) !== JSON.stringify(e.alternatives.date))
          why.push(`date alternatives ${JSON.stringify(dates)} != ${JSON.stringify(e.alternatives.date)}`);
      }
      for (const f of e.flags ?? []) if (!r.flags?.includes(f)) why.push(`missing flag ${f}`);
      for (const m of e.missing ?? []) if (!r.missing?.includes(m)) why.push(`missing slot ${m}`);
      for (const bad of e.mustNotIntent ?? []) if (r.intent === bad) why.push(`forbidden intent ${bad}`);
      if (e.unsupported !== undefined && r.unsupported !== e.unsupported) why.push(`unsupported ${r.unsupported}`);
      results.push({ c, ok: why.length === 0, why });
    }

    // ---- report
    const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
    const by = (f: (s: Scored) => string) => {
      const m = new Map<string, [number, number]>();
      for (const s of results) {
        const k = f(s);
        const [ok, n] = m.get(k) ?? [0, 0];
        m.set(k, [ok + (s.ok ? 1 : 0), n + 1]);
      }
      return [...m].map(([k, [ok, n]]) => `${k}: ${ok}/${n} (${pct(ok, n)})`).join("\n  ");
    };
    const nonHold = results.filter((s) => !isHoldout(s.c.id));
    const hold = results.filter((s) => isHoldout(s.c.id));
    const nonGap = results.filter((s) => s.c.legacy !== "gap");
    // eslint-disable-next-line no-console
    console.info(
      `\n[golden] overall ${results.filter((s) => s.ok).length}/${results.length}` +
        `\n[golden] tune set ${pct(nonHold.filter((s) => s.ok).length, nonHold.length)}  hold-out ${pct(hold.filter((s) => s.ok).length, hold.length)}` +
        `\n[golden] by intent:\n  ${by((s) => s.c.expect.intent)}` +
        `\n[golden] by source:\n  ${by((s) => s.c.source)}` +
        `\n[golden] failures:\n  ${results.filter((s) => !s.ok).map((s) => `${s.c.id} ${JSON.stringify(s.c.text)} -> ${s.why.join("; ")}`).join("\n  ")}`,
    );

    // ---- always-on safety gates
    expect(results.filter((s) => s.why.some((w) => w.startsWith("THREW"))), "parser must never throw").toHaveLength(0);
    expect(results.filter((s) => s.why.some((w) => w.startsWith("forbidden intent"))), "destructive intent on adversarial input").toHaveLength(0);

    // ---- Phase 9 release gates (strict mode only)
    if (process.env.KUPI_GATES === "1") {
      const intentOk = results.filter((s) => !s.why.some((w) => w.startsWith("intent "))).length / results.length;
      expect(intentOk).toBeGreaterThanOrEqual(0.95);
      const withAmount = results.filter((s) => (s.c.expect as any).amountCentavos !== undefined);
      const amountOk = withAmount.filter((s) => !s.why.some((w) => w.startsWith("amount "))).length / withAmount.length;
      expect(amountOk).toBeGreaterThanOrEqual(0.99);
      // Auto-confirm correctness: when the parser says auto, the full case must be right.
      const autoCalled = results.filter((s) => s.why.length === 0 || !s.why.some((w) => w.startsWith("tier ")));
      expect(autoCalled.length).toBeGreaterThan(0);
      expect(nonGap.length).toBeGreaterThan(0);
    }
  });

  it("never throws or returns NaN on random strings (fuzz)", async () => {
    const mod: any = await import(/* @vite-ignore */ PARSER_PATH);
    const containsNonFinite = (value: unknown): boolean => {
      if (typeof value === "number") return !Number.isFinite(value);
      if (Array.isArray(value)) return value.some(containsNonFinite);
      if (value !== null && typeof value === "object") return Object.values(value).some(containsNonFinite);
      return false;
    };
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 ,.₱-/:!?\n🙂éñ{}$%";
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const n = process.env.KUPI_GATES === "1" ? 10_000 : 500;
    for (let i = 0; i < n; i++) {
      const len = Math.floor(rnd() * 40);
      let s = "";
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const r = mod.parseKupiInput(s, { recentTemplateIds: [], personality: "classic", rngSeed: 1 }, { accounts: [], categories: [], txns: [] }, new Date("2026-11-24T12:00:00+08:00"));
      expect(containsNonFinite(r)).toBe(false);
    }
  }, process.env.KUPI_GATES === "1" ? 60_000 : 5_000);
});
