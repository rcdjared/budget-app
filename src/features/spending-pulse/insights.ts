import type { GetInsightsInput, SpendingPulseInsight, SpendingPulseMood } from "./types";
import { addDateDays, getSpendingPulseRange } from "./periods";

type InsightTrigger = Exclude<SpendingPulseMood, "calm"> | "calm";

function categoryHabitCopy(name: string, count: number, tone: GetInsightsInput["tone"], language: NonNullable<GetInsightsInput["language"]>): string {
  const label = name.toLocaleLowerCase();
  const lead = language === "fil"
    ? tone === "gentle"
      ? `Naitala mo ang ${name} nang ${count} beses ngayong buwan. Magandang mapansin ang ganitong pattern.`
      : tone === "roast"
        ? `${count} beses sumingit ang ${name} ngayong buwan. Parang may attendance award na yata.`
        : `Lumitaw ang ${name} nang ${count} beses ngayong buwan. Suki na kayo!`
    : tone === "gentle"
      ? `You logged ${name} ${count} times this month. That's a useful pattern to notice.`
      : tone === "roast"
        ? `${name} made ${count} appearances this month. It deserves an attendance award.`
        : `${name} showed up ${count} times this month. It may qualify for a loyalty card!`;

  if (/grocery|groceries|palengke|market/.test(label)) {
    return language === "fil"
      ? `${lead} Magdala ng listahan sa palengke o grocery para iwas dagdag-budol sa basket.`
      : `${lead} A shopping list can help keep unplanned extras out of your grocery basket.`;
  }
  if (/food|coffee|milk tea|restaurant|fast.?food|delivery|dining|merienda/.test(label)) {
    return language === "fil"
      ? `${lead} Magtakda ng lingguhang limit para sa pagkain sa labas o meryenda. May treat pa rin, walang gulatan sa budget.`
      : `${lead} Try a weekly dining or snack limit so there is still room for a treat without surprising your budget.`;
  }
  if (/transport|commute|jeep|mrt|grab|taxi|gas|fuel|parking|toll|pamasahe/.test(label)) {
    return language === "fil"
      ? `${lead} Kung araw-araw ang biyahe, pagsabay-sabayin ang mga lakad at silipin ang lingguhang pamasahe para makita kung saan puwedeng makatipid.`
      : `${lead} If these are everyday trips, grouping errands or checking your weekly transport total may reveal an easy saving.`;
  }
  if (/phone|load|mobile|internet|wifi|data/.test(label)) {
    return language === "fil"
      ? `${lead} Suriin ang load, data, at auto-renew na plano. Baka may promo o subscription na hindi mo na ginagamit.`
      : `${lead} Review your mobile data and auto-renewing plans. You may find a promo or subscription you no longer use.`;
  }
  if (/shop|shopping|clothing|gadgets|beauty|personal care/.test(label)) {
    return language === "fil"
      ? `${lead} Maghintay ng 24 oras bago mag-checkout ng hindi kailangan. Baka budol lang na dumaan sa feed.`
      : `${lead} Waiting 24 hours before a non-essential purchase can help separate a real need from an impulse buy.`;
  }
  if (/fun|entertainment|game|movie|travel|vacation|outing/.test(label)) {
    return language === "fil"
      ? `${lead} Magtakda muna ng limit para sa gala o aliw para ma-enjoy ito nang walang guilt.`
      : `${lead} Set a fun-money limit first, then enjoy it guilt-free while it lasts.`;
  }
  return language === "fil"
    ? `${lead} Ikumpara sa budget mo para malaman kung kaya pa ng plano ang ganitong gastos.`
    : `${lead} A quick check against your budget can tell you whether this pace still works for you.`;
}

