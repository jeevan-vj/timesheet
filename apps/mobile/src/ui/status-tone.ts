import type { ShiftStatusLabel } from "@cleantrack/core/portal";

export type StatusPillLabel = ShiftStatusLabel | "Approved" | "Estimated" | "Open" | "Reopened";
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function statusPillTone(label: StatusPillLabel): StatusTone {
  if (label === "Worked" || label === "Approved") return "success";
  if (label === "Pending" || label === "Estimated" || label === "Open" || label === "Reopened") return "warning";
  if (label === "Didn't work") return "neutral";
  return "info";
}
