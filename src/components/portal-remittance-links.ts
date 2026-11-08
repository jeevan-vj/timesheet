import { createElement } from "react";
import type { PortalPaymentDetail } from "@cleantrack/core/portal";

export function PortalRemittanceLinks({ weekStart, remittances }: Readonly<Pick<PortalPaymentDetail, "weekStart" | "remittances">>) {
  if (remittances.length === 0) return null;
  return createElement("div", { className: "portal-remittances" }, remittances.map((target) =>
    createElement("a", {
      key: target.businessId,
      className: "button secondary",
      href: `/api/portal/payments/${encodeURIComponent(weekStart)}/remittance/${encodeURIComponent(target.businessId)}`,
      download: true,
    }, `Download remittance PDF for ${target.businessName}`),
  ));
}
