import fs from "node:fs";
import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { API_ERROR_CODES, calculateEntryPayCents as corePay, isApiErrorCode } from "@cleantrack/core";
import { calculateEntryPayCents as webPay } from "../src/lib/payroll";
import { contractorInput as webContractorInput } from "../src/lib/validation";
import { formatNzd as webFormatNzd } from "../src/lib/week-rollup";
import { contractorInput as coreContractorInput } from "@cleantrack/core/validation";
import { formatNzd as coreFormatNzd } from "@cleantrack/core/week-rollup";
import type { BusinessResource as WebBusiness } from "../src/lib/business";
import type { ContractorResource as WebContractor } from "../src/lib/contractor-setup";
import type { BusinessResource as CoreBusiness, ContractorResource as CoreContractor, WeekApprovalResource as CoreWeek } from "@cleantrack/core";
import type { WeekApprovalResource as WebWeek } from "../src/services/week-approval";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const businessShape: Equal<WebBusiness, CoreBusiness> = true;
const contractorShape: Equal<WebContractor, CoreContractor> = true;
const weekShape: Equal<WebWeek, CoreWeek> = true;

function codesIn(source: string): string[] {
  return [...source.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((match) => match[1] ?? "");
}

describe("@cleantrack/core", () => {
  it("keeps the web payroll, validation, and money imports on one implementation", () => {
    expect(webPay).toBe(corePay);
    expect(webPay(95, 2_750)).toBe(4_354);
    expect(webContractorInput).toBe(coreContractorInput);
    expect(webFormatNzd).toBe(coreFormatNzd);
    expect(webFormatNzd(0)).toBe("$0.00");
    expect(businessShape && contractorShape && weekShape).toBe(true);
  });

  it("parses contractor input with the same Zod instance the web error handler uses", () => {
    const parsed = webContractorInput.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error).toBeInstanceOf(ZodError);
  });

  it("lists every owner API error code the web route map returns", () => {
    const api = fs.readFileSync("src/lib/api.ts", "utf8");
    const block = api.slice(api.indexOf("const expectedErrors"), api.indexOf("export async function authorize"));
    const codes = codesIn(block);
    const known = new Set<string>(API_ERROR_CODES);
    expect(codes.length).toBeGreaterThan(15);
    for (const code of codes) {
      expect(known.has(code), code).toBe(true);
    }
    expect(isApiErrorCode("service_unavailable")).toBe(true);
    expect(isApiErrorCode("not_a_code")).toBe(false);
  });
});
