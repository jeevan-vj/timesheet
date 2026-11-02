import {
  ownerAssistantFormSubmissionSchema,
  ownerAssistantPlanSchema,
  type OwnerAssistantPlan as AssistantPlan,
  type OwnerAssistantTurnResponse,
} from "@cleantrack/core/owner-assistant";
import { formatMinutes, formatNzd, formatWeekRange, portalCalendar, weekEnd } from "@cleantrack/core";
import type { db } from "@/db/client";
import { ownerAssistantConfirmations } from "@/db/schema";
import { requireOwnerBusinessId } from "@/lib/business";
import { bytesToHex, sha256Bytes } from "@/lib/crypto";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { readOwnerAssistantConfirmation, signOwnerAssistantConfirmation } from "@/lib/owner-assistant-confirm";
import { buildRemittanceModel } from "@/lib/remittance";
import { findWeekApproval } from "@/lib/week-approval-query";
import { getContractorWeekRemittance } from "@/services/remittance";
import { createSite, listSites } from "@/services/sites";
import { createAssignment, createContractor, listContractors } from "@/services/timesheet";

type Database = typeof db;
type SessionUser = { id: string; name?: string | null; email?: string | null };

function sameName(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), "en-NZ", { sensitivity: "base" }) === 0;
}

function findOne<T extends { name: string }>(rows: T[], name: string): T | null {
  const matches = rows.filter((row) => sameName(row.name, name));
  return matches.length === 1 ? matches[0]! : null;
}

function message(value: string): OwnerAssistantTurnResponse {
  return { kind: "message", message: value };
}

export function ownerAssistantPlanFromForm(rawForm: unknown): AssistantPlan {
  const form = ownerAssistantFormSubmissionSchema.parse(rawForm);
  if (form.operation === "create_contractor") {
    const { operation, ...values } = form;
    return { intent: operation, operation: null, reply: `I prepared ${form.name}'s contractor details for review.`, ...values };
  }
  if (form.operation === "create_site") {
    const { operation, ...values } = form;
    return { intent: operation, operation: null, reply: `I prepared ${form.name} for review.`, ...values };
  }
  if (form.operation === "assign_site") {
    const { operation, ...values } = form;
    return { intent: operation, operation: null, reply: `I prepared the ${form.contractorName} to ${form.siteName} assignment for review.`, ...values };
  }
  const { operation, ...values } = form;
  return { intent: operation, operation: null, reply: `I will verify ${form.contractorName}'s remittance for the selected week.`, ...values };
}

function options(rows: Array<{ name: string }>) {
  return rows.map((row) => ({ label: row.name, value: row.name }));
}

async function prepareGuidedInput(
  database: Database,
  user: SessionUser,
  plan: Extract<AssistantPlan, { intent: "clarify" }> & { operation: NonNullable<Extract<AssistantPlan, { intent: "clarify" }>["operation"]> },
): Promise<OwnerAssistantTurnResponse> {
  if (plan.operation === "create_contractor" || plan.operation === "create_site") {
    return { kind: "input", message: plan.reply, input: { operation: plan.operation } };
  }
  const contractors = (await listContractors(database, user.id, false)).filter((row) => row.active);
  if (contractors.length === 0) {
    return message("There are no active contractors to choose from yet. Ask me to create a contractor first.");
  }
  if (plan.operation === "get_remittance") {
    return {
      kind: "input",
      message: plan.reply,
      input: {
        operation: plan.operation,
        contractors: options(contractors),
        weekStart: plan.weekStart ?? portalCalendar().weekStart,
      },
    };
  }
  const sites = await listSites(database, user.id);
  if (sites.length === 0) return message("There are no active sites to choose from yet. Ask me to create a site first.");
  return {
    kind: "input",
    message: plan.reply,
    input: { operation: plan.operation, contractors: options(contractors), sites: options(sites) },
  };
}

async function prepareContractorPreview(
  database: Database,
  user: SessionUser,
  plan: Extract<AssistantPlan, { intent: "create_contractor" }>,
  secret: string,
): Promise<OwnerAssistantTurnResponse> {
  const existing = findOne(await listContractors(database, user.id, true), plan.name);
  if (existing) return message(`${existing.name} already exists. I did not create a duplicate contractor.`);
  const signed = await signOwnerAssistantConfirmation(user.id, {
    kind: "create_contractor", name: plan.name, email: plan.email,
    phone: plan.phone, defaultRateCents: plan.defaultRateCents,
  }, secret);
  return {
    kind: "preview", message: plan.reply,
    confirmation: {
      action: "create_contractor", token: signed.token, expiresAt: signed.expiresAt,
      title: `Create contractor ${plan.name}?`,
      details: [
        { label: "Name", value: plan.name },
        { label: "Default rate", value: `${formatNzd(plan.defaultRateCents)}/hr` },
        { label: "Status", value: "Active" },
      ],
    },
  };
}

async function prepareSitePreview(
  database: Database,
  user: SessionUser,
  plan: Extract<AssistantPlan, { intent: "create_site" }>,
  secret: string,
): Promise<OwnerAssistantTurnResponse> {
  const existing = findOne(await listSites(database, user.id, true), plan.name);
  if (existing) return message(`${existing.name} already exists. I did not create a duplicate site.`);
  const signed = await signOwnerAssistantConfirmation(user.id, { kind: "create_site", name: plan.name, address: plan.address }, secret);
  return {
    kind: "preview", message: plan.reply,
    confirmation: {
      action: "create_site", token: signed.token, expiresAt: signed.expiresAt,
      title: `Create site ${plan.name}?`,
      details: [
        { label: "Name", value: plan.name },
        { label: "Address", value: plan.address || "Not supplied" },
      ],
    },
  };
}

