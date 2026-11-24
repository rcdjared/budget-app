// Kupi mood engine + template picker (plain JS, portable to React Native / web).
// Mood comes from REAL budget numbers, never from randomness.
// The model never writes numbers; app code injects them into templates.

const SENSITIVE_INTENTS = new Set(["DELETE_TXN", "UNDO", "UNKNOWN", "CANCEL"]);

/**
 * state: {
 *   intent, catPercent, overAmount, amountPctOfBudget,
 *   todayCount, todayTotal, streakDays, isError
 * }
 * returns { mood: "happy"|"worried"|"idle", intensity: 1|2|3, tags: [] }
 */
function computeMood(state) {
  const tags = [];
  let mood = "idle";
  let intensity = 1;

  if (state.isError) return { mood: "idle", intensity: 1, tags };

  if (state.intent === "LOG_INCOME" || state.intent === "PROACTIVE") {
    mood = "happy";
    intensity = state.streakDays >= 3 || state.intent === "LOG_INCOME" ? 3 : 2;
    if (state.streakDays >= 3) tags.push("streak");
  } else if (state.catPercent !== undefined) {
    if (state.catPercent > 100) {
      mood = "worried"; intensity = 3; tags.push("over_budget");
    } else if (state.catPercent >= 80) {
      mood = "worried"; intensity = 2; tags.push("near_budget");
    } else if (state.catPercent < 60) {
      mood = "happy"; intensity = 2;
    }
  }

  if (state.amountPctOfBudget >= 40) {
    mood = "worried"; intensity = Math.max(intensity, 2); tags.push("big_expense");
  }
  if (state.todayCount >= 3 && mood !== "worried") {
    tags.push("micro_spend"); intensity = Math.max(intensity, 2);
  }

  // Sensitive intents never get dramatic. Also users can cap intensity in settings.
  if (SENSITIVE_INTENTS.has(state.intent)) intensity = 1;
  return { mood, intensity, tags };
}

const lastUsed = {}; // key -> last template id, to avoid immediate repeats

function pickTemplate(templates, { intent, mood, intensity, tags = [], stage, slot }, userMaxIntensity = 3) {
  const cap = Math.min(intensity, userMaxIntensity);
  const score = (t) => {
    let s = 0;
    if (t.mood === mood) s += 3;
    if (t.intensity === cap) s += 2;
    if (t.intensity > cap) s -= 10;                 // never exceed cap
    s += tags.filter((x) => (t.tags || []).includes(x)).length * 4;
    return s;
  };

  let pool = templates.filter((t) =>
    t.intent === intent && (!stage || t.stage === stage) && (!slot || t.slot === slot)
  );
  if (!pool.length) return null;

  const best = Math.max(...pool.map(score));
  let top = pool.filter((t) => score(t) === best);
  const key = `${intent}:${stage || ""}:${slot || ""}`;
  if (top.length > 1) top = top.filter((t) => t.id !== lastUsed[key]);
  const chosen = top[Math.floor(Math.random() * top.length)];
  lastUsed[key] = chosen.id;
  return chosen;
}

function render(template, vars) {
  return template.text.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}` // leave visible so tests catch missing vars
  );
}

// Example:
// const state = { intent: "LOG_EXPENSE", catPercent: 86, overAmount: 0 };
// const { mood, intensity, tags } = computeMood(state);
// const t = pickTemplate(templatesJson.templates, { intent: state.intent, mood, intensity, tags });
// const text = render(t, { amount: 180, category: "Food", catRemaining: 320, daysLeft: 6 });
// emote = mood  // "happy" | "worried" | "idle"

module.exports = { computeMood, pickTemplate, render };
