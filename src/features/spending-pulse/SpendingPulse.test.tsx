import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SpendingPulse } from "./SpendingPulse";

vi.mock("./useSpendingPulse", () => ({
  useSpendingPulse: () => ({
    stats: {
      total: 0,
      previousTotal: 0,
      changePercent: null,
      change: "same",
      todayTotal: 0,
      averagePreviousSevenDays: 0,
      budgetCycleSpent: 0,
      budgetCycleLimit: 0,
      hasExpenseHistory: false,
      elapsedDays: 1,
      bars: [],
    },
    insights: [],
    now: new Date("2026-11-24T00:00:00.000Z"),
  }),
}));

function renderPulse(accountFilter: ReactNode) {
  return render(
    <SpendingPulse
      profileId="profile"
      accountId="all"
      accountFilter={accountFilter}
      period="day"
      onPeriodChange={vi.fn()}
      budgetCycleStartDay={1}
      weekStartsOn={1}
      tone="playful"
      language="en"
      reduceMotion={true}
    />
  );
}

describe("SpendingPulse", () => {
  it("does not reserve an empty account-filter row", () => {
    const { container } = renderPulse(null);

    expect(container.querySelector(".spending-pulse__insight-row")).toBeNull();
    expect(container.querySelector(".spending-pulse-widget")?.getAttribute("data-reduce-motion")).toBe("true");
    expect(screen.getByRole("group", { name: "Spending period" })).toBeTruthy();
  });

  it("renders the account-filter row when a filter is provided", () => {
    renderPulse(<span>Account filter</span>);

    expect(screen.getByText("Account filter")).toBeTruthy();
    expect(screen.getByText("Account filter").closest(".spending-pulse__insight-row")).toBeTruthy();
  });
});
