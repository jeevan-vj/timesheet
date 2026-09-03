import { parseRateDollars } from "@/lib/shift-entry";

export type ContractorResource = {
  id: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  currency: "NZD";
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContractorFormDraft = {
  name: string;
  email: string;
  phone: string;
  rateDollars: string;
};

export type ContractorField = "name" | "email" | "phone" | "defaultRateCents";

export type ContractorPayload = {
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
};

export type ContractorFormResult =
  | { ok: true; payload: ContractorPayload }
  | { ok: false; fields: Partial<Record<ContractorField, string>> };

export type ContractorApiFailure = {
  error?: string;
  fields?: Record<string, string>;
};

export type ContractorArchiveTarget = { id: string; name: string };

export type ContractorArchiveSession =
  | { phase: "idle"; target: null }
  | { phase: "confirming"; target: ContractorArchiveTarget }
  | { phase: "submitting"; target: ContractorArchiveTarget };

export type ContractorArchiveRequest = { method: "POST"; url: string };
export type ContractorRestoreRequest = { method: "POST"; url: string };

export const CONTRACTOR_FIELD_ORDER: ContractorField[] = ["name", "email", "phone", "defaultRateCents"];

export const CONTRACTOR_FIELD_MESSAGES: Record<ContractorField, string> = {
  name: "Enter a name between 1 and 100 characters.",
  email: "Enter a valid email or leave it blank.",
  phone: "Phone must be at most 40 characters.",
  defaultRateCents: "Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250).",
};

export const DUPLICATE_CONTRACTOR_COPY =
  "A contractor with this name already exists. Restore the archived contractor or choose a different name.";

export const CONTRACTOR_SUCCESS = {
  added: "Contractor added.",
  updated: "Contractor updated.",
  archived: "Contractor archived.",
  restored: "Contractor restored.",
} as const;

export const idleContractorArchive: ContractorArchiveSession = { phase: "idle", target: null };

export function requestContractorArchive(target: ContractorArchiveTarget): Extract<ContractorArchiveSession, { phase: "confirming" }> {
  return { phase: "confirming", target };
}

export function cancelContractorArchive(): ContractorArchiveSession {
  return idleContractorArchive;
}

export function contractorArchiveRequest(target: ContractorArchiveTarget): ContractorArchiveRequest {
  return { method: "POST", url: `/api/contractors/${target.id}/archive` };
}

export function contractorRestoreRequest(id: string): ContractorRestoreRequest {
  return { method: "POST", url: `/api/contractors/${id}/restore` };
}

export function contractorArchivePrompt(target: ContractorArchiveTarget) {
  return {
    title: "Archive this contractor?",
    description: `Archive ${target.name}? They will leave assignment and shift-entry lists. Past weeks keep their name and recorded pay.`,
    confirmLabel: "Archive contractor",
    cancelLabel: "Cancel",
    closeLabel: "Close archive confirmation",
  };
}

export function createContractorArchiveFlow(
  sendArchive: (request: ContractorArchiveRequest) => Promise<void>,
  onChange?: (session: ContractorArchiveSession) => void,
) {
  let session: ContractorArchiveSession = idleContractorArchive;
  const setSession = (next: ContractorArchiveSession) => {
    session = next;
    onChange?.(session);
  };

  return {
    getSession() {
      return session;
    },
    request(target: ContractorArchiveTarget) {
      setSession(requestContractorArchive(target));
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleContractorArchive);
    },
    async confirm() {
      if (session.phase !== "confirming") return;
      const target = session.target;
      setSession({ phase: "submitting", target });
      try {
        await sendArchive(contractorArchiveRequest(target));
      } finally {
        setSession(idleContractorArchive);
      }
    },
  };
}

export function contractorsListUrl(includeArchived: boolean): string {
  return includeArchived ? "/api/contractors?includeArchived=true" : "/api/contractors";
}

export function visibleContractors<T extends { active: boolean }>(contractors: T[], includeArchived: boolean): T[] {
  return contractors.filter((contractor) => includeArchived || contractor.active);
}

export function emptyContractorsCopy(includeArchived: boolean): string {
  return includeArchived ? "No archived contractors." : "No contractors yet";
}

export function emptyContractorForm(): ContractorFormDraft {
  return { name: "", email: "", phone: "", rateDollars: "30.00" };
}

export function contractorFormFromResource(contractor: Pick<ContractorResource, "name" | "email" | "phone" | "defaultRateCents">): ContractorFormDraft {
  return {
    name: contractor.name,
    email: contractor.email,
    phone: contractor.phone,
    rateDollars: rateDollarsFromCents(contractor.defaultRateCents),
  };
}

export function rateDollarsFromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${negative ? "-" : ""}${dollars}.${String(remainder).padStart(2, "0")}`;
}

export function parseContractorRateDollars(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return "invalid";
  return parseRateDollars(trimmed);
}

function isValidEmail(value: string): boolean {
  if (value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function contractorFormPayload(draft: ContractorFormDraft): ContractorFormResult {
  const fields: Partial<Record<ContractorField, string>> = {};
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 100) fields.name = CONTRACTOR_FIELD_MESSAGES.name;

  const email = draft.email.trim();
  if (email && !isValidEmail(email)) fields.email = CONTRACTOR_FIELD_MESSAGES.email;

  const phone = draft.phone.trim();
  if (phone.length > 40) fields.phone = CONTRACTOR_FIELD_MESSAGES.phone;

  const rateCents = parseContractorRateDollars(draft.rateDollars);
  if (rateCents === null || rateCents === "invalid") fields.defaultRateCents = CONTRACTOR_FIELD_MESSAGES.defaultRateCents;

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    payload: {
      name,
      email,
      phone,
      defaultRateCents: rateCents as number,
    },
  };
}

export function firstInvalidField(fields: Partial<Record<ContractorField, string>>): ContractorField | null {
  return CONTRACTOR_FIELD_ORDER.find((field) => fields[field]) ?? null;
}

export function contractorErrorCopy(failure: ContractorApiFailure): {
  message: string;
  fields: Partial<Record<ContractorField, string>>;
} {
  const code = failure.error ?? "";
  if (code === "duplicate_contractor") {
    return { message: DUPLICATE_CONTRACTOR_COPY, fields: {} };
  }

  const fields: Partial<Record<ContractorField, string>> = {};
  for (const key of CONTRACTOR_FIELD_ORDER) {
    const message = failure.fields?.[key];
    if (message) fields[key] = message;
  }
  if (Object.keys(fields).length > 0) {
    const first = firstInvalidField(fields);
    return { message: first ? fields[first] ?? CONTRACTOR_FIELD_MESSAGES[first] : "Check the highlighted fields.", fields };
  }

  if (code === "invalid_request") {
    return { message: "Check the contractor details and try again.", fields: {} };
  }
  if (code === "not_found") {
    return { message: "That contractor could not be found. Refresh and try again.", fields: {} };
  }
  return { message: "Could not save this contractor. Check your connection and try again.", fields: {} };
}

export function contractorContactLabel(contractor: { email: string; phone: string }): string {
  const parts = [contractor.email.trim(), contractor.phone.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No contact details";
}

export function contractorStatusLabel(active: boolean): string {
  return active ? "Active" : "Archived";
}

export function shiftEntryContractorOptions<T extends { id: string; active?: boolean }>(dashboardContractors: T[]): T[] {
  return dashboardContractors.filter((contractor) => contractor.active !== false);
}

export function createContractorSaveGuard() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(task: () => Promise<void>) {
      if (busy) return;
      busy = true;
      try {
        await task();
      } finally {
        busy = false;
      }
    },
  };
}
