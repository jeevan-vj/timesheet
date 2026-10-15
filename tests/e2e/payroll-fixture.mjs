export const SYNTHETIC_PASSWORD = "CleanTrackE2Epass1";

export function entryPayCents(paidMinutes, rateCents) {
  if (!Number.isInteger(paidMinutes) || !Number.isInteger(rateCents) || paidMinutes <= 0 || rateCents <= 0) {
    throw new Error("invalid_pay_input");
  }
  return Math.round((paidMinutes * rateCents) / 60);
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function minutesLabel(minutes) {
  const abs = Math.abs(minutes);
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
}

export function amountNeedle(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const SITES = [
  { name: "Harbour Wharf", address: "1 Test Wharf" },
  { name: "Civic Tower", address: "2 Test Square" },
  { name: "Airport Lounge", address: "3 Test Road" },
];

const CONTRACTORS = [
  {
    name: "Aroha Test",
    emailLocal: "aroha.e2e",
    phone: "0200000001",
    rateDollars: "28.00",
    defaultRateCents: 2800,
    site: "Harbour Wharf",
    overrideDollars: "",
    schedule: { weekdays: ["Mon", "Wed"], hours: 2, minutes: 0 },
    shift: null,
  },
  {
    name: "Ben Test",
    emailLocal: "ben.e2e",
    phone: "0200000002",
    rateDollars: "32.50",
    defaultRateCents: 3250,
    site: "Civic Tower",
    overrideDollars: "35.00",
    schedule: { weekdays: ["Tue"], hours: 3, minutes: 15 },
    shift: null,
  },
  {
    name: "Cara Test",
    emailLocal: "cara.e2e",
    phone: "0200000003",
    rateDollars: "40.00",
    defaultRateCents: 4000,
    site: "Airport Lounge",
    overrideDollars: "",
    schedule: null,
    shift: { mode: "paid_hours", dayOffset: 0, hours: 4, minutes: 30 },
  },
  {
    name: "Dana Test",
    emailLocal: "dana.e2e",
    phone: "0200000004",
    rateDollars: "22.00",
    defaultRateCents: 2200,
    site: "Harbour Wharf",
    overrideDollars: "",
    schedule: null,
    shift: { mode: "clock", dayOffset: 3, start: "09:00", end: "12:00", breakMinutes: 0 },
  },
];

function snapshotRateCents(contractor) {
  if (contractor.overrideDollars) return Math.round(Number(contractor.overrideDollars) * 100);
  return contractor.defaultRateCents;
}

function occurrence(contractor) {
  if (contractor.schedule) {
    const each = contractor.schedule.hours * 60 + contractor.schedule.minutes;
    return { each, count: contractor.schedule.weekdays.length };
  }
  const shift = contractor.shift;
  if (!shift) return { each: 0, count: 0 };
  if (shift.mode === "paid_hours") return { each: shift.hours * 60 + shift.minutes, count: 1 };
  const [startHour, startMinute] = shift.start.split(":").map(Number);
  const [endHour, endMinute] = shift.end.split(":").map(Number);
  return {
    each: endHour * 60 + endMinute - (startHour * 60 + startMinute) - shift.breakMinutes,
    count: 1,
  };
}

export function syntheticRoster(runId = "local") {
  const contractors = CONTRACTORS.map((contractor) => {
    const rateCents = snapshotRateCents(contractor);
    const { each, count } = occurrence(contractor);
    const paidMinutes = each * count;
    const payCents = count === 0 ? 0 : entryPayCents(each, rateCents) * count;
    return {
      ...contractor,
      email: `${contractor.emailLocal}.${runId}@example.test`,
      snapshotRateCents: rateCents,
      paidMinutesEach: each,
      occurrences: count,
      paidMinutes,
      payCents,
    };
  });
  const paidMinutes = contractors.reduce((sum, contractor) => sum + contractor.paidMinutes, 0);
  const payCents = contractors.reduce((sum, contractor) => sum + contractor.payCents, 0);
  const sites = new Map();
  for (const contractor of contractors) {
    const current = sites.get(contractor.site) ?? { name: contractor.site, paidMinutes: 0, payCents: 0 };
    current.paidMinutes += contractor.paidMinutes;
    current.payCents += contractor.payCents;
    sites.set(contractor.site, current);
  }
  return {
    runId,
    password: SYNTHETIC_PASSWORD,
    owner: {
      name: "Owner North",
      email: `owner.north.${runId}@example.test`,
      business: "Northwind Cleaning",
    },
    otherOwner: {
      name: "Owner South",
      email: `owner.south.${runId}@example.test`,
      business: "Southwind Cleaning",
    },
    sites: SITES,
    contractors,
    totals: { paidMinutes, payCents, entries: contractors.reduce((sum, contractor) => sum + contractor.occurrences, 0) },
    siteTotals: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
