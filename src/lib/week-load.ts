export function shouldApplySchedule(approvalStatus: string | undefined | null): boolean {
  return approvalStatus !== "approved";
}

export function applyThenDashboardUrls(weekStart: string) {
  return {
    dashboard: `/api/dashboard?week=${weekStart}`,
    apply: "/api/weeks/apply-schedule" as const,
  };
}

export function applyScheduleBody(weekStart: string) {
  return { weekStart };
}
