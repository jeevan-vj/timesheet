export function shouldApplySchedule(
  approvalStatus: string | undefined | null,
  assignments: ReadonlyArray<{ schedule: unknown }> = [],
): boolean {
  if (approvalStatus === "approved") return false;
  return assignments.some((row) => row.schedule);
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
