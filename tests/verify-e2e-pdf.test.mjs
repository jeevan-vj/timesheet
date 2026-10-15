import { describe, expect, it } from "vitest";
import { buildRemittanceModel, renderRemittancePdf } from "../src/lib/remittance.ts";
import { amountNeedle } from "./e2e/payroll-fixture.mjs";
import { pdfText } from "./e2e/pdf-text.mjs";

describe("verify-e2e pdf text", () => {
  it("reads the contractor name and gross amount from a remittance PDF", async () => {
    const model = buildRemittanceModel({
      contractorId: "ctr_test",
      contractorName: "Aroha Test",
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      remitterName: "Owner North",
      remitterEmail: "owner.north@example.test",
      entries: [{
        id: "ent_1",
        workDate: "2026-10-12",
        siteName: "Harbour Wharf",
        paidMinutes: 120,
        rateCents: 2800,
        contractorId: "ctr_test",
        contractorName: "Aroha Test",
      }],
    });
    const text = pdfText(await renderRemittancePdf(model));
    expect(text).toContain("Remittance Advice");
    expect(text).toContain("Aroha Test");
    expect(text).toContain("Harbour Wharf");
    expect(text).toContain(amountNeedle(model.payCents));
    expect(model.payCents).toBe(5600);
  });
});
