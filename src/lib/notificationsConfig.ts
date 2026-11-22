export const NOTIFICATION_THRESHOLDS = {
  dailyCheckIn: "20:00",
  recurringOffsets: [1, 0],
  debtDaysAhead: 3,
  goalDaysAhead: 7,
  receivableDaysAhead: 3,
  budgetPercentages: [80, 100],
  maxInboxItems: 200,
  retentionDays: 90,
  evaluationIntervalMs: 60_000,
} as const;
