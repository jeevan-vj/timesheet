import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../src/lib/return-to";
import { asViewerShape, landingPath, showsRoleSwitcher } from "../src/lib/viewer-path";

describe("safeReturnTo", () => {
  it("allows the portal paths and ignores everything else", () => {
    expect(safeReturnTo(null)).toBe("/dashboard");
    expect(safeReturnTo(undefined)).toBe("/dashboard");
    expect(safeReturnTo("")).toBe("/dashboard");
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("/portal")).toBe("/portal");
    expect(safeReturnTo("/invite")).toBe("/invite");
    expect(safeReturnTo("/invite?x=1")).toBe("/invite");
    expect(safeReturnTo("/portal#week")).toBe("/portal");
    expect(safeReturnTo(" https://evil.test/portal ")).toBe("/dashboard");
    expect(safeReturnTo("//evil.test/portal")).toBe("/dashboard");
    expect(safeReturnTo("/portal/../dashboard")).toBe("/dashboard");
    expect(safeReturnTo("/%2Fportal")).toBe("/dashboard");
    expect(safeReturnTo("/\\invite")).toBe("/dashboard");
    expect(safeReturnTo("/other")).toBe("/dashboard");
  });
});

describe("viewer landing", () => {
  const link = { businessId: "biz_owner", businessName: "Northwind" };

  it("sends contractor-only users to the portal and leaves everyone else on the dashboard", () => {
    expect(landingPath({ owner: null, contractorOf: [] })).toBe("/dashboard");
    expect(landingPath({ owner: { id: "biz_owner" }, contractorOf: [] })).toBe("/dashboard");
    expect(landingPath({ owner: null, contractorOf: [link] })).toBe("/portal");
    expect(landingPath({ owner: { id: "biz_owner" }, contractorOf: [link] })).toBe("/dashboard");
    expect(showsRoleSwitcher({ owner: { id: "biz_owner" }, contractorOf: [link] })).toBe(true);
    expect(showsRoleSwitcher({ owner: null, contractorOf: [link] })).toBe(false);
  });

  it("drops malformed viewer payloads", () => {
    expect(asViewerShape(null)).toEqual({ owner: null, contractorOf: [] });
    expect(asViewerShape({ owner: { id: "biz" }, contractorOf: [{ businessId: 1, businessName: "X" }, link] })).toEqual({
      owner: { id: "biz" },
      contractorOf: [link],
    });
  });
});