function weekendHabitCopy(multiplier: string, tone: GetInsightsInput["tone"], language: NonNullable<GetInsightsInput["language"]>): string {
  if (language === "fil") {
    if (tone === "gentle") return `Mas mataas nang halos ${multiplier} beses ang gastos mo kada araw tuwing weekend kumpara sa weekdays. Magtabi ng pang-weekend para masaya pa rin, pasok pa sa budget.`;
    if (tone === "roast") return `Mas magastos ka nang ${multiplier} beses kada araw tuwing weekend kaysa weekdays. Pag-usapan muna ang gala budget bago mag-Sabado.`;
    return `Mas magastos ka nang ${multiplier} beses kada araw tuwing weekend kaysa weekdays. Kasama pala sa gala ang budget, kaya magtakda muna ng limit.`;
  }
  if (tone === "gentle") return `Your weekend spending runs about ${multiplier} times your weekday pace. Try setting aside a weekend amount ahead of time, so plans stay fun and on budget.`;
  if (tone === "roast") return `Weekend spending is about ${multiplier} times your weekday pace. You may want to agree on a fun budget before Saturday arrives.`;
  return `Weekend spending is about ${multiplier} times your weekday pace. Even your budget is coming along, so set a weekend limit before the gala.`;
}

const COPY: Record<NonNullable<GetInsightsInput["language"]>, Record<"gentle" | "playful" | "roast", Record<InsightTrigger, string[]>>> = {
  en: {
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
  },
  fil: {
    gentle: {
      calm: ["Maayos ang takbo ng mga tala mo. Unti-unti nang luminaw ang larawan ng gastos.", "Bawat tala ay tulong sa mas kampanteng pagpili kung saan mapupunta ang pera.", "Maliit na gawain ang pagtatala, malaking tulong sa budget."],
      proud: ["Walang gastos ngayong araw. Panalo ang wallet mo sa pahinga.", "Walang inilabas na pera ngayonâ€”may kaunting luwag sa budget.", "Bihira ang araw na walang gastos. Ayos 'yan!"],
      sleepy: ["Gabi na. Bukas na lang silipin ang gastos; hindi tatakas ang resibo.", "Lampas hatinggabi na. Pahinga muna, bukas na ang budget review.", "Mas sulit ang tulog kaysa puyat kakatingin sa mga resibo."],
      shook: ["Mas mataas ang gastos ngayong araw kaysa sa karaniwan. Silipin kung may kailangang baguhin.", "Mas malaki ito kaysa sa kamakailang average, pero isang araw pa lang ito.", "Kapansin-pansin ang gastos ngayong linggo. Ikaw ang bahalang magpasya kung kailangan ng adjustment."],
      "side-eye": ["Mas mabilis ang gastos kaysa noong nakaraang period. Bantayan kung magpapatuloy ang takbo.", "Mas mataas ang gastos kaysa sa katulad na nakaraang period. May oras pang mag-adjust.", "Bumibilis ang gastos ngayong period. Baka makatulong ang mabilis na check-in."],
      smug: ["Pasok ka pa sa budget. Tuloy lang sa maingat na takbo.", "Mas mababa pa sa limit ang gastos mo. Maganda ang progreso.", "May natitira pang budget ngayong cycle. Ayos ang takbo mo."],
    },
    playful: {
      calm: ["Maamo ang mga numero. Walang drama ang wallet ngayon.", "Sandaling check-in, malaking tulong. Ang organisado mo naman!", "Wala pang plot twist sa gastos. Aprubado ng budget ang kalmadong araw."],
      proud: ["Walang gastos ngayon. Pumalakpak ang sipit ni Kupi.", "Zero ang gastos ngayong araw. Naka-idlip nang mahimbing ang wallet.", "No-spend day! Main character ng financial self-control."],
      sleepy: ["Lampas hatinggabi na. Kahit alimango, sinasabing mag-log off ka na.", "Bukas na ang resibo. Pahinga muna para well-rested ang budget boss.", "Puyat para mag-review ng budget? Tulog ang mas sulit na deal."],
      shook: ["Dramatikong pumasok ang gastos ngayong araw. Narinig ko hanggang dito!", "Medyo nag-extra ang total mo kumpara sa dati.", "Mas malaki ito kaysa sa recent average. Plot twist!"],
      "side-eye": ["Nauunahan mo na ang gastos noong nakaraang period. Wala akong sinasabi, nagmamasid lang.", "Bumilis ang gastos. Napansin ng mga mata ni Kupi.", "Mas mabilis na naman ang gastos. Dito lang ako, nagmamasid."],
      smug: ["Pasok pa sa budget. Humahanga ang maliit na utak-alimango ko.", "May natitira pang budget. Marami pang puwedeng plot twist.", "Nasa ligtas pang bahagi ang budget. Ipagpatuloy ang streak!"],
    },
    roast: {
      calm: ["Kalmado ang mga numero. Huwag mo silang kabahan.", "Kahina-hinalang maayos ang takbo. Wala akong puna. Sa ngayon.", "Walang drama sa pera. Sulitin ang bihirang katahimikan."],
      proud: ["Walang gastos. Nagkasundo rin kayo ng wallet mo.", "Zero ang gastos. Kaya mo palang layuan ang wallet.", "No-spend day. Hindi ko na palalakihin ang bagay na 'to."],
      sleepy: ["Alas-tres na. Hindi tatakas ang budget. Ikaw, matulog ka na.", "Puyat sa pag-review ng gastos? Isama mo rin sa budget ang tulog.", "Matulog ka na. Hindi tatakbo ang mga resibo."],
      shook: ["Lamang na lamang ang gastos ngayon sa karaniwan mong takbo. Astig na diskarte, ah.", "Nilampasan pa ng total ngayon ang recent average mo. Kahanga-hanga, yata.", "May gustong sabihin ang gastos mo. Baka silipin mo kung ano."],
      "side-eye": ["Nauunahan mo na agad ang gastos noong nakaraang period. Interesting.", "Bumibilis ang gastos. Inilabas ko na ang side-eye ko.", "Mas mabilis na naman. Dito lang ako, kunwari walang nakikita."],
      smug: ["Pasok sa budget. Huwag masyadong magyabang.", "May natira ka pang budget. Bihira, pero magandang makita.", "Pasok pa sa limit. Papalakpak sana ako, kaso may sipit ako."],
    },
  },
};

