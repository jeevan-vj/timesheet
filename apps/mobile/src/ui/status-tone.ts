import type { ShiftStatusLabel } from "@cleantrack/core/portal";

export type StatusPillLabel = ShiftStatusLabel
  | "Approved" | "Estimated" | "Open" | "Reopened"
  | "Draft" | "Invited" | "Active" | "Suspended" | "Archived"
  | "No invitation" | "Invitation pending" | "Invitation expired" | "Invitation accepted" | "Invitation revoked";
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function statusPillTone(label: StatusPillLabel): StatusTone {
  if (label === "Worked" || label === "Approved" || label === "Active" || label === "Invitation accepted") return "success";
  if (label === "Pending" || label === "Estimated" || label === "Open" || label === "Reopened" || label === "Invited" || label === "Invitation pending") return "warning";
  if (label === "Suspended" || label === "Invitation expired") return "danger";
  if (label === "Didn't work" || label === "Archived" || label === "No invitation" || label === "Invitation revoked") return "neutral";
  return "info";
}
