export function mondayFor(date = new Date()): string {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

export function shiftWeek(week: string, days: number): string {
  const value = new Date(`${week}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function thisWeekSelection(selectedWeek: string, today?: Date): string {
  const monday = today === undefined ? mondayFor() : mondayFor(today);
  if (selectedWeek === monday) return selectedWeek;
  return monday;
}
