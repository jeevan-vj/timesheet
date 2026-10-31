import { describe, expect, it, vi } from "vitest";
import {
  ContractorRemittanceError,
  contractorRemittanceMessage,
  downloadContractorRemittance,
  portalRemittancePath,
  type ContractorRemittanceDownloadResponse,
} from "../apps/mobile/src/contractor-remittance";

const target = {
  businessId: "biz_owner-a",
  businessName: "Northwind",
  weekStart: "2026-10-19",
  weekEnd: "2026-10-25",
};

function pdfResponse(overrides: Partial<ContractorRemittanceDownloadResponse> = {}): ContractorRemittanceDownloadResponse {
  return {
    status: 200,
    contentType: "application/pdf",
    contentDisposition: 'attachment; filename="remittance-aroha-2026-10-25.pdf"',
    body: new Uint8Array([37, 80, 68, 70]),
    errorBody: null,
    ...overrides,
  };
}

describe("contractor remittance PDF download", () => {
  it("builds only the contractor portal path and validates week and business ids", () => {
    expect(portalRemittancePath(target)).toBe("/api/portal/payments/2026-10-19/remittance/biz_owner-a");
    expect(() => portalRemittancePath({ ...target, businessId: "../owner" })).toThrow("not_found");
    expect(() => portalRemittancePath({ ...target, weekStart: "2026-10-20" })).toThrow("invalid_week");
  });

  it("writes the PDF to cache, shares it, and removes the temporary file", async () => {
    const send = vi.fn(async () => pdfResponse());
    const remove = vi.fn(async () => undefined);
    const save = vi.fn(async () => ({ uri: "file:///cache/remittance.pdf", remove }));
    const share = vi.fn(async () => undefined);

    await downloadContractorRemittance(target, { send, save, share });

    expect(send).toHaveBeenCalledWith("/api/portal/payments/2026-10-19/remittance/biz_owner-a");
    expect(save).toHaveBeenCalledWith("remittance-aroha-2026-10-25.pdf", new Uint8Array([37, 80, 68, 70]));
    expect(share).toHaveBeenCalledWith("file:///cache/remittance.pdf", "remittance-aroha-2026-10-25.pdf");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("removes the temporary PDF when sharing fails", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(downloadContractorRemittance(target, {
      send: async () => pdfResponse(),
      save: async () => ({ uri: "file:///cache/remittance.pdf", remove }),
      share: async () => { throw new Error("cancelled"); },
    })).rejects.toMatchObject({ code: "share_failed" });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("does not create a file for server errors or a non-PDF response", async () => {
    const save = vi.fn();
    await expect(downloadContractorRemittance(target, {
      send: async () => pdfResponse({ status: 404, contentType: "application/json", body: null, errorBody: { error: "not_found" } }),
      save,
      share: vi.fn(),
    })).rejects.toMatchObject({ code: "not_found" });
    await expect(downloadContractorRemittance(target, {
      send: async () => pdfResponse({ contentType: "application/json" }),
      save,
      share: vi.fn(),
    })).rejects.toMatchObject({ code: "unavailable" });
    expect(save).not.toHaveBeenCalled();
  });

  it("uses safe user-facing error copy", () => {
    expect(contractorRemittanceMessage(new ContractorRemittanceError("offline")).title).toBe("You're offline");
    expect(contractorRemittanceMessage(new ContractorRemittanceError("not_found")).detail).toMatch(/approved remittance/i);
    expect(contractorRemittanceMessage(new ContractorRemittanceError("sharing_unavailable")).detail).toMatch(/device/i);
  });
});
