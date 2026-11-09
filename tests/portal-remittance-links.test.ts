import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortalRemittanceLinks } from "../src/components/portal-remittance-links";

describe("contractor web remittance links", () => {
  it("renders separate authenticated downloads for each approved business", () => {
    const html = renderToStaticMarkup(createElement(PortalRemittanceLinks, {
      weekStart: "2026-11-02",
      remittances: [
        { businessId: "biz_a", businessName: "First Cleaning" },
        { businessId: "biz_b", businessName: "Second Cleaning" },
      ],
    }));
    expect(html).toContain('/api/portal/payments/2026-11-02/remittance/biz_a');
    expect(html).toContain('/api/portal/payments/2026-11-02/remittance/biz_b');
    expect(html).toContain('Download remittance PDF for First Cleaning');
    expect(html).toContain('Download remittance PDF for Second Cleaning');
    expect(html.match(/download=""/g)).toHaveLength(2);
    expect(html).not.toContain('/api/contractors/');
  });

  it("offers no download without an approved remittance target", () => {
    expect(renderToStaticMarkup(createElement(PortalRemittanceLinks, {
      weekStart: "2026-11-02", remittances: [],
    }))).toBe("");
  });

  it("encodes selectors as path segments and escapes business names", () => {
    const html = renderToStaticMarkup(createElement(PortalRemittanceLinks, {
      weekStart: "2026-11-02",
      remittances: [{ businessId: "a/b?c", businessName: "<Cleaning>" }],
    }));
    expect(html).toContain('/remittance/a%2Fb%3Fc');
    expect(html).toContain('&lt;Cleaning&gt;');
    expect(html).not.toContain('<Cleaning>');
  });
});