function remittanceVerification(pending: number, approved: boolean) {
  if (pending > 0) return { status: "incomplete" as const, detail: `${pending} scheduled ${pending === 1 ? "shift is" : "shifts are"} still pending.` };
  if (approved) return { status: "verified" as const, detail: "The week is approved and locked, every line reconciles to the total, and no scheduled shifts are pending." };
  return { status: "provisional" as const, detail: "Every line reconciles to the total, but this week is not approved and can still change." };
}

export async function prepareOwnerAssistantResponse(
  database: Database,
  user: SessionUser,
  rawPlan: unknown,
  secret: string,
): Promise<OwnerAssistantTurnResponse> {
  const plan = ownerAssistantPlanSchema.parse(rawPlan);
  await requireOwnerBusinessId(database, user.id);
  if (plan.intent === "clarify") {
    return plan.operation ? prepareGuidedInput(database, user, { ...plan, operation: plan.operation }) : message(plan.reply);
  }
  if (plan.intent === "create_contractor") return prepareContractorPreview(database, user, plan, secret);
  if (plan.intent === "create_site") return prepareSitePreview(database, user, plan, secret);

  const contractors = await listContractors(database, user.id, false);
  const contractor = findOne(contractors.filter((row) => row.active), plan.contractorName);
  if (!contractor) return message(`I could not find one active contractor named ${plan.contractorName}. Check the name and try again.`);

  if (plan.intent === "assign_site") {
    const site = findOne(await listSites(database, user.id), plan.siteName);
    if (!site) return message(`I could not find one active site named ${plan.siteName}. Check the name and try again.`);
    const signed = await signOwnerAssistantConfirmation(user.id, {
      kind: "assign_site", contractorId: contractor.id, siteId: site.id,
      contractorName: contractor.name, siteName: site.name, rateCents: plan.rateCents,
    }, secret);
    return {
      kind: "preview", message: plan.reply,
      confirmation: {
        action: "assign_site", token: signed.token, expiresAt: signed.expiresAt,
        title: `Assign ${contractor.name} to ${site.name}?`,
        details: [
          { label: "Contractor", value: contractor.name },
          { label: "Site", value: site.name },
          { label: "Rate", value: plan.rateCents == null ? `Inherit ${formatNzd(contractor.defaultRateCents)}/hr` : `${formatNzd(plan.rateCents)}/hr override` },
        ],
      },
    };
  }

  const remitterName = user.name?.trim() ?? "";
  const remitterEmail = user.email?.trim() ?? "";
  if (!remitterName || !remitterEmail) return message("Complete the owner name and email before requesting a remittance.");
  let data: Awaited<ReturnType<typeof getContractorWeekRemittance>>;
  try {
    data = await getContractorWeekRemittance(database, user.id, contractor.id, plan.weekStart);
  } catch (error) {
    if (error instanceof Error && error.message === "no_entries") {
      const range = formatWeekRange(plan.weekStart, weekEnd(plan.weekStart));
      return message(`${contractor.name} has no recorded shifts for ${range}, so CleanTrack cannot calculate a remittance yet. Open Week and record the completed shifts. If you use a repeating schedule, apply it for that week first and confirm each shift is correct. Then ask me to check the remittance again.`);
    }
    throw error;
  }
  const model = buildRemittanceModel({
    contractorId: data.contractor.id, contractorName: data.contractor.name,
    weekStart: data.weekStart, weekEnd: data.weekEnd, remitterName, remitterEmail, entries: data.entries,
  });
  const businessId = await requireOwnerBusinessId(database, user.id);
  const approval = await findWeekApproval(database, user.id, plan.weekStart, businessId);
  const pending = data.entries.filter((entry) => entry.occurrenceKind === "scheduled").length;
  const verification = remittanceVerification(pending, approval?.status === "approved");
  return {
    kind: "remittance",
    message: `${contractor.name} has ${formatMinutes(model.paidMinutes)} and ${formatNzd(model.payCents)} gross pay for ${model.weekStart} to ${model.weekEnd}.`,
    verification,
    remittance: model,
  };
}

export async function confirmOwnerAssistantAction(
  database: Database,
  user: SessionUser,
  token: string,
  secret: string,
) {
  const read = await readOwnerAssistantConfirmation(token, secret);
  if (!read.ok) throw new Error(read.error);
  if (read.payload.ownerUserId !== user.id) throw new Error("confirm_mismatch");
  const businessId = await requireOwnerBusinessId(database, user.id);
  const digest = bytesToHex(await sha256Bytes(token));
  try {
    await database.insert(ownerAssistantConfirmations).values({
      id: digest, ownerUserId: user.id, businessId,
      action: read.payload.action.kind, createdAt: new Date(),
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("confirm_used");
    throw error;
  }

  const action = read.payload.action;
  if (action.kind === "create_contractor") {
    const created = await createContractor(database, user.id, action);
    return { kind: "receipt" as const, action: action.kind, targetId: created.id, message: `${created.name} was created as an active contractor.` };
  }
  if (action.kind === "create_site") {
    const created = await createSite(database, user.id, action);
    return { kind: "receipt" as const, action: action.kind, targetId: created.id, message: `${created.name} was created.` };
  }
  const { created, ...assignment } = await createAssignment(database, user.id, {
    contractorId: action.contractorId, siteId: action.siteId, rateCents: action.rateCents,
  });
  return {
    kind: "receipt" as const, action: action.kind, targetId: assignment.id,
    message: `${action.contractorName} was assigned to ${action.siteName}${created ? "." : " and the archived assignment was restored."}`,
  };
}

export type { OwnerAssistantPlan } from "@cleantrack/core/owner-assistant";
