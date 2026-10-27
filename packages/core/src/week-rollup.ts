import { calculateEntryPayCents } from "./payroll";

export type SiteRollupEntry = {
  siteId: string;
  siteName: string;
  paidMinutes: number;
  rateCents: number;
};

export type SiteWeek = {
  siteId: string;
  siteName: string;
  paidMinutes: number;
  payCents: number;
};

export type WeekBriefLine = {
  name: string;
  paidMinutes: number;
  payCents: number;
};

export function summarizeWeekBySite(entries: SiteRollupEntry[]): SiteWeek[] {
  const totals = new Map<string, SiteWeek>();
  for (const entry of entries) {
    const current = totals.get(entry.siteId) ?? {
      siteId: entry.siteId,
      siteName: entry.siteName,
      paidMinutes: 0,
      payCents: 0,
    };
    current.paidMinutes += entry.paidMinutes;
    if (entry.paidMinutes > 0) {
      current.payCents += calculateEntryPayCents(entry.paidMinutes, entry.rateCents);
    }
    totals.set(entry.siteId, current);
  }
  return [...totals.values()].sort((a, b) => a.siteName.localeCompare(b.siteName) || a.siteId.localeCompare(b.siteId));
}

export function formatMinutes(minutes: number): string {
  const abs = Math.abs(minutes);
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
}

export function formatNzd(cents: number): string {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
}

function formatIsoDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

function briefLines(label: string, rows: WeekBriefLine[]): string {
  const body = rows.length
    ? rows.map((row) => `- ${row.name}: ${formatMinutes(row.paidMinutes)} · ${formatNzd(row.payCents)}`).join("\n")
    : "No shifts this week.";
  return `${label}\n${body}`;
}

export function formatWeekBrief(input: {
  weekStart: string;
  weekEnd: string;
  contractors: WeekBriefLine[];
  sites: WeekBriefLine[];
}): string {
  const paidMinutes = input.contractors.reduce((sum, row) => sum + row.paidMinutes, 0);
  const payCents = input.contractors.reduce((sum, row) => sum + row.payCents, 0);
  return [
    `CleanTrack week ${formatIsoDate(input.weekStart)} – ${formatIsoDate(input.weekEnd)}`,
    "Gross contractor pay before tax, GST, expenses, or adjustments.",
    "",
    briefLines("Contractors", input.contractors),
    "",
    briefLines("Sites", input.sites),
    "",
    `Total: ${formatMinutes(paidMinutes)} · ${formatNzd(payCents)}`,
  ].join("\n");
}