function variants(trigger: InsightTrigger, tone: GetInsightsInput["tone"], language: NonNullable<GetInsightsInput["language"]>): SpendingPulseInsight[] {
  return COPY[language][tone][trigger].map((text) => ({ mood: trigger, text }));
}

export function getInsights({
  stats,
  categories,
  budgets,
  transactions = [],
  budgetCycleStartDay = 1,
  language = "en",
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

  if (stats.budgetCycleLimit > 0 && budgetSpent >= stats.budgetCycleLimit * 0.5) {
    const cycle = getSpendingPulseRange("month", now, { budgetCycleStartDay, weekStartsOn: 0 });
    const cycleLength = Math.max(1, Math.round((Date.parse(`${cycle.end}T00:00:00Z`) - Date.parse(`${cycle.start}T00:00:00Z`)) / 86_400_000) + 1);
    const elapsed = Math.max(1, Math.min(cycleLength, cycle.elapsedDays));
    const spentPercent = Math.round((budgetSpent / stats.budgetCycleLimit) * 100);
    const cyclePercent = Math.round((elapsed / cycleLength) * 100);
    if (spentPercent >= 100 || (spentPercent >= 50 && spentPercent > cyclePercent + 20)) {
      const copy = language === "fil"
        ? spentPercent >= 100
          ? tone === "gentle"
            ? `Nagamit mo na ang buong budget para sa cycle na ito. Tingnan muna kung may mga bayarin pang darating bago magdagdag ng plano.`
            : tone === "roast"
              ? `100% na ang budget mo. Nauna pang maubos kaysa matapos ang buwanâ€”tingnan muna ang natitirang bayarin bago mag-budol.`
              : `100% na ang budget mo. Naubos muna bago matapos ang buwanâ€”silipin ang mga bayarin bago sumabak sa panibagong budol.`
          : tone === "gentle"
            ? `Nagamit mo na ang ${spentPercent}% ng budget kahit ${100 - cyclePercent}% pa ng cycle ang natitira. Silipin ngayon para iwas sikip sa huling linggo.`
            : tone === "roast"
              ? `${spentPercent}% na ang nagastos, pero ${100 - cyclePercent}% pa ang cycle. Baka puwedeng maghinay-hinay muna.`
              : `${spentPercent}% na ang nagastos, pero ${100 - cyclePercent}% pa ng cycle ang natitira. Baka tipid muna para iwas petsa de peligro.`
        : spentPercent >= 100
        ? tone === "gentle"
          ? `Your planned budget is fully used for this cycle. Take a quick look at what is still due before making new plans.`
          : tone === "roast"
            ? `Your budget hit 100% before the month ended. Check what is still due before making another purchase.`
            : `Your budget hit 100% before the month did. Check upcoming bills before the next impulse buy.`
        : tone === "gentle"
          ? `You've used ${spentPercent}% of your budget with ${100 - cyclePercent}% of the cycle left. A quick check now can help avoid a last-week squeeze.`
          : tone === "roast"
            ? `${spentPercent}% of the budget is used, but ${100 - cyclePercent}% of the cycle remains. Consider slowing the spending pace for a bit.`
            : `${spentPercent}% of the budget is used, but ${100 - cyclePercent}% of the cycle remains. Ease up on impulse buys to avoid a payday squeeze.`;
      insights.unshift({ mood: "shook", text: copy });
    }
  }

  // Make at most one habit observation, and only after there is enough history
  // for the pattern to mean something.
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const todayValues = Object.fromEntries(todayParts.map(({ type, value }) => [type, value]));
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
  const habitStart = addDateDays(today, -29);
  const recentExpenses = transactions.filter((transaction) =>
    transaction.type === "expense"
    && !transaction.deletedAt
    && !transaction.cancelledAt
    && transaction.date.slice(0, 10) >= habitStart
    && transaction.date.slice(0, 10) <= today
  );
  if (recentExpenses.length >= 8) {
    const countsByCategory = new Map<string, number>();
    for (const transaction of recentExpenses) {
      if (transaction.categoryId) {
        countsByCategory.set(transaction.categoryId, (countsByCategory.get(transaction.categoryId) || 0) + 1);
      }
    }
    const frequentCategory = [...countsByCategory.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    const category = frequentCategory && categories.find((item) => item.id === frequentCategory[0]);
    if (category && frequentCategory[1] >= 4) {
      const count = frequentCategory[1];
      insights.unshift({ mood: "side-eye", text: categoryHabitCopy(category.name, count, tone, language) });
    }

    const weekendDates = new Set<string>();
    const weekdayDates = new Set<string>();
    let weekendSpend = 0;
    let weekdaySpend = 0;
    for (let offset = 0; offset < 30; offset += 1) {
      const date = addDateDays(habitStart, offset);
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) weekendDates.add(date);
      else weekdayDates.add(date);
    }
    for (const transaction of recentExpenses) {
      const date = transaction.date.slice(0, 10);
      const amount = transaction.personalShareAmount ?? transaction.amount;
      if (weekendDates.has(date)) weekendSpend += amount;
      else weekdaySpend += amount;
    }
    const weekendDaily = weekendSpend / weekendDates.size;
    const weekdayDaily = weekdaySpend / weekdayDates.size;
    if (weekdayDaily > 0 && weekendDaily >= weekdayDaily * 1.5) {
      const multiplier = (weekendDaily / weekdayDaily).toFixed(1);
      const copy = weekendHabitCopy(multiplier, tone, language);
      insights.unshift({ mood: "shook", text: copy });
    }
  }

  if (hour < 4) insights.push(...variants("sleepy", tone, language));
  if (stats.hasExpenseHistory && stats.todayTotal === 0) insights.push(...variants("proud", tone, language));
  if (
    stats.todayTotal > 0
    && stats.averagePreviousSevenDays > 0
    && stats.todayTotal >= stats.averagePreviousSevenDays * 1.5
  ) {
    insights.push(...variants("shook", tone, language));
  }
  if (stats.previousTotal > 0 && stats.total > stats.previousTotal) insights.push(...variants("side-eye", tone, language));
  if (budgetLimit > 0 && budgetSpent > 0 && budgetSpent < budgetLimit) insights.push(...variants("smug", tone, language));
  if (!insights.length) insights.push(...variants("calm", tone, language));

  return insights;
}
