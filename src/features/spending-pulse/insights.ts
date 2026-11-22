import type { GetInsightsInput, SpendingPulseInsight, SpendingPulseMood } from "./types";

type InsightTrigger = Exclude<SpendingPulseMood, "calm"> | "calm";

const COPY: Record<"gentle" | "playful" | "roast", Record<InsightTrigger, string[]>> = {
  gentle: {
    calm: [
      "A little awareness goes a long way. You're building a clearer picture.",
      "Every entry helps you make the next money choice with more confidence.",
      "Steady tracking is a small habit with a big payoff.",
    ],
    proud: [
      "A no-spend day. You gave your wallet a quiet little win.",
      "Nothing went out today. That's a lovely bit of breathing room.",
      "A zero-spend day is worth noticing. Nicely done.",
    ],
    sleepy: [
      "It's late. Your spending can wait until you've had some rest.",
      "Past midnight already. Tomorrow-you can review the numbers.",
      "The receipts will still be here after a good night's sleep.",
    ],
    shook: [
      "Today is running higher than your recent daily pace. Take a gentle look.",
      "Spending is up from your recent average. One day doesn't define a pattern.",
      "Today's total stands out from the last week. You can decide what it means.",
    ],
    "side-eye": [
      "You're ahead of the previous period's pace. Worth keeping an eye on.",
      "Spending is higher than the comparable period. There's still time to adjust.",
      "The numbers are moving faster this period. A quick check-in may help.",
    ],
    smug: [
      "You're within your budget so far. Nice steady progress.",
      "Your spending is under the budget limit. Keep that comfortable pace.",
      "There's room left in your budget cycle. You're doing just fine.",
    ],
  },
  playful: {
    calm: [
      "The numbers are behaving. We love a low-drama wallet.",
      "Tiny check-ins, surprisingly useful. Look at you being organized.",
      "No plot twist in the spending yet. The budget approves this calm.",
    ],
    proud: [
      "A no-spend day. My claws are doing a tiny applause.",
      "Zero spent today. The wallet gets a well-earned nap.",
      "A quiet no-spend day. Look at that financial main-character energy.",
    ],
    sleepy: [
      "It's past midnight. Even this crab thinks you should log off.",
      "The receipts can wait. Go be a well-rested legend.",
      "Late-night budget review? Iconic. Sleep is still a better deal.",
    ],
    shook: [
      "Today's spending made a dramatic entrance. I felt that from here.",
      "Your daily total is doing a little extra compared with usual.",
      "That was a bigger day than your recent average. Plot twist!",
    ],
    "side-eye": [
      "You're outpacing last period. I'm not saying anything. Just observing.",
      "The spending pace picked up. My eyestalks have noticed.",
      "Ahead of last period's pace already. I'm just going to watch this.",
    ],
    smug: [
      "Under budget so far. My tiny crab brain is impressed.",
      "There's budget room left. We love a plot with options.",
      "Your budget is still in the green. Keep that little streak going.",
    ],
  },
  roast: {
    calm: [
      "The numbers are calm. Try not to make them nervous.",
      "A suspiciously tidy stretch. I have no notes. For now.",
      "Nothing dramatic to report. Enjoy this rare financial peace.",
    ],
    proud: [
      "No-spend day. You and your wallet finally agreed on something.",
      "Zero out today. See? You can leave the wallet alone.",
      "A no-spend day. I'll try not to make a big deal of it.",
    ],
    sleepy: [
      "It's 3 a.m. The budget isn't going anywhere. You should.",
      "Reviewing spending this late? Your sleep schedule needs a budget too.",
      "Go to bed. The receipts aren't going to run away.",
    ],
    shook: [
      "Today's spending is way above your recent pace. Bold choice.",
      "That daily total just lapped your recent average. Impressive, I guess.",
      "Your spending made a statement today. Maybe check what it said.",
    ],
    "side-eye": [
      "Already ahead of last period's pace. Interesting strategy.",
      "The spending is moving faster. I brought my best side-eye.",
      "Outpacing last period again. I'll be over here, observing.",
    ],
    smug: [
      "Under budget. Don't let it go to your head.",
      "Look at you leaving room in the budget. A rare and beautiful sight.",
      "Still under the limit. I would clap, but I have claws to maintain.",
    ],
  },
};

function variants(trigger: InsightTrigger, tone: GetInsightsInput["tone"]): SpendingPulseInsight[] {
  return COPY[tone][trigger].map((text) => ({ mood: trigger, text }));
}

export function getInsights({
  stats,
  categories,
  budgets,
  now,
  tone,
}: GetInsightsInput): SpendingPulseInsight[] {
  const insights: SpendingPulseInsight[] = [];
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  const eligibleCategoryIds = new Set(categories.filter((category) => category.type === "expense").map((category) => category.id));
  const budgetLimit = budgets
    .filter((budget) => budget.period === "monthly" && eligibleCategoryIds.has(budget.categoryId))
    .reduce((sum, budget) => sum + budget.amount, 0);
  const budgetSpent = stats.budgetCycleSpent;

  if (hour < 4) insights.push(...variants("sleepy", tone));
  if (stats.hasExpenseHistory && stats.todayTotal === 0) insights.push(...variants("proud", tone));
  if (
    stats.todayTotal > 0
    && stats.averagePreviousSevenDays > 0
    && stats.todayTotal >= stats.averagePreviousSevenDays * 1.5
  ) {
    insights.push(...variants("shook", tone));
  }
  if (stats.previousTotal > 0 && stats.total > stats.previousTotal) insights.push(...variants("side-eye", tone));
  if (budgetLimit > 0 && budgetSpent > 0 && budgetSpent < budgetLimit) insights.push(...variants("smug", tone));
  if (!insights.length) insights.push(...variants("calm", tone));

  return insights;
}
